using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Trackly.Api.Auth;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;

namespace Trackly.Api.Controllers;

// Embeddable widget: admin config + the public config the widget reads + the
// served widget.js loader. The widget renders the workspace-branded submit form
// (invariant 6) in an iframe or floating panel.
[ApiController]
public class WidgetController(TracklyDbContext db, IConfiguration configuration) : ControllerBase
{
    private string ApiOrigin => (configuration["App:ApiBaseUrl"] ?? $"{Request.Scheme}://{Request.Host}").TrimEnd('/');
    private string FrontendOrigin => (configuration["App:FrontendBaseUrl"] ?? "http://localhost:5173").TrimEnd('/');

    public record SaveWidgetRequest(string EmbedType, JsonElement Fields, string Theme);

    [HttpGet("api/admin/widget")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> Get(CancellationToken ct)
    {
        var workspaceId = User.GetWorkspaceId();
        var config = await db.WidgetConfigs.SingleOrDefaultAsync(w => w.WorkspaceId == workspaceId, ct)
                     ?? new WidgetConfig { WorkspaceId = workspaceId };
        var slug = await db.Workspaces.Where(w => w.Id == workspaceId).Select(w => w.Slug).SingleAsync(ct);
        return Ok(ToResponse(config, slug, includeSnippet: true));
    }

    [HttpPut("api/admin/widget")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> Save([FromBody] SaveWidgetRequest req, CancellationToken ct)
    {
        if (!WidgetEmbedType.All.Contains(req.EmbedType))
            return BadRequest(new { error = "Invalid embed type." });

        var workspaceId = User.GetWorkspaceId();
        var config = await db.WidgetConfigs.SingleOrDefaultAsync(w => w.WorkspaceId == workspaceId, ct);
        if (config is null)
        {
            config = new WidgetConfig { WorkspaceId = workspaceId };
            db.WidgetConfigs.Add(config);
        }
        config.EmbedType = req.EmbedType;
        config.Theme = req.Theme is "light" or "dark" ? req.Theme : "light";
        if (req.Fields.ValueKind is JsonValueKind.Object or JsonValueKind.Array)
            config.Fields = req.Fields.GetRawText();
        config.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        var slug = await db.Workspaces.Where(w => w.Id == workspaceId).Select(w => w.Slug).SingleAsync(ct);
        return Ok(ToResponse(config, slug, includeSnippet: true));
    }

    [HttpGet("api/public/workspaces/{slug}/widget")]
    public async Task<IActionResult> PublicConfig(string slug, CancellationToken ct)
    {
        var config = await db.WidgetConfigs
            .SingleOrDefaultAsync(w => w.Workspace!.Slug == slug, ct);
        if (config is null)
            return Ok(new { embedType = WidgetEmbedType.Floating, fields = ParseFields(null), theme = "light" });
        return Ok(new { embedType = config.EmbedType, fields = ParseFields(config.Fields), theme = config.Theme });
    }

    // The loader script. Reads its own data-* attributes and embeds the branded
    // submit form as a floating panel or inline iframe. Same-origin in prod.
    [HttpGet("widget.js")]
    public IActionResult Script()
    {
        Response.Headers.CacheControl = "public, max-age=300";
        return Content(WidgetJs, "application/javascript");
    }

    private object ToResponse(WidgetConfig c, string slug, bool includeSnippet)
    {
        var snippet = c.EmbedType == WidgetEmbedType.Link
            ? $"{FrontendOrigin}/submit?workspace={slug}"
            : $"<script src=\"{ApiOrigin}/widget.js\" data-workspace=\"{slug}\" data-embed=\"{c.EmbedType}\" data-theme=\"{c.Theme}\"></script>";
        return new
        {
            embedType = c.EmbedType,
            fields = ParseFields(c.Fields),
            theme = c.Theme,
            snippet = includeSnippet ? snippet : null,
        };
    }

    private static JsonElement ParseFields(string? json)
    {
        try { return JsonDocument.Parse(json ?? "{}").RootElement.Clone(); }
        catch (JsonException) { return JsonDocument.Parse("{}").RootElement.Clone(); }
    }

    private const string WidgetJs = """
(function () {
  var s = document.currentScript;
  if (!s) { var all = document.getElementsByTagName('script'); for (var i = 0; i < all.length; i++) { if (all[i].src && all[i].src.indexOf('widget.js') >= 0) { s = all[i]; break; } } }
  if (!s) return;
  var origin = new URL(s.src).origin;
  var ws = s.getAttribute('data-workspace'); if (!ws) return;
  var embed = s.getAttribute('data-embed') || 'floating';
  var qs = new URLSearchParams({ workspace: ws, embed: '1' });
  var nm = s.getAttribute('data-user-name'); if (nm) qs.set('name', nm);
  var em = s.getAttribute('data-user-email'); if (em) qs.set('email', em);
  var src = origin + '/submit?' + qs.toString();

  if (embed === 'inline') {
    var f = document.createElement('iframe');
    f.src = src;
    f.style.cssText = 'width:100%;max-width:520px;height:660px;border:0;border-radius:14px;box-shadow:0 8px 30px -8px rgba(15,23,42,.15);';
    s.parentNode.insertBefore(f, s.nextSibling);
    return;
  }

  var panel = null, open = false;
  var btn = document.createElement('button');
  btn.textContent = 'Support';
  btn.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483000;background:#4F46E5;color:#fff;border:0;border-radius:999px;padding:12px 20px;font:600 14px system-ui,sans-serif;box-shadow:0 8px 24px -6px rgba(79,70,229,.6);cursor:pointer;';
  btn.onclick = function () {
    if (!panel) {
      panel = document.createElement('iframe');
      panel.src = src;
      panel.style.cssText = 'position:fixed;bottom:76px;right:20px;z-index:2147483000;width:390px;max-width:calc(100vw - 40px);height:600px;max-height:calc(100vh - 120px);border:0;border-radius:16px;box-shadow:0 16px 48px -12px rgba(15,23,42,.35);background:#fff;';
      document.body.appendChild(panel);
      open = true;
    } else {
      open = !open;
      panel.style.display = open ? 'block' : 'none';
    }
  };
  document.body.appendChild(btn);
})();
""";
}
