using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Trackly.Modules.Channels;

namespace Trackly.Api.Controllers;

// Inbound webhook for messaging connectors (Slack / WhatsApp / Teams). A
// provider-native relay normalizes the provider envelope into this JSON shape and
// signs the raw body with HMAC-SHA256 (X-Trackly-Signature) using the workspace's
// connector secret — same trust model as the email parse webhook. No session auth.
[ApiController]
[AllowAnonymous]
public class ChannelInboundController(ChannelInboundService channels) : ControllerBase
{
    public record InboundChatPayload(
        string ConversationId, string MessageId, string SenderId,
        string? SenderName, string? SenderEmail, string Text);

    [HttpPost("api/channels/inbound/{provider}/{slug}")]
    [EnableRateLimiting("auth")]
    [RequestSizeLimit(2 * 1024 * 1024)]
    public async Task<IActionResult> Inbound(string provider, string slug, CancellationToken ct)
    {
        // Read the raw body first — the HMAC must cover the exact signed bytes.
        using var reader = new StreamReader(Request.Body);
        var raw = await reader.ReadToEndAsync(ct);
        var rawBytes = Encoding.UTF8.GetBytes(raw);

        var signature = Request.Headers["X-Trackly-Signature"].ToString();
        var workspaceId = await channels.ResolveConnectorAsync(provider, slug, rawBytes, signature, ct);
        if (workspaceId is null)
            return Unauthorized(new { error = "Invalid signature or connector not configured." });

        InboundChatPayload? payload;
        try
        {
            payload = JsonSerializer.Deserialize<InboundChatPayload>(raw,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        }
        catch (JsonException)
        {
            return BadRequest(new { error = "Malformed payload." });
        }
        if (payload is null
            || string.IsNullOrWhiteSpace(payload.ConversationId)
            || string.IsNullOrWhiteSpace(payload.MessageId)
            || string.IsNullOrWhiteSpace(payload.Text))
            return BadRequest(new { error = "conversationId, messageId and text are required." });

        var msg = new InboundChatMessage(
            payload.ConversationId, payload.MessageId, payload.SenderId ?? "",
            payload.SenderName, payload.SenderEmail, payload.Text);

        var result = await channels.ProcessAsync(workspaceId.Value, provider, msg, ct);
        return Ok(new { outcome = result.Outcome.ToString(), ticketId = result.TicketId, commentId = result.CommentId });
    }
}
