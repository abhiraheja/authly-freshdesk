using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Trackly.Api.Auth;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Widgets;

namespace Trackly.Api.Controllers;

// Embeddable widget: admin CRUD over a workspace's widgets, the public config
// the loader reads, and the served widget.js. The widget renders the
// workspace-branded surface (invariant 6) in a same-origin iframe.
[ApiController]
public class WidgetController(
    TracklyDbContext db, WidgetService widgets, IConfiguration configuration) : ControllerBase
{
    private string ApiOrigin => (configuration.GetNonEmpty("App:ApiBaseUrl") ?? $"{Request.Scheme}://{Request.Host}").TrimEnd('/');
    private string FrontendOrigin => (configuration.GetNonEmpty("App:FrontendBaseUrl") ?? "http://localhost:5173").TrimEnd('/');
    private WidgetOrigins Origins => new(ApiOrigin, FrontendOrigin);

    // ---- Admin: many widgets ------------------------------------------------

    [HttpGet("api/admin/widgets")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> List(CancellationToken ct)
        => Ok(await widgets.ListAsync(User.GetActor(), ct));

    [HttpPost("api/admin/widgets")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> Create([FromBody] SaveWidgetRequest req, CancellationToken ct)
        => StatusCode(StatusCodes.Status201Created,
            await widgets.CreateAsync(User.GetActor(), req, Origins, ct));

    [HttpGet("api/admin/widgets/{id:guid}")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> Detail(Guid id, CancellationToken ct)
    {
        var widget = await widgets.GetAsync(User.GetActor(), id, Origins, ct);
        return widget is null ? NotFound() : Ok(widget);
    }

    [HttpPut("api/admin/widgets/{id:guid}")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> Update(Guid id, [FromBody] SaveWidgetRequest req, CancellationToken ct)
    {
        var widget = await widgets.UpdateAsync(User.GetActor(), id, req, Origins, ct);
        return widget is null ? NotFound() : Ok(widget);
    }

    [HttpDelete("api/admin/widgets/{id:guid}")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
        => await widgets.DeleteAsync(User.GetActor(), id, ct) ? NoContent() : NotFound();

    // The plaintext secret exists in a response exactly here and on create.
    [HttpPost("api/admin/widgets/{id:guid}/secret")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> RegenerateSecret(Guid id, CancellationToken ct)
    {
        var result = await widgets.RegenerateSecretAsync(User.GetActor(), id, Origins, ct);
        return result is null ? NotFound() : Ok(result);
    }

    // The Configuration tab's "Verify JWT" tool. Always 200 when the widget
    // exists: a token that fails to validate is a correct answer, not an error.
    [HttpPost("api/admin/widgets/{id:guid}/verify-jwt")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> VerifyJwt(Guid id, [FromBody] VerifyJwtRequest req, CancellationToken ct)
    {
        var result = await widgets.VerifyJwtAsync(User.GetActor(), id, req.Token, ct);
        return result is null ? NotFound() : Ok(result);
    }

    // ---- Admin: the singular shim -------------------------------------------
    // Kept for one release so the retiring React screen keeps working while the
    // Angular screen (phase 6) is built. It reads and writes the workspace's
    // first widget and returns the pre-reshape response shape verbatim.

    public record SaveLegacyWidgetRequest(string EmbedType, JsonElement Fields, string Theme);

    [HttpGet("api/admin/widget")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> Get(CancellationToken ct)
    {
        var widget = await widgets.GetOrCreateDefaultAsync(User.GetActor(), ct);
        return Ok(await LegacyResponseAsync(widget, ct));
    }

    [HttpPut("api/admin/widget")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> Save([FromBody] SaveLegacyWidgetRequest req, CancellationToken ct)
    {
        var actor = User.GetActor();
        var widget = await widgets.GetOrCreateDefaultAsync(actor, ct);
        await widgets.UpdateAsync(
            actor, widget.Id,
            new SaveWidgetRequest(EmbedType: req.EmbedType, Fields: req.Fields, Theme: req.Theme),
            Origins, ct);
        return Ok(await LegacyResponseAsync(widget, ct));
    }

    private async Task<object> LegacyResponseAsync(WidgetConfig w, CancellationToken ct)
    {
        var slug = await db.Workspaces.Where(x => x.Id == w.WorkspaceId).Select(x => x.Slug).SingleAsync(ct);
        return new
        {
            embedType = w.EmbedType,
            fields = WidgetService.ParseFields(w.Fields),
            theme = w.Theme,
            snippet = WidgetService.BuildSnippet(w, slug, Origins),
        };
    }

    // ---- Public -------------------------------------------------------------

    // The slug-addressed read the deployed loader still uses. Token-addressed
    // public config arrives in phase 2; this one resolves the workspace's first
    // active widget so an old snippet keeps rendering after the reshape.
    [HttpGet("api/public/workspaces/{slug}/widget")]
    public async Task<IActionResult> PublicConfig(string slug, CancellationToken ct)
    {
        var config = await db.WidgetConfigs
            .Where(w => w.Workspace!.Slug == slug && w.IsActive)
            .OrderBy(w => w.CreatedAt)
            .FirstOrDefaultAsync(ct);
        if (config is null)
            return Ok(new { embedType = WidgetEmbedType.Floating, fields = WidgetService.ParseFields(null), theme = "light" });
        return Ok(new
        {
            embedType = config.EmbedType,
            fields = WidgetService.ParseFields(config.Fields),
            theme = config.Theme,
        });
    }

    // The loader script. Reads its own data-* attributes and embeds the branded
    // submit form as a floating panel or inline iframe. Same-origin in prod.
    // Rewritten in phase 4 into the initChatWidget contract (plan § 7.1).
    [HttpGet("widget.js")]
    public IActionResult Script()
    {
        Response.Headers.CacheControl = "public, max-age=300";
        return Content(WidgetJs, "application/javascript");
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
