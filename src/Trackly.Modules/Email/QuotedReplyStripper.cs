using System.Text.RegularExpressions;

namespace Trackly.Modules.Email;

// Keeps only the new text a customer typed, dropping the quoted history that mail
// clients append ("On Jul 4, Viola wrote:", ">"-prefixed lines, Outlook dividers).
// Best-effort: if stripping would remove everything, the original is kept.
public static partial class QuotedReplyStripper
{
    [GeneratedRegex(@"^On .+ wrote:\s*$", RegexOptions.IgnoreCase)]
    private static partial Regex OnWrote();

    [GeneratedRegex(@"^-{2,}\s*Original Message\s*-{2,}\s*$", RegexOptions.IgnoreCase)]
    private static partial Regex OriginalMessage();

    [GeneratedRegex(@"^From:\s.+", RegexOptions.IgnoreCase)]
    private static partial Regex OutlookFrom();

    public static string Strip(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return body?.Trim() ?? "";

        var lines = body.Replace("\r\n", "\n").Split('\n');
        var cut = lines.Length;

        for (var i = 0; i < lines.Length; i++)
        {
            var line = lines[i].TrimEnd();
            if (line.StartsWith('>')
                || line.StartsWith("________________________________")
                || OnWrote().IsMatch(line)
                || OriginalMessage().IsMatch(line)
                || OutlookFrom().IsMatch(line))
            {
                cut = i;
                break;
            }
        }

        var kept = string.Join('\n', lines[..cut]).Trim();
        return kept.Length > 0 ? kept : body.Trim();
    }

    // Drops leading "Re:"/"Fwd:" markers for a subject used as a new ticket title.
    public static string CleanSubject(string subject)
    {
        var s = subject?.Trim() ?? "";
        while (true)
        {
            var trimmed = Regex.Replace(s, @"^\s*(re|fwd|fw)\s*:\s*", "", RegexOptions.IgnoreCase);
            if (trimmed == s) return trimmed.Length > 0 ? trimmed : "(no subject)";
            s = trimmed;
        }
    }
}
