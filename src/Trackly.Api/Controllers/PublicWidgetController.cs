using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Trackly.Api.Widgets;
using Trackly.Modules.Tickets;
using Trackly.Modules.Widgets;

namespace Trackly.Api.Controllers;

/// <summary>
/// The embedded panel's own API. Anonymous, addressed by the widget's public
/// token, and authenticated — where it needs to be — by the visitor token in
/// <c>X-Trackly-Visitor</c>.
///
/// <para>
/// No endpoint here accepts a workspace slug or id: the workspace is whatever
/// the widget token resolves to, server-side (invariant 1). Customer-facing, so
/// everything it returns is the workspace's branding and always light
/// (invariant 6).
/// </para>
/// </summary>
[ApiController]
[AllowAnonymous]
// Read by widget.js from whatever site embeds the widget, so this is the one
// controller in Trackly that answers another origin. The allowlist that decides
// *which* sites get an answer is enforced inside the service, per widget.
[EnableCors(WidgetCors.Policy)]
[Route("api/public/widget/{token}")]
public class PublicWidgetController(WidgetPublicService widgets) : ControllerBase
{
    /// <summary>
    /// The browser's own origin. Compared against the widget's allowlist inside
    /// the service — an embed on an unlisted site can still draw the iframe (see
    /// plan § 9.2 for why that cannot be stopped here), but it gets nothing back.
    /// </summary>
    private string? Origin => Request.Headers.Origin.ToString() is { Length: > 0 } o ? o : null;

    private string VisitorToken => Request.Headers["X-Trackly-Visitor"].ToString();

    [HttpGet("config")]
    public async Task<IActionResult> Config(string token, CancellationToken ct)
    {
        var config = await widgets.GetConfigAsync(token, Origin, ct);
        if (config is null) return NotFound(new { error = "Widget not found." });

        // Private, not public: the response depends on the caller's Origin, and a
        // shared cache keyed only on the URL would hand one site another site's
        // answer — including the 403 it was supposed to get.
        Response.Headers.CacheControl = "private, max-age=60";
        Response.Headers.Vary = "Origin";
        return Ok(config);
    }

    /// <summary>
    /// This widget's own logo, for a widget that overrides the workspace's.
    /// `config` only names this URL when an override exists — a widget with none
    /// is handed the workspace logo endpoint instead, so this never 404s in
    /// normal use.
    /// </summary>
    [HttpGet("logo")]
    public async Task<IActionResult> Logo(string token, CancellationToken ct)
    {
        var asset = await widgets.GetLogoAsync(token, Origin, ct);
        if (asset is null) return NotFound();

        // Same reasoning as `config`: the answer depends on the caller's Origin.
        Response.Headers.CacheControl = "private, max-age=300";
        Response.Headers.Vary = "Origin";
        return File(asset.Value.Stream, asset.Value.ContentType);
    }

