using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Trackly.Modules.Email;

namespace Trackly.Api.Controllers;

// Option A — inbound parse webhook. A provider (SendGrid/Mailgun/Postmark/SES),
// or a thin relay in front of one, POSTs the parsed email here as JSON. Access is
// proven by an HMAC-SHA256 signature over the raw body using the workspace's
// stored webhook secret — no session auth.
[ApiController]
public class EmailInboundController(InboundEmailService inbound) : ControllerBase
{
    public record InboundAttachmentPayload(string FileName, string ContentType, string ContentBase64);

    public record InboundWebhookPayload(
        string MessageId,
        string From,
        string? FromName,
        string To,
        string Subject,
        string Text,
        List<string>? References,
        List<InboundAttachmentPayload>? Attachments);

    [HttpPost("api/email/inbound/{slug}")]
    [EnableRateLimiting("auth")]
    [RequestSizeLimit(30 * 1024 * 1024)]
    public async Task<IActionResult> Inbound(string slug, CancellationToken ct)
    {
        // Read the raw body first — the HMAC must cover the exact bytes signed.
        using var reader = new StreamReader(Request.Body);
        var raw = await reader.ReadToEndAsync(ct);
        var rawBytes = System.Text.Encoding.UTF8.GetBytes(raw);

        var signature = Request.Headers["X-Trackly-Signature"].ToString();
        var workspaceId = await inbound.ResolveWebhookWorkspaceAsync(slug, rawBytes, signature, ct);
        if (workspaceId is null)
            return Unauthorized(new { error = "Invalid signature or inbound webhook not configured." });

        InboundWebhookPayload? payload;
        try
        {
            payload = JsonSerializer.Deserialize<InboundWebhookPayload>(raw,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        }
        catch (JsonException)
        {
            return BadRequest(new { error = "Malformed webhook payload." });
        }
        if (payload is null
            || string.IsNullOrWhiteSpace(payload.MessageId)
            || string.IsNullOrWhiteSpace(payload.From)
            || string.IsNullOrWhiteSpace(payload.To))
            return BadRequest(new { error = "messageId, from and to are required." });

        var attachments = (payload.Attachments ?? [])
            .Select(a => new InboundAttachment(a.FileName, a.ContentType, DecodeBase64(a.ContentBase64)))
            .Where(a => a.Content.Length > 0)
            .ToList();

        var message = new InboundMessage(
            payload.MessageId,
            payload.From,
            payload.FromName,
            payload.To,
            payload.Subject ?? "",
            payload.Text ?? "",
            payload.References ?? [],
            attachments);

        var result = await inbound.ProcessAsync(workspaceId.Value, message, ct);
        return Ok(new { outcome = result.Outcome, ticketId = result.TicketId, commentId = result.CommentId });
    }

    private static byte[] DecodeBase64(string? value)
    {
        if (string.IsNullOrEmpty(value)) return [];
        try { return Convert.FromBase64String(value); }
        catch (FormatException) { return []; }
    }
}
