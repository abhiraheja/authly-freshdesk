using System.Net;
using System.Text;
using System.Text.RegularExpressions;

namespace Trackly.Core.Email;

/// <summary>
/// The whole template language: <c>{{name}}</c>, <c>{{{name}}}</c> and
/// <c>{{#if name}}…{{else}}…{{/if}}</c>. Nothing else.
///
/// **Why not Scriban/Fluid/Handlebars.** Those evaluate expressions against an
/// object graph, and a template here is admin-editable data loaded from a
/// database — that combination is server-side template injection with a friendly
/// name. It would also quietly break invariant 5: against a fixed dictionary
/// there is no expression anyone can write that reaches an internal comment,
/// because internal comments were never put in the dictionary. Against an object
/// graph, one property walk would.
///
/// Conditionals are not a nicety. The resolved-ticket mail carries a CSAT link
/// only sometimes, a mention carries an excerpt only sometimes, and a reply says
/// "reply to this email" only when inbound mail is configured. Without
/// <c>{{#if}}</c> each of those becomes a pre-rendered HTML blob passed in as a
/// variable, which is the hand-built-strings problem this feature exists to fix.
/// </summary>
public static partial class TemplateRenderer
{
    /// <summary>Bodies above this are refused rather than rendered.</summary>
    public const int MaxTemplateLength = 100_000;

    // Triple-brace first: {{{x}}} would otherwise match the double-brace
    // alternative and leave a stray brace behind. Within the double-brace group
    // the keywords precede the variable alternative, so `{{else}}` is a keyword
    // rather than a variable that happens to be named "else".
    [GeneratedRegex(
        @"\{\{\{\s*(?<raw>[A-Za-z_]\w*)\s*\}\}\}" +
        @"|\{\{\s*(?:#if\s+(?<if>[A-Za-z_]\w*)|(?<else>else)|(?<endif>/if)|(?<var>[A-Za-z_]\w*))\s*\}\}",
        RegexOptions.Compiled)]
    private static partial Regex TokenRegex();

    private enum Stop { End, Else, EndIf }

    /// <summary>
    /// Renders into HTML: <c>{{name}}</c> is HTML-escaped, <c>{{{name}}}</c> is not.
    ///
    /// The escaping default is the one that matters. Ticket subjects and customer
    /// names are attacker-supplied — anyone can open a ticket called
    /// <c>&lt;img onerror=…&gt;</c>. Mail clients largely neuter that; Trackly's
    /// own template preview, which renders in an admin's browser, would not.
    /// Triple braces are for values the server itself produced as already
    /// sanitised HTML, and for nothing else.
    /// </summary>
    public static string RenderHtml(string template, IReadOnlyDictionary<string, string?> values)
        => Render(template, values, escape: true);

    /// <summary>
    /// Renders into plain text — subject lines, and the text alternative.
    ///
    /// Escaping is off here, and must be: a subject rendered through the HTML
    /// path arrives in the inbox reading "Ben &amp;amp; Co".
    /// </summary>
    public static string RenderText(string template, IReadOnlyDictionary<string, string?> values)
        => Render(template, values, escape: false);

    private static string Render(string template, IReadOnlyDictionary<string, string?> values, bool escape)
    {
        if (string.IsNullOrEmpty(template)) return string.Empty;
        if (template.Length > MaxTemplateLength)
            throw new FormatException("That template is too long.");

        var tokens = TokenRegex().Matches(template);
        var sb = new StringBuilder(template.Length + 256);
        var token = 0;
        var cursor = 0;

        var stop = RenderBlock(sb, template, tokens, values, escape, emit: true, ref token, ref cursor);
        if (stop != Stop.End)
            throw new FormatException("Unbalanced {{#if}} — every one needs a matching {{/if}}.");

        return sb.ToString();
    }

    /// <summary>
    /// Renders tokens until the block ends, and reports why it ended so the
    /// caller can handle <c>{{else}}</c>.
    ///
    /// <paramref name="emit"/> rather than a node tree: a false condition still
    /// has to be *walked* (its nested ifs must pair up) but not written. Passing
    /// the flag down does both in one traversal.
    /// </summary>
    private static Stop RenderBlock(
        StringBuilder sb, string template, MatchCollection tokens,
        IReadOnlyDictionary<string, string?> values, bool escape, bool emit,
        ref int token, ref int cursor)
    {
        while (token < tokens.Count)
        {
            var match = tokens[token];

            // The literal text between the last token and this one.
            if (emit && match.Index > cursor)
                sb.Append(template, cursor, match.Index - cursor);
            cursor = match.Index + match.Length;
            token++;

            if (match.Groups["endif"].Success) return Stop.EndIf;
            if (match.Groups["else"].Success) return Stop.Else;

            if (match.Groups["if"].Success)
            {
                var condition = IsTruthy(values, match.Groups["if"].Value);
                var stop = RenderBlock(sb, template, tokens, values, escape, emit && condition, ref token, ref cursor);
                if (stop == Stop.Else)
                    stop = RenderBlock(sb, template, tokens, values, escape, emit && !condition, ref token, ref cursor);
                if (stop != Stop.EndIf)
                    throw new FormatException("Unbalanced {{#if}} — every one needs a matching {{/if}}.");
                continue;
            }

            if (!emit) continue;

            if (match.Groups["raw"].Success)
            {
                sb.Append(Lookup(values, match.Groups["raw"].Value));
            }
            else
            {
                var value = Lookup(values, match.Groups["var"].Value);
                sb.Append(escape ? WebUtility.HtmlEncode(value) : value);
            }
        }

        // Trailing literal after the last token.
        if (emit && cursor < template.Length)
            sb.Append(template, cursor, template.Length - cursor);
        return Stop.End;
    }

    // An unknown name renders as nothing rather than as the literal `{{name}}`.
    // A customer receiving "Hello {{customer_name}}" is a worse failure than a
    // missing word, and the admin editor validates names on save anyway.
    private static string Lookup(IReadOnlyDictionary<string, string?> values, string name)
        => values.TryGetValue(name, out var value) ? value ?? string.Empty : string.Empty;

    // "False" is here because a bool stringified by the caller is "False", and a
    // template author writing {{#if has_logo}} means the concept, not the word.
    private static bool IsTruthy(IReadOnlyDictionary<string, string?> values, string name)
    {
        var value = Lookup(values, name);
        return !string.IsNullOrWhiteSpace(value)
               && !value.Equals("false", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Every name the template mentions, in any of the three syntaxes.
    ///
    /// Drives required-variable validation on save: self-hosted means no support
    /// desk, so an admin who deletes <c>{{action_url}}</c> while tidying the
    /// magic-link template has locked everyone out of a product with no recovery
    /// link. Same reasoning as invariant 8.
    /// </summary>
    public static IReadOnlySet<string> ReferencedVariables(string template)
    {
        var names = new HashSet<string>(StringComparer.Ordinal);
        if (string.IsNullOrEmpty(template)) return names;

        foreach (Match match in TokenRegex().Matches(template))
            foreach (var group in (string[])["raw", "var", "if"])
                if (match.Groups[group].Success)
                    names.Add(match.Groups[group].Value);

        return names;
    }

    /// <summary>
    /// Parses without rendering, to reject an unbalanced body at save time
    /// rather than at send time. Returns the failure message, or null when the
    /// template is well-formed.
    /// </summary>
    public static string? Validate(string template)
    {
        try
        {
            Render(template, new Dictionary<string, string?>(), escape: true);
            return null;
        }
        catch (FormatException ex)
        {
            return ex.Message;
        }
    }
}
