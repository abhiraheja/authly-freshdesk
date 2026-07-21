namespace Trackly.Core.Entities;

public class Attachment
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;
    public Guid TicketId { get; set; }
    public Ticket Ticket { get; set; } = null!;
    public Guid? CommentId { get; set; }       // null if attached to the ticket itself
    public Comment? Comment { get; set; }
    public Guid? UploadedBy { get; set; }      // null for guest uploads
    public User? UploadedByUser { get; set; }
    public string FileName { get; set; } = null!;
    public string ContentType { get; set; } = null!;
    public long SizeBytes { get; set; }
    public string StorageKey { get; set; } = null!;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
