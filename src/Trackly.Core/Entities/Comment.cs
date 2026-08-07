namespace Trackly.Core.Entities;

public class Comment
{
    public Guid Id { get; set; }
    public Guid TicketId { get; set; }
    public Ticket Ticket { get; set; } = null!;
    public Guid? AuthorId { get; set; }        // null for guest comments
    public User? Author { get; set; }
    public string? GuestEmail { get; set; }    // set for guest replies
    public string Body { get; set; } = null!;

    /// <summary>
    /// One of <see cref="CommentBodyFormat"/>. Defaults to plain text, which is
    /// what every row written before the rich composer holds and what every
    /// machine-written comment still holds.
    ///
    /// A column rather than sniffing the string: "&lt;3 that fix" is valid plain
    /// text and valid-looking markup, and guessing wrong renders a customer's
    /// words as a broken tag. It also means the day this stops being HTML,
    /// existing rows keep rendering correctly.
    ///
    /// **HTML bodies are sanitised on write**, in the service, against a small
    /// allowlist. Nothing downstream re-checks, so nothing downstream may skip
    /// that step — see <c>RichText</c>.
    /// </summary>
    public string BodyFormat { get; set; } = CommentBodyFormat.Text;

    public bool IsInternal { get; set; }       // private note: never shown to customers/guests
    public string Source { get; set; } = CommentSource.Web;
    public string? EmailMessageId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public static class CommentSource
{
    public const string Web = "web";
    public const string Email = "email";
}

public static class CommentBodyFormat
{
    /// <summary>Rendered with whitespace preserved and every character escaped.</summary>
    public const string Text = "text";

    /// <summary>Sanitised HTML from the composer. Never trusted as it arrives.</summary>
    public const string Html = "html";

    public static readonly string[] All = [Text, Html];
}
