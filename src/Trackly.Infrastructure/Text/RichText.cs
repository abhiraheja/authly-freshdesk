using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using Ganss.Xss;

namespace Trackly.Infrastructure.Text;

/// <summary>
/// The single gate every piece of rich text passes through on its way into the
/// database, and the one way it comes back out as plain text.
///
/// **Why the server sanitises at all.** The composer already refuses to produce
/// anything outside this allowlist, and Angular escapes what it renders. Neither
/// is the control. A comment body is an HTTP field: it reaches the database from
/// anything that can post JSON, and it leaves it into notification emails, the
/// guest view and the model — surfaces with different escaping rules and no
/// shared assumption. Sanitising once, on write, is the only place that covers
/// all of them.
///
/// **The allowlist is deliberately small.** Everything an agent can produce from
/// the toolbar, and nothing else: no images, no tables, no styles, no classes
/// except the code-block language. Each addition is a new thing every consumer
/// has to render correctly, so it is added when something needs it rather than
/// in case.
/// </summary>
public static class RichText
{
    /// <summary>Bodies over this are refused rather than truncated mid-tag.</summary>
    public const int MaxHtmlLength = 200_000;

    private static readonly HtmlSanitizer Sanitizer = BuildSanitizer();

    private static HtmlSanitizer BuildSanitizer()
    {
        var sanitizer = new HtmlSanitizer();

        sanitizer.AllowedTags.Clear();
        foreach (var tag in new[]
                 {
                     "p", "br", "div", "span",
                     "strong", "b", "em", "i", "u", "s", "strike",
                     "ul", "ol", "li",
                     "blockquote", "pre", "code",
                     "h3", "h4",
                     "a", "hr",
                 })
            sanitizer.AllowedTags.Add(tag);

        sanitizer.AllowedAttributes.Clear();
        sanitizer.AllowedAttributes.Add("href");
        sanitizer.AllowedAttributes.Add("title");
        // Carries nothing but the code-block language; filtered to `language-*`
        // by the class allowlist below, so it cannot be used to reach app CSS.
        sanitizer.AllowedAttributes.Add("class");

        sanitizer.AllowedCssProperties.Clear();
        sanitizer.AllowedAtRules.Clear();

        sanitizer.AllowedSchemes.Clear();
        sanitizer.AllowedSchemes.Add("http");
        sanitizer.AllowedSchemes.Add("https");
        sanitizer.AllowedSchemes.Add("mailto");

        sanitizer.AllowedClasses.Clear();
        foreach (var language in CodeLanguages.All)
            sanitizer.AllowedClasses.Add($"language-{language}");

        // Every surviving link opens in a new tab without handing the opener a
        // reference back — an agent pasting a URL is not a reason to trust it.
        sanitizer.PostProcessNode += (_, e) =>
        {
            if (e.Node is not AngleSharp.Html.Dom.IHtmlAnchorElement anchor) return;
            anchor.SetAttribute("target", "_blank");
            anchor.SetAttribute("rel", "noopener noreferrer nofollow");
        };

        return sanitizer;
    }

    /// <summary>
    /// Cleans a composer body. Returns null when nothing renderable survives —
    /// an empty paragraph is not a comment, and the caller should reject it the
    /// same way it rejects an empty string.
    /// </summary>
    public static string? SanitizeHtml(string? html)
    {
        if (string.IsNullOrWhiteSpace(html)) return null;
        if (html.Length > MaxHtmlLength)
            throw new ArgumentException("That message is too long.");

        var clean = Sanitizer.Sanitize(html).Trim();
        // "<p><br></p>" is what an empty contenteditable serialises to, and it is
        // not something anyone typed.
        return HasVisibleContent(clean) ? clean : null;
    }

    /// <summary>
    /// HTML → readable plain text, for the places that cannot render markup:
    /// notification emails (which Trackly sends as text), the AI copilot's
    /// prompt, and list previews.
    ///
    /// Not a general converter — it only has to handle what
    /// <see cref="SanitizeHtml"/> lets through, which is why block tags become
    /// newlines and list items get a dash rather than anything cleverer.
    /// </summary>
    public static string ToPlainText(string? html)
    {
        if (string.IsNullOrWhiteSpace(html)) return string.Empty;

        var text = html;
        text = Regex.Replace(text, @"<br\s*/?>", "\n", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"<li[^>]*>", "\n- ", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"</(p|div|li|ul|ol|blockquote|pre|h3|h4)\s*>", "\n",
            RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"<[^>]+>", string.Empty);
        text = WebUtility.HtmlDecode(text);

        // Collapse the runs the block rules above inevitably produce — a nested
        // list would otherwise come out with a blank line between every item.
        text = Regex.Replace(text, @"[ \t]+\n", "\n");
        text = Regex.Replace(text, @"\n{3,}", "\n\n");
        return text.Trim();
    }

    /// <summary>Plain text → escaped HTML, for the one place that needs the reverse.</summary>
    public static string FromPlainText(string text)
    {
        var builder = new StringBuilder(WebUtility.HtmlEncode(text));
        builder.Replace("\n", "<br>");
        return builder.ToString();
    }

    private static bool HasVisibleContent(string html)
    {
        // &nbsp; counts as nothing: a contenteditable emits one for a space the
        // user is about to type over, and a body of exactly that is empty.
        var stripped = Regex.Replace(html, @"<[^>]+>", string.Empty);
        stripped = WebUtility.HtmlDecode(stripped).Replace(' ', ' ');
        return !string.IsNullOrWhiteSpace(stripped);
    }
}

/// <summary>
/// Languages the composer offers for a code block.
///
/// The list exists to bound the `language-*` class the sanitiser will keep — it
/// is not a claim that Trackly highlights any of them. The value travels with
/// the block so a reader knows what they are looking at and so highlighting can
/// be added later without touching stored content.
/// </summary>
public static class CodeLanguages
{
    public static readonly string[] All =
    [
        "plaintext", "bash", "c", "cpp", "csharp", "css", "dart", "diff", "dockerfile",
        "go", "graphql", "html", "ini", "java", "javascript", "json", "kotlin", "log",
        "markdown", "php", "powershell", "python", "ruby", "rust", "scss", "sql",
        "swift", "typescript", "xml", "yaml",
    ];
}
