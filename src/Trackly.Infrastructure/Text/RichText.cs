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

        // Unwrap disallowed tags instead of deleting them with their contents.
        //
        // The default is to delete, and that loses the whole message when
        // somebody pastes a table from Excel or a <font>-wrapped paragraph from
        // an old email — the words people actually wanted are the children of
        // the tag being removed. It also keeps this in step with the composer's
        // own paste cleaning, which unwraps; if the two disagree, formatting
        // survives the composer and vanishes on save, which is a miserable bug
        // to diagnose from the outside.
        //
        // Script and style are handled below: unwrapping those would turn their
        // source into visible text.
        sanitizer.KeepChildNodes = true;

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
        // Carries nothing but the code-block language and the mention marker;
        // filtered by the class allowlist below, so it cannot reach app CSS.
        sanitizer.AllowedAttributes.Add("class");
        // Who a mention points at. Validated against workspace membership by the
        // caller before anything is written — surviving the sanitiser only means
        // it is a well-formed id, never that it is a real colleague.
        sanitizer.AllowedAttributes.Add("data-user-id");

        sanitizer.AllowedCssProperties.Clear();
        sanitizer.AllowedAtRules.Clear();

        sanitizer.AllowedSchemes.Clear();
        sanitizer.AllowedSchemes.Add("http");
        sanitizer.AllowedSchemes.Add("https");
        sanitizer.AllowedSchemes.Add("mailto");

        sanitizer.AllowedClasses.Clear();
        foreach (var language in CodeLanguages.All)
            sanitizer.AllowedClasses.Add($"language-{language}");
        sanitizer.AllowedClasses.Add(MentionClass);

        sanitizer.PostProcessNode += (_, e) =>
        {
            if (e.Node is not AngleSharp.Html.Dom.IHtmlAnchorElement anchor) return;

            // The scheme check above strips a `javascript:` href but leaves the
            // tag, which renders as link-styled text that does nothing. Unwrap
            // it so the words survive and the false affordance does not.
            if (string.IsNullOrWhiteSpace(anchor.GetAttribute("href")))
            {
                foreach (var child in anchor.ChildNodes.ToArray())
                    e.ReplacementNodes.Add(child);
                return;
            }

            // Every surviving link opens in a new tab without handing the opener
            // a reference back — an agent pasting a URL is not a reason to trust
            // where it points.
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

        var clean = Sanitizer.Sanitize(FlattenTables(DropSourceElements(html))).Trim();
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
        // The opening <li> carries the newline; its close must not add a second
        // one, or every list comes out double-spaced.
        text = Regex.Replace(text, @"<li[^>]*>", "\n- ", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"</li\s*>", string.Empty, RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"</(p|div|ul|ol|blockquote|pre|h3|h4)\s*>", "\n",
            RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"<[^>]+>", string.Empty);
        text = WebUtility.HtmlDecode(text);

        // Collapse the runs the block rules above inevitably produce — a nested
        // list would otherwise come out with a blank line between every item.
        text = Regex.Replace(text, @"[ \t]+\n", "\n");
        text = Regex.Replace(text, @"\n{3,}", "\n\n");
        return text.Trim();
    }

    /// <summary>The class the composer marks a mention with.</summary>
    public const string MentionClass = "mention";

    /// <summary>
    /// Reads the user ids a sanitised body names.
    ///
    /// Derived from the body, never taken from a separate field the client
    /// sends. Two lists that can disagree is one list too many: an agent who
    /// deletes "@Priya" from their note and sends it would otherwise still ping
    /// her, and a caller could ping anyone at all without writing their name.
    ///
    /// Ids that are not real colleagues are the caller's problem to reject —
    /// this only reports what the markup claims.
    /// </summary>
    public static IReadOnlyList<Guid> ExtractMentions(string? html)
    {
        if (string.IsNullOrWhiteSpace(html)) return [];

        var ids = new List<Guid>();
        foreach (Match match in MentionAttribute.Matches(html))
        {
            if (Guid.TryParse(match.Groups[1].Value, out var id) && !ids.Contains(id))
                ids.Add(id);
        }
        return ids;
    }

    /// <summary>
    /// Turns every mention back into ordinary text.
    ///
    /// Used on a note only its author can read: the markup would render as a
    /// live chip that looks like it notified somebody, and it did not. The name
    /// stays — it is part of what they wrote — but the pretence goes.
    /// </summary>
    public static string StripMentionMarkup(string html) =>
        MentionSpan.Replace(html, "$1");

    private static readonly Regex MentionAttribute = new(
        @"data-user-id\s*=\s*[""']([0-9a-fA-F-]{36})[""']",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex MentionSpan = new(
        @"<span\b[^>]*\bdata-user-id\s*=\s*[""'][0-9a-fA-F-]{36}[""'][^>]*>(.*?)</span\s*>",
        RegexOptions.IgnoreCase | RegexOptions.Singleline | RegexOptions.Compiled);

    /// <summary>Plain text → escaped HTML, for the one place that needs the reverse.</summary>
    public static string FromPlainText(string text)
    {
        var builder = new StringBuilder(WebUtility.HtmlEncode(text));
        builder.Replace("\n", "<br>");
        return builder.ToString();
    }

    /// <summary>
    /// Removes elements whose *source* would become visible text once the
    /// sanitiser unwraps them.
    ///
    /// With <c>KeepChildNodes</c> on, an unknown tag is replaced by its
    /// children — which is what saves a pasted table, and what would turn a
    /// pasted <c>&lt;style&gt;</c> block into a paragraph of CSS. These few
    /// carry code rather than content, so they go before the sanitiser runs.
    /// This is a tidiness pass, not the security boundary: the sanitiser is
    /// what makes the result safe either way.
    /// </summary>
    private static string DropSourceElements(string html) =>
        Regex.Replace(
            html,
            @"<(script|style|head|title|noscript|template)\b[^>]*>.*?</\1\s*>",
            string.Empty,
            RegexOptions.IgnoreCase | RegexOptions.Singleline);

    /// <summary>
    /// Turns table structure into spaces and line breaks before it is unwrapped.
    ///
    /// Tables are not on the allowlist, so their cells are unwrapped — and
    /// unwrapping alone runs every cell together into one word. Trackly does not
    /// render tables in a reply, but somebody pasting one from a spreadsheet
    /// should still be able to read what they pasted.
    /// </summary>
    private static string FlattenTables(string html)
    {
        var text = Regex.Replace(html, @"</t[dh]\s*>", " ", RegexOptions.IgnoreCase);
        return Regex.Replace(text, @"</tr\s*>", "<br>", RegexOptions.IgnoreCase);
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
