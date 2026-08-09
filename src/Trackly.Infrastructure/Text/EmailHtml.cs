using System.Text.RegularExpressions;
using Ganss.Xss;

namespace Trackly.Infrastructure.Text;

/// <summary>
/// The sanitiser for admin-authored email templates.
///
/// **Why this is not <see cref="RichText"/>.** That allowlist forbids tables,
/// images and inline styles — which is precisely what an HTML email is made of.
/// Running a template body through it would delete the layout and leave the
/// words. Two sanitisers, because the two inputs are genuinely different: a
/// comment is prose typed by an agent, a template is markup written by an admin.
///
/// **What this is defending against.** Only admins reach the endpoint that
/// writes a template, so this is not the primary control — the primary control
/// is the `Admin` policy. It matters because the rendered result is displayed
/// back in the template preview inside an admin's browser, and because a
/// template is stored data that outlives the session that wrote it. Scripts,
/// event handlers and `javascript:` URLs have no legitimate use in an email —
/// no mail client executes them — so removing them costs nothing real.
/// </summary>
public static partial class EmailHtml
{
    /// <summary>Templates above this are refused rather than truncated mid-tag.</summary>
    public const int MaxLength = 100_000;

    private static readonly HtmlSanitizer Sanitizer = Build();

    private static HtmlSanitizer Build()
    {
        // Starts from the library's defaults — broad, already excludes script,
        // event handlers and dangerous URL schemes — and adds back what email
        // layouts need. Building up from an empty allowlist the way RichText
        // does would mean enumerating all of HTML's table and presentation
        // vocabulary by hand and getting it subtly wrong.
        var sanitizer = new HtmlSanitizer();

        // Table-based layout is not a stylistic choice in email; Outlook's
        // rendering engine gives no reliable alternative.
        foreach (var tag in new[] { "table", "thead", "tbody", "tfoot", "tr", "td", "th", "center", "style" })
            sanitizer.AllowedTags.Add(tag);

        foreach (var attribute in new[]
                 {
                     "style", "class", "align", "valign", "width", "height",
                     "bgcolor", "cellpadding", "cellspacing", "border", "role",
                     "src", "alt", "target",
                 })
            sanitizer.AllowedAttributes.Add(attribute);

        sanitizer.AllowedSchemes.Clear();
        sanitizer.AllowedSchemes.Add("http");
        sanitizer.AllowedSchemes.Add("https");
        sanitizer.AllowedSchemes.Add("mailto");
        // Inline images as data: URIs — a small spacer or an embedded logo.
        // Restricted to images by the library's own URI handling.
        sanitizer.AllowedSchemes.Add("data");

        // Unlike RichText, dropping a disallowed tag's children is right here: a
        // template is markup, and the "words someone wanted" argument does not
        // apply to the contents of a <script>.
        sanitizer.KeepChildNodes = false;

        return sanitizer;
    }

    /// <summary>
    /// Cleans a template body. Throws when it is too long — refused, not
    /// silently cut, because a truncated template renders as broken markup.
    /// </summary>
    public static string Sanitize(string html)
    {
        if (string.IsNullOrWhiteSpace(html)) return string.Empty;
        if (html.Length > MaxLength)
            throw new ArgumentException("That template is too long.");

        // Placeholders are lifted out before sanitising and put back after.
        //
        // Not paranoia: `href="{{action_url}}"` is not a URL, and the sanitiser
        // validates every URI-bearing attribute against the scheme allowlist. A
        // stripped href on the magic-link template is a sign-in email with no
        // link in it — and it would strip silently, at save time, in a way that
        // only shows up when someone cannot log in. Swapping in an inert token
        // makes the outcome independent of how the library treats a malformed
        // relative URI.
        var placeholders = new List<string>();
        var protectedHtml = PlaceholderRegex().Replace(html, match =>
        {
            placeholders.Add(match.Value);
            return $"{Sentinel}{placeholders.Count - 1}__";
        });

        var clean = Sanitizer.Sanitize(protectedHtml);

        return RestoreRegex().Replace(clean, match =>
        {
            var index = int.Parse(match.Groups[1].Value);
            return index < placeholders.Count ? placeholders[index] : string.Empty;
        });
    }

    // Deliberately not a word anyone would type, so a template containing the
    // literal text cannot collide with a real placeholder's slot.
    private const string Sentinel = "__trackly_tpl_";

    [GeneratedRegex(@"\{\{\{?[^{}]*\}?\}\}")]
    private static partial Regex PlaceholderRegex();

    [GeneratedRegex($@"{Sentinel}(\d+)__")]
    private static partial Regex RestoreRegex();
}
