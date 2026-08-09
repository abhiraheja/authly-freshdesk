using System.Text;
using AngleSharp.Dom;
using AngleSharp.Html.Dom;
using AngleSharp.Html.Parser;

namespace Trackly.Infrastructure.Text;

/// <summary>
/// Rendered email HTML → the <c>text/plain</c> alternative that ships alongside it.
///
/// **Why not <see cref="RichText.ToPlainText"/>.** That one is regex-based and
/// says so: it "only has to handle what SanitizeHtml lets through". Pointed at
/// an email layout it fails in three ways that matter — a table becomes one
/// run-on line, <c>&lt;style&gt;</c> contents leak in as visible CSS, and
/// <c>&lt;a href&gt;</c> loses the URL because the tag is stripped and only the
/// link text survives. That last one is fatal: the plain-text part of a
/// magic-link email would contain the words "Sign in" and no link.
///
/// **Why the text part is generated at all.** Giving every template a second
/// hand-written text body doubles the editing surface for something nobody
/// maintains, and a stale text part is worse than a derived one. Deriving means
/// it cannot drift.
///
/// Parses properly rather than matching tags, because table layout is nested and
/// regexes do not nest.
/// </summary>
public static class EmailText
{
    private static readonly HtmlParser Parser = new();

    private static readonly HashSet<string> BlockTags = new(StringComparer.OrdinalIgnoreCase)
    {
        "p", "div", "tr", "table", "ul", "ol", "li", "blockquote", "pre",
        "h1", "h2", "h3", "h4", "h5", "h6", "hr", "center", "section", "header", "footer",
    };

    public static string FromHtml(string? html)
    {
        if (string.IsNullOrWhiteSpace(html)) return string.Empty;

        var document = Parser.ParseDocument(html);
        var sb = new StringBuilder();
        Walk(document.Body ?? document.DocumentElement, sb);
        return Collapse(sb.ToString());
    }

    private static void Walk(INode? node, StringBuilder sb)
    {
        if (node is null) return;

        switch (node)
        {
            case IText text:
                // Whitespace inside markup is layout, not content: an indented
                // table would otherwise contribute a screenful of spaces.
                var value = text.Data.Replace('\n', ' ').Replace('\r', ' ').Replace('\t', ' ');
                sb.Append(value);
                return;

            case IElement element:
                var tag = element.LocalName;

                // Their contents are code, not words. Dropping them here rather
                // than trusting the sanitiser keeps this correct for the
                // built-in templates too, which never pass through it.
                if (tag is "script" or "style" or "head" or "title") return;

                if (tag == "br") { sb.Append('\n'); return; }

                // The logo is the common case, and "Acme logo" as the opening
                // line of every email is noise. Alt text that says something
                // else is worth keeping.
                if (element is IHtmlImageElement image)
                {
                    var alt = image.AlternativeText;
                    if (!string.IsNullOrWhiteSpace(alt) && !alt.Contains("logo", StringComparison.OrdinalIgnoreCase))
                        sb.Append(alt);
                    return;
                }

                var isBlock = BlockTags.Contains(tag);
                if (isBlock) sb.Append('\n');

                // A table cell is a column break, not a line break — without a
                // separator, two cells run their words together.
                if (tag is "td" or "th" && sb.Length > 0 && sb[^1] is not ('\n' or ' '))
                    sb.Append(' ');

                foreach (var child in element.ChildNodes)
                    Walk(child, sb);

                if (element is IHtmlAnchorElement anchor)
                    AppendHref(anchor, sb);

                if (isBlock) sb.Append('\n');
                return;

            default:
                foreach (var child in node.ChildNodes)
                    Walk(child, sb);
                return;
        }
    }

    /// <summary>
    /// Writes a link's target after its text, as <c>Sign in &lt;https://…&gt;</c>.
    ///
    /// The whole reason this class exists. Suppressed when the text already *is*
    /// the URL, which is the other common way a template writes a link and would
    /// otherwise print it twice.
    /// </summary>
    private static void AppendHref(IHtmlAnchorElement anchor, StringBuilder sb)
    {
        var href = anchor.GetAttribute("href");
        if (string.IsNullOrWhiteSpace(href)) return;
        if (href.StartsWith("mailto:", StringComparison.OrdinalIgnoreCase)) return;

        var text = anchor.TextContent.Trim();
        if (text.Length > 0 && (href.Contains(text, StringComparison.OrdinalIgnoreCase)
                                || text.Contains(href, StringComparison.OrdinalIgnoreCase)))
            return;

        sb.Append(text.Length > 0 ? $" <{href}>" : href);
    }

    private static string Collapse(string text)
    {
        var sb = new StringBuilder(text.Length);
        var spaceRun = false;
        var newlineRun = 0;

        foreach (var c in text)
        {
            if (c == '\n')
            {
                // Block tags open and close with a newline each, so a nested
                // layout emits long runs. Two is a paragraph break; more is an
                // accident of the markup.
                newlineRun++;
                spaceRun = false;
                continue;
            }

            if (c == ' ')
            {
                spaceRun = true;
                continue;
            }

            if (newlineRun > 0 && sb.Length > 0)
                sb.Append('\n', Math.Min(newlineRun, 2));
            else if (spaceRun && sb.Length > 0)
                sb.Append(' ');

            newlineRun = 0;
            spaceRun = false;
            sb.Append(c);
        }

        return sb.ToString().Trim();
    }
}
