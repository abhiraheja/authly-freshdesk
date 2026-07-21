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
