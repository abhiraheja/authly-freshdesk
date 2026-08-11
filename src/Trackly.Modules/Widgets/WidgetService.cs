using System.IdentityModel.Tokens.Jwt;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Trackly.Core.Entities;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Auth;

namespace Trackly.Modules.Widgets;

/// <summary>
/// Admin-side management of embeddable widgets. A workspace runs as many as it
/// has surfaces to embed one on; each is addressed publicly by its
/// <see cref="WidgetConfig.PublicToken"/>.
///
/// <para>
/// Every query here is workspace-scoped through <see cref="Visible"/>
/// (invariant 1). Public, token-addressed reads are a different surface and do
/// not live in this class.
/// </para>
/// </summary>
public class WidgetService(
    TracklyDbContext db, ISecretProtector protector, IWorkspaceFileStorage storage)
{
    private IQueryable<WidgetConfig> Visible(Actor actor) =>
        db.WidgetConfigs.Where(w => w.WorkspaceId == actor.WorkspaceId);

    public async Task<IReadOnlyList<WidgetSummaryDto>> ListAsync(Actor actor, CancellationToken ct)
        => await Visible(actor)
            .OrderBy(w => w.CreatedAt)
            .Select(w => new WidgetSummaryDto(
                w.Id, w.Name, w.Tagline, w.PublicToken, w.IsActive,
                w.IdentityVerificationEnabled, w.PrimaryColor,
                w.TeamId, w.Team != null ? w.Team.Name : null,
                db.WidgetVisitors.Where(v => v.WidgetId == w.Id)
                    .Max(v => (DateTime?)v.LastSeenAt),
                w.CreatedAt, w.UpdatedAt))
            .ToListAsync(ct);

    public async Task<WidgetDetailDto?> GetAsync(Actor actor, Guid id, WidgetOrigins origins, CancellationToken ct)
    {
        var widget = await Visible(actor).Include(w => w.Team)
            .SingleOrDefaultAsync(w => w.Id == id, ct);
        return widget is null ? null : await ToDetailAsync(widget, origins, ct);
    }

    /// <summary>
    /// The token-addressed lookup the singular <c>/api/admin/widget</c> shim and
    /// the first-run path both need: a workspace's default widget, created on
    /// demand so an install that has never opened the screen still has one.
    /// </summary>
    public async Task<WidgetConfig> GetOrCreateDefaultAsync(Actor actor, CancellationToken ct)
    {
        var existing = await Visible(actor).OrderBy(w => w.CreatedAt).FirstOrDefaultAsync(ct);
        if (existing is not null) return existing;

        var widget = NewWidget(actor.WorkspaceId, "Support");
        db.WidgetConfigs.Add(widget);
        await db.SaveChangesAsync(ct);
        return widget;
    }

    public async Task<WidgetSecretDto> CreateAsync(
        Actor actor, SaveWidgetRequest req, WidgetOrigins origins, CancellationToken ct)
    {
        var widget = NewWidget(actor.WorkspaceId, req.Name);
        var secret = TokenUtils.GenerateToken();
        widget.SecretKeyEncrypted = protector.Protect(secret);

        await ApplyAsync(actor, widget, req, ct);
        db.WidgetConfigs.Add(widget);
        await db.SaveChangesAsync(ct);

        await db.Entry(widget).Reference(w => w.Team).LoadAsync(ct);
        return new WidgetSecretDto(await ToDetailAsync(widget, origins, ct), secret);
    }

    public async Task<WidgetDetailDto?> UpdateAsync(
        Actor actor, Guid id, SaveWidgetRequest req, WidgetOrigins origins, CancellationToken ct)
    {
        var widget = await Visible(actor).SingleOrDefaultAsync(w => w.Id == id, ct);
        if (widget is null) return null;

        await ApplyAsync(actor, widget, req, ct);
        widget.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        await db.Entry(widget).Reference(w => w.Team).LoadAsync(ct);
        return await ToDetailAsync(widget, origins, ct);
    }

    public async Task<bool> DeleteAsync(Actor actor, Guid id, CancellationToken ct)
    {
        var widget = await Visible(actor).SingleOrDefaultAsync(w => w.Id == id, ct);
        if (widget is null) return false;

        // The visitors cascade with the widget and their tickets are detached
        // (widget_visitor_id SET NULL) rather than deleted — support history
        // outlives the config row that produced it. See the Ticket mapping.
        db.WidgetConfigs.Remove(widget);
        await db.SaveChangesAsync(ct);

        // The row is gone, so nothing will ever name this key again. Storage has
        // no foreign keys to cascade through — an orphan here is a file that
        // outlives the workspace's own record of it.
        if (widget.LogoStorageKey is not null)
            await storage.DeleteAsync(actor.WorkspaceId, widget.LogoStorageKey, ct);
        return true;
    }

    // ---- Per-widget logo -----------------------------------------------------
    // A widget may carry its own mark — a product microsite, a partner-branded
    // embed — and setting one here must never touch workspace_branding, which
    // also dresses the sign-in page, the portal and every outbound email. Null
    // means inherit; clearing falls straight back to the workspace's logo.

    public async Task<WidgetDetailDto?> SetLogoAsync(
        Actor actor, Guid id, Stream content, string fileName, string contentType,
        WidgetOrigins origins, CancellationToken ct)
    {
        var widget = await Visible(actor).Include(w => w.Team).SingleOrDefaultAsync(w => w.Id == id, ct);
        if (widget is null) return null;

        var oldKey = widget.LogoStorageKey;
        // Public: it is fetched by browsers on sites Trackly does not control.
        widget.LogoStorageKey = await storage.SaveAsync(
            actor.WorkspaceId, $"{actor.WorkspaceId}/widgets/{widget.Id}", fileName, content,
            StorageVisibility.Public, ct);
        widget.LogoContentType = contentType;
        widget.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        // After the save: deleting first would leave the widget with no logo at
        // all if the write then failed.
        if (oldKey is not null)
            await storage.DeleteAsync(actor.WorkspaceId, oldKey, ct);
        return await ToDetailAsync(widget, origins, ct);
    }

    public async Task<WidgetDetailDto?> ClearLogoAsync(
        Actor actor, Guid id, WidgetOrigins origins, CancellationToken ct)
    {
        var widget = await Visible(actor).Include(w => w.Team).SingleOrDefaultAsync(w => w.Id == id, ct);
        if (widget is null) return null;

        var oldKey = widget.LogoStorageKey;
        widget.LogoStorageKey = null;
        widget.LogoContentType = null;
        widget.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        if (oldKey is not null)
            await storage.DeleteAsync(actor.WorkspaceId, oldKey, ct);
        return await ToDetailAsync(widget, origins, ct);
    }

    /// <summary>
    /// Mints a new secret and returns it in plaintext for the only time it is
    /// ever readable. Every host page signing JWTs with the old one stops
    /// verifying immediately — there is no overlap window, which is the point of
    /// a regenerate.
    /// </summary>
    public async Task<WidgetSecretDto?> RegenerateSecretAsync(
        Actor actor, Guid id, WidgetOrigins origins, CancellationToken ct)
    {
        var widget = await Visible(actor).Include(w => w.Team)
            .SingleOrDefaultAsync(w => w.Id == id, ct);
        if (widget is null) return null;

        var secret = TokenUtils.GenerateToken();
        widget.SecretKeyEncrypted = protector.Protect(secret);
        widget.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        return new WidgetSecretDto(await ToDetailAsync(widget, origins, ct), secret);
    }

    public async Task<VerifyJwtResultDto?> VerifyJwtAsync(Actor actor, Guid id, string token, CancellationToken ct)
    {
        var widget = await Visible(actor).SingleOrDefaultAsync(w => w.Id == id, ct);
        if (widget is null) return null;
        if (widget.SecretKeyEncrypted is null)
            return Invalid("This widget has no secret key yet. Regenerate one first.");

        if (string.IsNullOrWhiteSpace(token))
            return Invalid("No token supplied.");

        var result = VerifyIdentityToken(token.Trim(), protector.Unprotect(widget.SecretKeyEncrypted));
        return result;
    }

    /// <summary>
    /// HS256 against the widget's own secret. This is the check the trust rule
    /// (docs/widget-plan.md § 3.3) turns on, so it is deliberately strict:
    /// HS256 only — which is what rejects <c>alg: none</c> and the RS256→HS256
    /// confusion trick — an <c>exp</c> is required, and 60 seconds of clock skew
    /// is all a host page's server gets.
    /// </summary>
    public static VerifyJwtResultDto VerifyIdentityToken(string token, string secret)
    {
        var handler = new JwtSecurityTokenHandler { MapInboundClaims = false };
        if (!handler.CanReadToken(token))
            return Invalid("Not a readable JWT.");

        var parameters = new TokenValidationParameters
        {
            ValidateIssuer = false,
            ValidateAudience = false,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret)),
            ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
            RequireExpirationTime = true,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromSeconds(60),
        };

        try
        {
            handler.ValidateToken(token, parameters, out var validated);
            var jwt = (JwtSecurityToken)validated;

            var claims = jwt.Claims
                .GroupBy(c => c.Type)
                .ToDictionary(g => g.Key, g => string.Join(", ", g.Select(c => c.Value)));

            // `unique_id` is the snippet's own spelling; `sub` is what anyone
            // reaching for a JWT library writes by habit. Accept either.
            var uniqueId = claims.GetValueOrDefault("unique_id") ?? claims.GetValueOrDefault("sub");
            if (string.IsNullOrWhiteSpace(uniqueId))
                return Invalid("Signature is valid but the token carries no unique_id (or sub) claim.");

            return new VerifyJwtResultDto(
                true, null, uniqueId,
                jwt.IssuedAt == default ? null : jwt.IssuedAt,
                jwt.ValidTo == default ? null : jwt.ValidTo,
                claims);
        }
        catch (SecurityTokenExpiredException)
        {
            return Invalid("Token has expired.");
        }
        catch (SecurityTokenInvalidSignatureException)
        {
            return Invalid("Signature does not match this widget's secret key.");
        }
        catch (SecurityTokenException e)
        {
            return Invalid(e.Message);
        }
        catch (ArgumentException e)
        {
            // Malformed segments surface here rather than as a token exception.
            return Invalid(e.Message);
        }
    }

    private static VerifyJwtResultDto Invalid(string error)
        => new(false, error, null, null, null, new Dictionary<string, string>());

    // ---- writes -------------------------------------------------------------

    private static WidgetConfig NewWidget(Guid workspaceId, string? name) => new()
    {
        WorkspaceId = workspaceId,
        Name = string.IsNullOrWhiteSpace(name) ? "Support" : name.Trim(),
        PublicToken = TokenUtils.GenerateShortToken(),
    };

    private async Task ApplyAsync(Actor actor, WidgetConfig w, SaveWidgetRequest req, CancellationToken ct)
    {
        if (req.Name is not null)
        {
            if (string.IsNullOrWhiteSpace(req.Name))
                throw new ArgumentException("Widget name is required.");
            w.Name = req.Name.Trim();
        }

        if (req.Tagline is not null) w.Tagline = Trimmed(req.Tagline);
        if (req.Greeting is not null) w.Greeting = Trimmed(req.Greeting);
        if (req.IsActive is { } active) w.IsActive = active;

        if (req.ClearPrimaryColor) w.PrimaryColor = null;
        else if (req.PrimaryColor is not null) w.PrimaryColor = NormaliseColor(req.PrimaryColor);

        if (req.ClearTeam) w.TeamId = null;
        else if (req.TeamId is { } teamId)
        {
            var exists = await db.Teams.AnyAsync(
                t => t.Id == teamId && t.WorkspaceId == actor.WorkspaceId, ct);
            if (!exists) throw new ArgumentException("Team not found.");
            w.TeamId = teamId;
        }

        if (req.IdentityVerificationEnabled is { } idv)
        {
            // Turning it on without a key would reject every visitor the host
            // page identifies, which looks like a Trackly bug from the outside.
            if (idv && w.SecretKeyEncrypted is null)
                throw new ArgumentException("Generate a secret key before enabling identity verification.");
            w.IdentityVerificationEnabled = idv;
        }

        if (req.HideLauncher is { } hide) w.HideLauncher = hide;
        if (req.LaunchWidget is { } launch) w.LaunchWidget = launch;
        if (req.ShowWidgetForm is { } form) w.ShowWidgetForm = form;
        if (req.ShowCloseButton is { } close) w.ShowCloseButton = close;
        if (req.ShowSendButton is { } send) w.ShowSendButton = send;
        if (req.RequireEmailVerification is { } verify) w.RequireEmailVerification = verify;

        if (req.AllowedOrigins is not null) w.AllowedOrigins = NormaliseOrigins(req.AllowedOrigins);

        if (req.EmbedType is not null)
        {
            if (!WidgetEmbedType.All.Contains(req.EmbedType))
                throw new ArgumentException("Invalid embed type.");
            w.EmbedType = req.EmbedType;
        }

        if (req.Fields is { } fields && fields.ValueKind is JsonValueKind.Object or JsonValueKind.Array)
            w.Fields = fields.GetRawText();

        // Stored so old snippets round-trip; the panel is always light either way
        // (invariant 6).
        if (req.Theme is not null) w.Theme = req.Theme is "light" or "dark" ? req.Theme : "light";
    }

    private static string? Trimmed(string value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static string? NormaliseColor(string value)
    {
        var color = value.Trim();
        if (color.Length == 0) return null;
        if (!color.StartsWith('#')) color = "#" + color;
        // Anything else would be interpolated into a style attribute on a page
        // Trackly does not control.
        if (!System.Text.RegularExpressions.Regex.IsMatch(color, "^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$"))
            throw new ArgumentException("Colour must be a hex value such as #1c65d4.");
        return color.ToLowerInvariant();
    }

    /// <summary>
    /// Stored newline-separated, one scheme+host+port per line. Anything with a
    /// path or a trailing slash is reduced to its origin, because that is what
    /// an <c>Origin</c> header will actually carry when the check runs.
    /// </summary>
    private static string? NormaliseOrigins(IReadOnlyList<string> origins)
    {
        var cleaned = new List<string>();
        foreach (var raw in origins)
        {
            var value = raw?.Trim();
            if (string.IsNullOrEmpty(value)) continue;
            if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
                uri.Scheme is not ("http" or "https"))
                throw new ArgumentException($"'{value}' is not a valid origin — use the full form, e.g. https://acme.com.");
            var origin = uri.IsDefaultPort
                ? $"{uri.Scheme}://{uri.Host}"
                : $"{uri.Scheme}://{uri.Host}:{uri.Port}";
            if (!cleaned.Contains(origin)) cleaned.Add(origin);
        }
        return cleaned.Count == 0 ? null : string.Join('\n', cleaned);
    }

    public static IReadOnlyList<string> SplitOrigins(string? stored)
        => string.IsNullOrWhiteSpace(stored)
            ? []
            : stored.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    // ---- reads --------------------------------------------------------------

    private async Task<WidgetDetailDto> ToDetailAsync(WidgetConfig w, WidgetOrigins origins, CancellationToken ct)
    {
        var slug = await db.Workspaces.Where(x => x.Id == w.WorkspaceId).Select(x => x.Slug).SingleAsync(ct);
        return new WidgetDetailDto(
            w.Id, w.Name, w.Tagline, w.Greeting, w.PublicToken, w.IsActive,
            w.IdentityVerificationEnabled,
            w.SecretKeyEncrypted is not null,
            Mask(w.SecretKeyEncrypted),
            w.PrimaryColor, w.LogoStorageKey is not null, w.TeamId, w.Team?.Name,
            w.HideLauncher, w.LaunchWidget, w.ShowWidgetForm, w.ShowCloseButton, w.ShowSendButton,
            w.RequireEmailVerification, SplitOrigins(w.AllowedOrigins),
            w.EmbedType, ParseFields(w.Fields), w.Theme,
            BuildSnippet(w, slug, origins),
            w.CreatedAt, w.UpdatedAt);
    }

    /// <summary>
    /// First and last four characters of the plaintext, as the reference product
    /// shows it. Enough to tell two keys apart in a screenshot, not enough to
    /// sign anything.
    /// </summary>
    private string? Mask(string? encrypted)
    {
        if (encrypted is null) return null;
        string plain;
        try { plain = protector.Unprotect(encrypted); }
        catch (System.Security.Cryptography.CryptographicException)
        {
            // Wrong Security:MasterKey — say so rather than throwing on a page
            // whose whole job is to show the admin what is configured.
            return "unreadable";
        }
        return plain.Length <= 8 ? new string('•', plain.Length) : $"{plain[..4]}…{plain[^4..]}";
    }

    /// <summary>
    /// The Integration tab's snippet — the <c>initChatWidget</c> form of
    /// docs/widget-plan.md § 7.1, since phase 4.
    ///
    /// <para>
    /// Only the token is emitted. Every launch default is already the admin's,
    /// set on the screen the snippet is being copied from, and baking them into
    /// the markup would freeze them there: an admin who later unticked "hide
    /// launcher" would find every embedded page still overriding it. The commented
    /// keys show the host page what it <i>may</i> override, which is a different
    /// thing from Trackly asserting it.
    /// </para>
    /// <para>
    /// The old <c>data-*</c> form keeps working — the loader still self-initialises
    /// from <c>data-widget</c> or <c>data-workspace</c> (§ 7.3) — but is no longer
    /// generated for anyone new.
    /// </para>
    /// </summary>
    public static string BuildSnippet(WidgetConfig w, string slug, WidgetOrigins origins)
        => w.EmbedType == WidgetEmbedType.Link
            ? $"{origins.Frontend}/submit?workspace={slug}"
            : $$"""
                 <script type="text/javascript" src="{{origins.Api}}/widget.js"></script>
                 <script type="text/javascript">
                   var tracklyConfig = {
                     widgetToken: "{{w.PublicToken}}",
                     // variables: { plan: "pro", account_id: "8842" },
                     // unique_id: "...", name: "...", mail: "...", number: "...",
                     // token: "<JWT signed with the widget secret>",
                   };
                   initChatWidget(tracklyConfig, 0);
                 </script>
                 """;

    public static JsonElement ParseFields(string? json)
    {
        try { return JsonDocument.Parse(json ?? "{}").RootElement.Clone(); }
        catch (JsonException) { return JsonDocument.Parse("{}").RootElement.Clone(); }
    }
}
