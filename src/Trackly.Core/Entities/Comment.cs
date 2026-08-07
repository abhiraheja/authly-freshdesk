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

    /// <summary>
    /// One of <see cref="CommentVisibility"/>: who can read this.
    ///
    /// <see cref="IsInternal"/> is kept in step with it and is still what every
    /// customer-facing filter tests. That is deliberate: invariant 5 says a
    /// private note never reaches a customer, and the safest way to add a third
    /// level was to leave the boolean that already enforces it exactly where it
    /// is. Adding a visibility that a filter forgot about is how that invariant
    /// gets broken quietly.
    /// </summary>
    public string Visibility { get; set; } = CommentVisibility.Public;

    /// <summary>
    /// True for anything a customer must not see. Derived from
    /// <see cref="Visibility"/> — set them together, never one alone.
    /// </summary>
    public bool IsInternal { get; set; }

    public string Source { get; set; } = CommentSource.Web;
    public string? EmailMessageId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<CommentMention> Mentions { get; set; } = new List<CommentMention>();
}

public static class CommentVisibility
{
    /// <summary>The customer sees it. The only kind that leaves Trackly.</summary>
    public const string Public = "public";

    /// <summary>
    /// Every agent and admin in the workspace sees it; no customer does.
    /// The shared scratchpad — "billing says this is a known issue".
    /// </summary>
    public const string Internal = "internal";

    /// <summary>
    /// Only the author sees it. A reminder to self, not a message.
    ///
    /// Admins do not get to read these either. A note nobody else can see is
    /// only useful if that is actually true, and an agent who suspects otherwise
    /// simply stops writing them — at which point the feature is worse than not
    /// having it.
    /// </summary>
    public const string Private = "private";

    public static readonly string[] All = [Public, Internal, Private];

    /// <summary>The <c>is_internal</c> that goes with a visibility.</summary>
    public static bool HiddenFromCustomer(string visibility) => visibility != Public;
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
