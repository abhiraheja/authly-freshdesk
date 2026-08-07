using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Trackly.Api.Auth;
using Trackly.Core.Entities;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;

namespace Trackly.Api.Controllers;

// Admin-only attachment storage configuration. Credentials are never returned —
// the response exposes has*Credentials booleans instead (invariant 3). On
// update, a secret left null keeps the stored value, "" clears it, and anything
// else is AES-256-GCM encrypted before storage.
[ApiController]
[Authorize(Policy = "Admin")]
public class StorageSettingsController(
    TracklyDbContext db,
    ISecretProtector secrets,
    IWorkspaceFileStorage storage) : ControllerBase
{
    public record UpdateStorageConfigRequest(
        string Provider,
        string? AzureConnectionString,
        string? AzureContainer,
        string? GcsCredentialsJson,
        string? GcsBucket,
        string? PathPrefix,
        string? PublicBaseUrl);

    [HttpGet("api/admin/settings/storage")]
    public async Task<IActionResult> Get(CancellationToken ct)
        => Ok(ToResponse(await GetOrCreateAsync(ct)));

    [HttpPut("api/admin/settings/storage")]
    public async Task<IActionResult> Update([FromBody] UpdateStorageConfigRequest req, CancellationToken ct)
    {
        if (!StorageProviders.All.Contains(req.Provider))
            return BadRequest(new { error = "Unknown storage provider." });

        // The service-account key is pasted or uploaded by hand, so a truncated
        // paste is likely. Rejecting it here beats storing it and failing on the
        // next upload, when the admin has moved on and the error looks unrelated.
        if (!string.IsNullOrEmpty(req.GcsCredentialsJson) && !IsServiceAccountJson(req.GcsCredentialsJson))
            return BadRequest(new { error = "That does not look like a GCP service-account key: expected JSON with a private_key and client_email." });

        var publicBaseUrl = NullIfEmpty(req.PublicBaseUrl)?.TrimEnd('/');
        if (publicBaseUrl is not null && !IsAbsoluteHttpUrl(publicBaseUrl))
            return BadRequest(new { error = "The CDN URL must be absolute and start with http:// or https://." });

        var config = await GetOrCreateAsync(ct);

        config.AzureConnectionStringEncrypted = ApplySecret(config.AzureConnectionStringEncrypted, req.AzureConnectionString);
        config.AzureContainer = NullIfEmpty(req.AzureContainer);
        config.GcsCredentialsJsonEncrypted = ApplySecret(config.GcsCredentialsJsonEncrypted, req.GcsCredentialsJson);
        config.GcsBucket = NullIfEmpty(req.GcsBucket);
        // Trimmed of slashes so "trackly", "/trackly" and "trackly/" all produce
        // the same object names — otherwise a stray slash yields "//" in a key.
        config.PathPrefix = NullIfEmpty(req.PathPrefix)?.Trim('/');
        config.PublicBaseUrl = publicBaseUrl;

        // Refuse to switch to a provider that cannot work yet: saving it would
        // silently break every upload from that moment on.
        var missing = MissingFor(req.Provider, config);
        if (missing is not null)
            return BadRequest(new { error = $"Cannot switch to this provider: {missing} is missing." });

        // A CDN in front of local disk has no bucket to point at.
        if (config.PublicBaseUrl is not null && req.Provider == StorageProviders.Local)
            return BadRequest(new { error = "A CDN needs a cloud provider — local disk has no bucket to put one in front of." });

        var providerChanged = config.Provider != req.Provider;
        config.Provider = req.Provider;
        if (providerChanged) config.LastVerifiedAt = null;
        config.UpdatedAt = DateTime.UtcNow;

        await db.SaveChangesAsync(ct);
        return Ok(ToResponse(config));
    }

    /// <summary>
    /// Round-trips a small probe object through the CURRENTLY SAVED settings.
    /// </summary>
    /// <remarks>
    /// Writes, reads back and deletes, because the three need different
    /// permissions and a credential that can only write would otherwise look
    /// healthy right up until someone opens an attachment.
    /// </remarks>
    [HttpPost("api/admin/settings/storage/test")]
    public async Task<IActionResult> Test(CancellationToken ct)
    {
        var workspaceId = User.GetWorkspaceId();
        var config = await GetOrCreateAsync(ct);
        var probe = $"Trackly storage check {DateTime.UtcNow:O}";
        string? key = null;

        try
        {
            await using var content = new MemoryStream(Encoding.UTF8.GetBytes(probe));
            // Private on purpose: this proves the bucket that actually holds
            // attachments works, which is the one that matters.
            key = await storage.SaveAsync(
                workspaceId, $"{workspaceId}/_healthcheck", "probe.txt", content, StorageVisibility.Private, ct);

            await using var readBack = await storage.OpenReadAsync(workspaceId, key, ct);
            using var reader = new StreamReader(readBack);
            if (await reader.ReadToEndAsync(ct) != probe)
                return Ok(new { ok = false, error = "The file was written but read back different content." });

            config.LastVerifiedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            return Ok(new { ok = true, provider = config.Provider, verifiedAt = config.LastVerifiedAt });
        }
        catch (Exception e)
        {
            // The provider's own message is far more useful than anything we
            // could phrase ("container not found", "403 insufficient scopes").
            return Ok(new { ok = false, error = e.Message });
        }
        finally
        {
            if (key is not null)
            {
                // Never let cleanup turn a passing test into a failing one.
                try { await storage.DeleteAsync(workspaceId, key, ct); } catch { }
            }
        }
    }

    // ---- Helpers -------------------------------------------------------------

    private async Task<StorageConfig> GetOrCreateAsync(CancellationToken ct)
    {
        var workspaceId = User.GetWorkspaceId();
        var config = await db.StorageConfigs.SingleOrDefaultAsync(c => c.WorkspaceId == workspaceId, ct);
        if (config is null)
        {
            config = new StorageConfig { WorkspaceId = workspaceId };
            db.StorageConfigs.Add(config);
        }
        return config;
    }

    private static string? MissingFor(string provider, StorageConfig config) => provider switch
    {
        StorageProviders.Azure when string.IsNullOrEmpty(config.AzureConnectionStringEncrypted) => "the Azure connection string",
        StorageProviders.Azure when string.IsNullOrWhiteSpace(config.AzureContainer) => "the Azure container name",
        StorageProviders.Gcs when string.IsNullOrEmpty(config.GcsCredentialsJsonEncrypted) => "the GCP service-account key",
        StorageProviders.Gcs when string.IsNullOrWhiteSpace(config.GcsBucket) => "the GCS bucket name",
        _ => null,
    };

    private static bool IsAbsoluteHttpUrl(string value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);

    private static bool IsServiceAccountJson(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            return root.ValueKind == JsonValueKind.Object
                && root.TryGetProperty("private_key", out _)
                && root.TryGetProperty("client_email", out _);
        }
        catch (JsonException)
        {
            return false;
        }
    }

    // null → keep existing, "" → clear, otherwise encrypt.
    private string? ApplySecret(string? existing, string? incoming) => incoming switch
    {
        null => existing,
        "" => null,
        _ => secrets.Protect(incoming),
    };

    private static object ToResponse(StorageConfig c) => new
    {
        provider = c.Provider,
        azureContainer = c.AzureContainer,
        hasAzureConnectionString = !string.IsNullOrEmpty(c.AzureConnectionStringEncrypted),
        gcsBucket = c.GcsBucket,
        hasGcsCredentials = !string.IsNullOrEmpty(c.GcsCredentialsJsonEncrypted),
        pathPrefix = c.PathPrefix,
        publicBaseUrl = c.PublicBaseUrl,
        lastVerifiedAt = c.LastVerifiedAt,
        updatedAt = c.UpdatedAt,
    };

    private static string? NullIfEmpty(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
