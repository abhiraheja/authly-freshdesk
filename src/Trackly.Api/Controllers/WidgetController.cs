using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Trackly.Api.Auth;
using Trackly.Api.Widgets;
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

    /// <summary>
    /// The origin that actually serves <c>/widget.js</c>, for the snippet an
    /// admin pastes onto somebody else's site.
    ///
    /// <para>
    /// Normally the API's own origin, which is why this falls back to
    /// <see cref="ApiOrigin"/>. It is separately overridable because development
    /// is the one place where <c>App:ApiBaseUrl</c> is deliberately <i>not</i>
    /// the API: the SPA proxies <c>/api</c> so the two share an origin and the
    /// session cookie survives, and that proxy covers <c>/api</c> and
    /// <c>/hubs</c> only. A snippet naming the dev SPA would be copied onto a
    /// real site and fetch the SPA's index.html as JavaScript — which fails with
    /// no error anyone can act on.
    /// </para>
    /// </summary>
    private string WidgetScriptOrigin =>
        (configuration.GetNonEmpty("App:WidgetScriptBaseUrl") ?? ApiOrigin).TrimEnd('/');

    private WidgetOrigins Origins => new(WidgetScriptOrigin, FrontendOrigin);

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

    // The slug-addressed read a pre-phase-4 snippet still uses. It answers "which
    // widget does this workspace mean" so the loader can switch to the
    // token-addressed surface: `publicToken` is the only field the current loader
    // reads, and the three beside it are kept because an older loader is still
    // out there on somebody's page reading them.
    [HttpGet("api/public/workspaces/{slug}/widget")]
    [EnableCors(WidgetCors.Policy)]
    public async Task<IActionResult> PublicConfig(string slug, CancellationToken ct)
    {
        var config = await db.WidgetConfigs
            .Where(w => w.Workspace!.Slug == slug && w.IsActive)
            .OrderBy(w => w.CreatedAt)
            .FirstOrDefaultAsync(ct);
        if (config is null)
            return Ok(new { publicToken = (string?)null, embedType = WidgetEmbedType.Floating, fields = WidgetService.ParseFields(null), theme = "light" });
        return Ok(new
        {
            publicToken = config.PublicToken,
            embedType = config.EmbedType,
            fields = WidgetService.ParseFields(config.Fields),
            theme = config.Theme,
        });
    }

    /// <summary>
    /// The loader script (plan § 7). Served from the API so one URL works for
    /// every embedding site, and cached briefly — an operator who regenerates a
    /// widget should not wait an hour for pages to pick it up.
    /// </summary>
    [HttpGet("widget.js")]
    public IActionResult Script()
    {
        Response.Headers.CacheControl = "public, max-age=300";
        return Content(WidgetJs, "application/javascript");
    }

    // The loader, as served. ES5 on purpose: it runs on whatever page an operator's
    // customer happens to have, and a build step for thirty lines of DOM would put
    // a toolchain between an admin and their embed. See docs/widget-plan.md § 7.
    private const string WidgetJs = """
(function () {
  'use strict';

  // The script's own origin is the API. Everything else - where the panel lives,
  // what colour it is - comes from the config call, because the server is the
  // only side that knows it.
  var script = document.currentScript;
  if (!script) {
    var all = document.getElementsByTagName('script');
    for (var i = 0; i < all.length; i++) {
      if (all[i].src && all[i].src.indexOf('widget.js') >= 0) { script = all[i]; break; }
    }
  }
  var apiOrigin = script ? new URL(script.src, window.location.href).origin : window.location.origin;

  var LOADER = 'trackly-loader';
  var FRAME = 'trackly-widget';
  var Z = 2147483000;

  // Only these keys mean anything. A snippet copied from another vendor's docs
  // carries keys Trackly has never heard of; ignoring them silently is the point
  // - and `theme` is ignored *deliberately*: the panel is always light
  // (invariant 6, plan section 4.1).
  var OVERRIDES = {
    hide_launcher: 'hideLauncher',
    show_widget_form: 'showWidgetForm',
    show_close_button: 'showCloseButton',
    launch_widget: 'launchWidget',
    show_send_button: 'showSendButton'
  };
  var IDENTITY = ['unique_id', 'name', 'mail', 'number', 'token', 'variables'];

  var widget = null;

  function warn(message) {
    if (window.console && console.warn) console.warn('[Trackly] ' + message);
  }

  function getJson(url) {
    return fetch(url, { credentials: 'omit' }).then(function (res) {
      if (!res.ok) throw new Error(url + ' returned ' + res.status);
      return res.json();
    });
  }

  function identityOf(source) {
    var out = null;
    for (var i = 0; i < IDENTITY.length; i++) {
      var key = IDENTITY[i];
      if (source && source[key] !== undefined && source[key] !== null) {
        out = out || {};
        out[key] = source[key];
      }
    }
    return out;
  }

  // Admin defaults from the server, then the host page's per-page overrides
  // (plan section 3.2). The page wins because it knows things the admin screen
  // cannot - which route the visitor is on, whether they are mid-checkout.
  function merge(config, host) {
    var merged = {};
    for (var key in config) if (Object.prototype.hasOwnProperty.call(config, key)) merged[key] = config[key];
    for (var snake in OVERRIDES) {
      if (host && typeof host[snake] === 'boolean') merged[OVERRIDES[snake]] = host[snake];
    }
    return merged;
  }

  function create(token, host) {
    var w = {
      token: token,
      host: host || {},
      config: null,
      settings: null,
      frameOrigin: null,
      frame: null,
      launcher: null,
      badge: null,
      isOpen: false,
      expanded: false,
      ready: false,
      queue: []
    };

    getJson(apiOrigin + '/api/public/widget/' + encodeURIComponent(token) + '/config')
      .then(function (config) {
        w.config = config;
        w.settings = merge(config, w.host);
        w.frameOrigin = new URL(config.frameUrl, apiOrigin).origin;
        mount(w);
      })
      .catch(function (error) {
        // The commonest cause by far is an origin missing from the widget's
        // allowed-domains list, which returns 403. Say so rather than failing
        // mute: nothing renders either way, and a silent embed is unanswerable.
        warn('could not load widget ' + token + ' (' + error.message + '). ' +
             'If this site is not in the allowed domains for this widget, add it.');
      });

    return w;
  }

  function mount(w) {
    if (!w.settings.hideLauncher) buildLauncher(w);

    // Built hidden rather than on first open, so the panel is alive to hear
    // about a reply and report the unread count while it is shut (plan
    // section 7.2). With no launcher there is no badge to show, so there is
    // nothing to stay awake for - that case waits for openChatWidget().
    if (!w.settings.hideLauncher || w.settings.launchWidget) buildFrame(w);
    if (w.settings.launchWidget) open(w);
  }

  function buildLauncher(w) {
    var colour = w.config.primaryColor || '#2563EB';
    var button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', w.config.name || 'Support');
    button.style.cssText =
      'position:fixed;bottom:20px;right:20px;z-index:' + Z + ';width:56px;height:56px;' +
      'border:0;border-radius:999px;cursor:pointer;background:' + colour + ';color:#fff;' +
      'box-shadow:0 10px 30px -8px rgba(15,23,42,.45);display:flex;align-items:center;' +
      'justify-content:center;padding:0;transition:transform .15s ease;';
    button.innerHTML =
      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
    button.onmouseenter = function () { button.style.transform = 'scale(1.05)'; };
    button.onmouseleave = function () { button.style.transform = 'scale(1)'; };
    button.onclick = function () { toggle(w); };

    var badge = document.createElement('span');
    badge.style.cssText =
      'position:absolute;top:-2px;right:-2px;min-width:20px;height:20px;padding:0 5px;' +
      'border-radius:999px;background:#DC2626;color:#fff;font:700 11px/20px system-ui,sans-serif;' +
      'text-align:center;display:none;box-shadow:0 0 0 2px #fff;';
    button.appendChild(badge);

    document.body.appendChild(button);
    w.launcher = button;
    w.badge = badge;
  }

  function buildFrame(w) {
    if (w.frame) return;
    var frame = document.createElement('iframe');
    frame.src = w.config.frameUrl;
    frame.title = w.config.name || 'Support';
    frame.setAttribute('allow', 'clipboard-write');
    frame.style.cssText = collapsedStyle(false);
    document.body.appendChild(frame);
    w.frame = frame;
  }

  function collapsedStyle(visible) {
    return 'position:fixed;bottom:88px;right:20px;z-index:' + Z + ';width:400px;' +
      'max-width:calc(100vw - 40px);height:640px;max-height:calc(100vh - 120px);border:0;' +
      'border-radius:16px;box-shadow:0 20px 60px -15px rgba(15,23,42,.4);background:#fff;' +
      'display:' + (visible ? 'block' : 'none') + ';';
  }

  function expandedStyle() {
    return 'position:fixed;inset:0;top:0;left:0;width:100vw;height:100vh;z-index:' + Z +
      ';border:0;border-radius:0;background:#fff;display:block;';
  }

  function post(w, type, payload) {
    if (!w.frame || !w.frame.contentWindow || !w.frameOrigin) return;
    var message = { source: LOADER, type: type };
    if (payload) message.payload = payload;
    w.frame.contentWindow.postMessage(message, w.frameOrigin);
  }

  // Queued until the frame says it is listening. Without this an
  // identifyChatWidget() called on page load - the normal case, since that is
  // when a host page knows who its user is - lands before the frame exists and
  // the visitor is anonymous for the rest of the session.
  function send(w, type, payload) {
    if (w.ready) post(w, type, payload);
    else w.queue.push([type, payload]);
  }

  function open(w) {
    buildFrame(w);
    w.isOpen = true;
    w.frame.style.display = 'block';
    send(w, 'open');
    setBadge(w, 0);
  }

  function close(w) {
    if (!w.frame) return;
    w.isOpen = false;
    if (w.expanded) collapse(w);
    w.frame.style.display = 'none';
    send(w, 'close');
  }

  function toggle(w) { if (w.isOpen) close(w); else open(w); }

  function expand(w) {
    if (!w.frame) return;
    w.expanded = true;
    w.frame.style.cssText = expandedStyle();
    if (w.launcher) w.launcher.style.display = 'none';
  }

  function collapse(w) {
    if (!w.frame) return;
    w.expanded = false;
    w.frame.style.cssText = collapsedStyle(w.isOpen);
    if (w.launcher) w.launcher.style.display = 'flex';
  }

  function setBadge(w, count) {
    if (!w.badge) return;
    w.badge.textContent = count > 9 ? '9+' : String(count);
    w.badge.style.display = count > 0 ? 'block' : 'none';
  }

  window.addEventListener('message', function (event) {
    var w = widget;
    if (!w || !w.frame || !w.frameOrigin) return;
    // Both checks matter. The origin alone would trust any frame from the panel's
    // host; the source alone would trust a frame that navigated somewhere else.
    if (event.origin !== w.frameOrigin) return;
    if (event.source !== w.frame.contentWindow) return;

    var data = event.data;
    if (!data || data.source !== FRAME || !data.type) return;
    var payload = data.payload || {};

    switch (data.type) {
      case 'ready':
        w.ready = true;
        post(w, 'config', { config: w.settings, identity: identityOf(w.host) });
        while (w.queue.length) { var q = w.queue.shift(); post(w, q[0], q[1]); }
        if (w.isOpen) post(w, 'open');
        break;
      case 'resize':
        // Only meaningful while docked; full screen is already the viewport.
        if (!w.expanded && typeof payload.height === 'number') {
          w.frame.style.height = Math.max(320, Math.min(payload.height, window.innerHeight - 120)) + 'px';
        }
        break;
      case 'open': open(w); break;
      case 'close': close(w); break;
      case 'expand': expand(w); break;
      case 'collapse': collapse(w); break;
      case 'unread':
        // A count, never a command. The panel does not open itself on a reply -
        // launch_widget governs first load only (plan section 8.1).
        setBadge(w, typeof payload.count === 'number' ? payload.count : 0);
        break;
      default: break;
    }
  }, false);

  // ---- Public API (plan section 7.1) ----------------------------------------

  function initChatWidget(config, index) {
    config = config || {};
    if (index) warn('only widget index 0 is supported; ignoring index ' + index);
    var token = config.widgetToken || config.widget_token;
    if (!token) { warn('initChatWidget needs a widgetToken'); return; }
    if (widget) {
      // A second init is how a single-page host app tells the widget the route
      // changed. Treated as a re-identify rather than a second launcher.
      widget.host = config;
      identifyChatWidget(config);
      return;
    }
    widget = create(token, config);
  }

  function openChatWidget() { if (widget) open(widget); }
  function closeChatWidget() { if (widget) close(widget); }

  function identifyChatWidget(payload) {
    if (!widget) { warn('identifyChatWidget called before initChatWidget'); return; }
    var identity = identityOf(payload || {});
    if (!identity) return;
    send(widget, 'identify', { identity: identity });
  }

  window.initChatWidget = initChatWidget;
  window.openChatWidget = openChatWidget;
  window.closeChatWidget = closeChatWidget;
  window.identifyChatWidget = identifyChatWidget;

  // ---- Back-compatibility (plan section 7.3) --------------------------------
  // Snippets written before this rewrite carry data-* attributes and never call
  // initChatWidget. They keep working: the tag names either the widget or the
  // workspace, and the loader self-initialises one tick later - after any inline
  // init on the page has had its chance to run first.
  setTimeout(function () {
    if (widget || !script) return;

    var host = {};
    var name = script.getAttribute('data-user-name');
    var mail = script.getAttribute('data-user-email');
    if (name) host.name = name;
    if (mail) host.mail = mail;

    var token = script.getAttribute('data-widget');
    if (token) { host.widgetToken = token; initChatWidget(host, 0); return; }

    var slug = script.getAttribute('data-workspace');
    if (!slug) {
      // Also covers a deferred widget.js: the page assigned its config object
      // before this file ran, so the inline initChatWidget call threw.
      if (window.tracklyConfig) initChatWidget(window.tracklyConfig, 0);
      return;
    }

    getJson(apiOrigin + '/api/public/workspaces/' + encodeURIComponent(slug) + '/widget')
      .then(function (legacy) {
        if (!legacy || !legacy.publicToken) { warn('workspace ' + slug + ' has no active widget'); return; }
        host.widgetToken = legacy.publicToken;
        initChatWidget(host, 0);
      })
      .catch(function (error) { warn('could not resolve workspace ' + slug + ': ' + error.message); });
  }, 0);
})();
""";
}