    [HttpPost("session")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> StartSession(
        string token, [FromBody] WidgetIdentityRequest? req, CancellationToken ct)
    {
        var session = await widgets.StartSessionAsync(token, Origin, VisitorToken, req, ct);
        return session is null ? NotFound(new { error = "Widget not found." }) : Ok(session);
    }

    [HttpPatch("session")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> UpdateSession(
        string token, [FromBody] WidgetIdentityRequest req, CancellationToken ct)
    {
        var session = await widgets.UpdateSessionAsync(token, Origin, VisitorToken, req, ct);
        return session is null ? NotFound(new { error = "Session not found." }) : Ok(session);
    }

    // ---- Email verification --------------------------------------------------

    [HttpPost("session/verify-email")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> SendEmailCode(
        string token, [FromBody] WidgetVerifyEmailRequest req, CancellationToken ct)
    {
        var sent = await widgets.SendEmailCodeAsync(token, Origin, VisitorToken, req.Email ?? "", ct);
        return sent ? NoContent() : NotFound(new { error = "Session not found." });
    }

    [HttpPost("session/verify-email/confirm")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> ConfirmEmailCode(
        string token, [FromBody] WidgetConfirmEmailRequest req, CancellationToken ct)
    {
        var session = await widgets.ConfirmEmailCodeAsync(
            token, Origin, VisitorToken, req.Email ?? "", req.Code ?? "", ct);
        return session is null ? NotFound(new { error = "Session not found." }) : Ok(session);
    }

    // ---- Conversations -------------------------------------------------------

    [HttpPost("conversations")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> CreateConversation(
        string token, [FromBody] CreateWidgetConversationRequest req, CancellationToken ct)
    {
        var created = await widgets.CreateConversationAsync(token, Origin, VisitorToken, req, ct);
        return created is null
            ? NotFound(new { error = "Session not found." })
            : StatusCode(StatusCodes.Status201Created, created);
    }

    /// <summary>
    /// The home list. Scoped by the trust rule inside the service: one browser's
    /// threads for an unverified visitor, the whole contact's for a proven one.
    /// </summary>
    [HttpGet("conversations")]
    public async Task<IActionResult> ListConversations(string token, CancellationToken ct)
    {
        var list = await widgets.ListConversationsAsync(token, Origin, VisitorToken, ct);
        return list is null ? NotFound(new { error = "Session not found." }) : Ok(list);
    }

    /// <summary>
    /// One thread. A conversation this visitor may not read is a 404, not a 403 —
    /// telling an anonymous caller that a ticket exists but is not theirs is
    /// already more than they should learn.
    /// </summary>
    [HttpGet("conversations/{conversationId:guid}")]
    public async Task<IActionResult> GetConversation(string token, Guid conversationId, CancellationToken ct)
    {
        var thread = await widgets.GetConversationAsync(token, Origin, VisitorToken, conversationId, ct);
        return thread is null ? NotFound(new { error = "Conversation not found." }) : Ok(thread);
    }

    [HttpPost("conversations/{conversationId:guid}/messages")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Reply(
        string token, Guid conversationId, [FromBody] WidgetReplyRequest req, CancellationToken ct)
    {
        var message = await widgets.ReplyAsync(token, Origin, VisitorToken, conversationId, req?.Message, ct);
        return message is null
            ? NotFound(new { error = "Conversation not found." })
            : StatusCode(StatusCodes.Status201Created, message);
    }

    /// <summary>The read receipt behind the unread badge (plan § 8.1).</summary>
    [HttpPost("conversations/{conversationId:guid}/read")]
    public async Task<IActionResult> MarkRead(string token, Guid conversationId, CancellationToken ct)
    {
        var ok = await widgets.MarkReadAsync(token, Origin, VisitorToken, conversationId, ct);
        return ok ? NoContent() : NotFound(new { error = "Conversation not found." });
    }

    // ---- Attachments -----------------------------------------------------------

    [HttpPost("conversations/{conversationId:guid}/attachments")]
    [EnableRateLimiting("auth")]
    [RequestSizeLimit(AttachmentService.MaxSizeBytes + 1024)]
    public async Task<IActionResult> UploadAttachment(
        string token, Guid conversationId, IFormFile file, [FromQuery] Guid? messageId, CancellationToken ct)
    {
        if (file is null || file.Length == 0)
            return BadRequest(new { error = "A file is required." });

        await using var stream = file.OpenReadStream();
        var uploaded = await widgets.UploadAttachmentAsync(
            token, Origin, VisitorToken, conversationId, messageId,
            file.FileName, file.ContentType, file.Length, stream, ct);
        return uploaded is null
            ? NotFound(new { error = "Conversation not found." })
            : StatusCode(StatusCodes.Status201Created, uploaded);
    }

    [HttpGet("conversations/{conversationId:guid}/attachments/{attachmentId:guid}")]
    public async Task<IActionResult> DownloadAttachment(
        string token, Guid conversationId, Guid attachmentId, CancellationToken ct)
    {
        var found = await widgets.DownloadAttachmentAsync(
            token, Origin, VisitorToken, conversationId, attachmentId, ct);
        if (found is null) return NotFound(new { error = "Attachment not found." });

        var (meta, content) = found.Value;
        return File(content, meta.ContentType, meta.FileName);
    }
}
