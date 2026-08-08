using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Trackly.Modules.Guest;
using Trackly.Modules.Tickets;

namespace Trackly.Api.Controllers;

// Public guest flow: OTP-verified anonymous submission + magic-link tracking.
// No session auth anywhere here — access is proven by hashed tokens.
[ApiController]
public class GuestController(GuestService guestService) : ControllerBase
{
    public record SendOtpRequest(string Email, string WorkspaceSlug);
    public record VerifyOtpRequest(string Email, string Code, string WorkspaceSlug);
    public record GuestCommentRequest(string Body);

    [HttpPost("api/guest/otp/send")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> SendOtp([FromBody] SendOtpRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Email) || !request.Email.Contains('@'))
            return BadRequest(new { error = "A valid email address is required." });

        var status = await guestService.SendOtpAsync(request.Email, request.WorkspaceSlug, ct);
        return status switch
        {
            GuestOtpStatus.Sent => NoContent(),
            GuestOtpStatus.RateLimited => StatusCode(StatusCodes.Status429TooManyRequests,
                new { error = "Too many codes requested. Try again in a few minutes." }),
            _ => NotFound(new { error = "Workspace not found." }),
        };
    }

    [HttpPost("api/guest/otp/verify")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> VerifyOtp([FromBody] VerifyOtpRequest request, CancellationToken ct)
    {
        var result = await guestService.VerifyOtpAsync(request.Email, request.Code, request.WorkspaceSlug, ct);
        if (result.Success)
            return Ok(new { submissionToken = result.SubmissionToken });
        if (result.Locked)
            return StatusCode(StatusCodes.Status423Locked,
                new { error = "Too many incorrect codes. Request a new one." });
        return BadRequest(new { error = "Invalid or expired code." });
    }

    [HttpPost("api/tickets/guest")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> CreateTicket(
        [FromQuery] string workspace, [FromBody] CreateGuestTicketRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Name) ||
            string.IsNullOrWhiteSpace(request.Subject) ||
            string.IsNullOrWhiteSpace(request.Description))
            return BadRequest(new { error = "Name, subject and description are required." });

        var created = await guestService.CreateTicketAsync(workspace, request, ct);
        if (created is null)
            return BadRequest(new { error = "Your verification expired. Verify your email again." });
        return StatusCode(StatusCodes.Status201Created, created);
    }

    [HttpGet("api/tickets/guest/{id:guid}")]
    public async Task<IActionResult> GetTicket(Guid id, [FromQuery] string token, CancellationToken ct)
    {
        var view = await guestService.GetTicketAsync(id, token, ct);
        return view is null ? NotFound() : Ok(view);
    }

    [HttpPost("api/tickets/guest/{id:guid}/comments")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> AddComment(
        Guid id, [FromQuery] string token, [FromBody] GuestCommentRequest request, CancellationToken ct)
    {
        var comment = await guestService.AddCommentAsync(id, token, request.Body, ct);
        return comment is null ? NotFound() : StatusCode(StatusCodes.Status201Created, comment);
    }

    [HttpPost("api/tickets/guest/{id:guid}/attachments")]
    [EnableRateLimiting("auth")]
    [RequestSizeLimit(AttachmentService.MaxSizeBytes + 1024)]
    public async Task<IActionResult> Upload(
        Guid id, [FromQuery] string token, [FromQuery] Guid? commentId, IFormFile file, CancellationToken ct)
    {
        if (file is null || file.Length == 0)
            return BadRequest(new { error = "A non-empty file is required." });
        if (file.Length > AttachmentService.MaxSizeBytes)
            return StatusCode(StatusCodes.Status413PayloadTooLarge,
                new { error = "Attachments are limited to 10 MB." });

        await using var stream = file.OpenReadStream();
        var attachment = await guestService.UploadAttachmentAsync(
            id, token, commentId, file.FileName, file.ContentType, file.Length, stream, ct);
        return attachment is null ? NotFound() : StatusCode(StatusCodes.Status201Created, attachment);
    }

    [HttpGet("api/guest/attachments/{id:guid}")]
    public async Task<IActionResult> Download(Guid id, [FromQuery] string token, CancellationToken ct)
    {
        var result = await guestService.DownloadAttachmentAsync(id, token, ct);
        if (result is null)
            return NotFound();
        var (meta, content) = result.Value;

        // Same downgrade as the agent-facing download. If anything, it matters
        // more here: this endpoint is reachable with only a magic-link token, so
        // a file served under a type its uploader chose would execute in the
        // branded origin a customer trusts.
        Response.Headers.XContentTypeOptions = "nosniff";
        var safeType = UploadPolicy.SafeContentType(meta.FileName, meta.ContentType);
        return File(content, safeType, meta.FileName);
    }
}
