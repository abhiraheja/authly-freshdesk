using System.Text;

namespace Trackly.Core.Entities;

/// <summary>
/// The **ticket number** — what an agent means by "#019fea6e".
///
/// Trackly has no separate ticket-number column. The number *is* the leading hex
/// of the id, which is what every screen prints (`#{id[..8]}`) and therefore what
/// people read out to each other, paste into chat and type into search. A second
/// sequential column would be a second identity for one row: two things to keep
/// in step, and a migration that has to invent numbers for tickets that already
/// exist.
///
/// Because the ids are <see cref="Guid.CreateVersion7"/>, that leading hex is a
/// timestamp — so the numbers people quote also happen to sort by age, which is
/// exactly the intuition "#0001 is older than #0002" gives them for free.
///
/// **Prefix matching is done as a RANGE, never as text.** `id::text LIKE '019f%'`
/// cannot use the primary-key index and degrades into a sequential scan of every
/// ticket in the workspace. Two comparisons against the same column do use it.
/// The ordering is safe to rely on: PostgreSQL compares <c>uuid</c> byte by byte,
/// and the canonical hex form is those bytes in order, so hex-string order and
/// <c>uuid</c> order are the same order. (.NET's own <c>Guid.CompareTo</c> is
/// *not* — it compares the first fields as integers. Nothing here depends on it:
/// the comparison happens in the database.)
/// </summary>
public static class TicketNumber
{
    /// <summary>Every id whose canonical hex starts with the prefix that built it.</summary>
    public readonly record struct IdRange(Guid Low, Guid High);

    /// <summary>
    /// Below this, a "number" is not narrow enough to be one.
    ///
    /// Four hex digits is one part in 65,536 — plenty to identify a ticket in any
    /// real workspace, and short enough that somebody who only remembers the
    /// first half of what they saw still lands on it.
    /// </summary>
    private const int MinPrefixLength = 4;

    private const int HexLength = 32;

    /// <summary>
    /// Reads a ticket number and returns the ids it could mean, or null when what
    /// was typed is not a ticket number at all.
    ///
    /// Accepts what people actually type: a leading <c>#</c>, the dashes from a
    /// copied full id, and either case. Anything with a non-hex character in it is
    /// prose — the caller searches subjects with it instead.
    /// </summary>
    public static IdRange? ToIdRange(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;

        var hex = new StringBuilder(HexLength);
        foreach (var character in value)
        {
            // The punctuation of an id as it is written down, not part of it.
            if (character is '#' or '-' or ' ') continue;
            if (!Uri.IsHexDigit(character)) return null;
            // Longer than an id can be, so it is not one.
            if (hex.Length == HexLength) return null;
            hex.Append(char.ToLowerInvariant(character));
        }

        if (hex.Length < MinPrefixLength) return null;

        var prefix = hex.ToString();
        return new IdRange(
            Guid.ParseExact(prefix.PadRight(HexLength, '0'), "N"),
            Guid.ParseExact(prefix.PadRight(HexLength, 'f'), "N"));
    }

    /// <summary>
    /// The number as Trackly prints it, without the <c>#</c>.
    ///
    /// One place, so an activity entry, a notification preview and the heading on
    /// the ticket all quote the same eight characters. They did not, once.
    /// </summary>
    public static string Of(Guid id) => id.ToString("N")[..8];

    /// <summary>The same, with the <c>#</c> — for text a person reads.</summary>
    public static string Hash(Guid id) => $"#{Of(id)}";
}
