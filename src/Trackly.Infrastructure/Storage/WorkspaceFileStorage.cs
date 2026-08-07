using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;

namespace Trackly.Infrastructure.Storage;

/// <summary>
/// Holds the built provider clients. Singleton, because a
/// <c>BlobServiceClient</c> or <c>StorageClient</c> owns a connection pool and
/// building one per upload would throw that away every time.
/// </summary>
/// <remarks>
/// Keyed on the config's <c>UpdatedAt</c>, so saving new credentials
/// invalidates the entry without anyone having to remember to clear a cache.
///
/// A replaced client is not disposed: another request may still be streaming
/// through it, and there is no safe moment to know otherwise. Config changes
/// are rare admin actions, so the garbage is bounded — whereas disposing a
/// client mid-download would fail a request that was already succeeding.
/// </remarks>
public sealed class StorageProviderCache
{
    private readonly ConcurrentDictionary<(Guid Workspace, string Slot), (DateTime Version, IFileStorage Storage)> _entries = new();

    public IFileStorage GetOrCreate(Guid workspaceId, string slot, DateTime version, Func<IFileStorage> factory)
    {
        var key = (workspaceId, slot);
        if (_entries.TryGetValue(key, out var entry) && entry.Version == version)
            return entry.Storage;

        var created = factory();
        _entries[key] = (version, created);
        return created;
    }
}

/// <inheritdoc />
public sealed class WorkspaceFileStorage(
    TracklyDbContext db,
    ISecretProtector secrets,
    StorageProviderCache cache,
    IFileStorage local) : IWorkspaceFileStorage
{
    /// <summary>Marks the public bucket in a storage key: "gcs-public:…".</summary>
    private const string PublicSuffix = "-public";

    public async Task<string> SaveAsync(
        Guid workspaceId,
        string keyPrefix,
        string fileName,
        Stream content,
        StorageVisibility visibility = StorageVisibility.Private,
        CancellationToken ct = default)
    {
        var config = await LoadAsync(workspaceId, ct);
        var provider = config?.Provider ?? StorageProviders.Local;

        // One bucket holds both. The flag is recorded in the key rather than in
        // where the bytes go, because its job is to decide what may be handed
        // out as a URL — and only a "-public" key ever can be.
        var isPublic = visibility == StorageVisibility.Public && provider != StorageProviders.Local;
        var storage = Build(workspaceId, provider, config);

        // The path prefix lives INSIDE the key, so a bucket shared with another
        // application stays navigable, and changing the prefix later does not
        // strand everything written under the old one.
        var prefix = config?.PathPrefix is { Length: > 0 } root ? $"{root}/{keyPrefix}" : keyPrefix;

        var key = await storage.SaveAsync(prefix, fileName, content, ct);
        return $"{provider}{(isPublic ? PublicSuffix : "")}:{key}";
    }

    public async Task<Stream> OpenReadAsync(Guid workspaceId, string storageKey, CancellationToken ct = default)
    {
        var (provider, _, key) = Split(storageKey);
        var storage = Build(workspaceId, provider, await LoadAsync(workspaceId, ct));
        return await storage.OpenReadAsync(key, ct);
    }

    public async Task DeleteAsync(Guid workspaceId, string storageKey, CancellationToken ct = default)
    {
        var (provider, _, key) = Split(storageKey);
        var storage = Build(workspaceId, provider, await LoadAsync(workspaceId, ct));
        await storage.DeleteAsync(key, ct);
    }

    public async Task<string?> PublicUrlAsync(Guid workspaceId, string storageKey, CancellationToken ct = default)
    {
        var (provider, isPublic, key) = Split(storageKey);

        // A private object never gets a URL, whatever the config says. This is
        // the check that keeps a caller from accidentally publishing an
        // attachment by passing its key to the wrong method.
        if (!isPublic || provider == StorageProviders.Local)
            return null;

        var config = await LoadAsync(workspaceId, ct);
        if (config?.PublicBaseUrl is not { Length: > 0 } baseUrl)
            return null;

        // The CDN fronts ONE bucket: the current provider's public one. An
        // object written by a provider the workspace has since moved off is not
        // behind it, and pointing a browser there would 404.
        if (provider != config.Provider)
            return null;

        // The CDN origin maps onto the bucket root, so the bucket name is not
        // part of the path: https://cdn.example.com/{key}, not /{bucket}/{key}.
        return $"{baseUrl.TrimEnd('/')}/{key}";
    }

    private Task<StorageConfig?> LoadAsync(Guid workspaceId, CancellationToken ct)
        => db.StorageConfigs.AsNoTracking().SingleOrDefaultAsync(c => c.WorkspaceId == workspaceId, ct);

    /// <summary>
    /// Splits "gcs-public:trackly/019fd…/logo.png" into provider, visibility and
    /// the bare key.
    /// </summary>
    /// <remarks>
    /// A key with no recognised prefix is private local disk. That covers both
    /// files written before this existed and the case where a colon turns up
    /// inside a real key — an uploaded filename can legally contain one on
    /// Linux, and it must not be mistaken for a provider.
    /// </remarks>
    private static (string Provider, bool IsPublic, string Key) Split(string storageKey)
    {
        var separator = storageKey.IndexOf(':');
        if (separator <= 0)
            return (StorageProviders.Local, false, storageKey);

        var prefix = storageKey[..separator];
        var isPublic = prefix.EndsWith(PublicSuffix, StringComparison.Ordinal);
        var provider = isPublic ? prefix[..^PublicSuffix.Length] : prefix;

        return StorageProviders.All.Contains(provider)
            ? (provider, isPublic, storageKey[(separator + 1)..])
            : (StorageProviders.Local, false, storageKey);
    }

    /// <summary>
    /// Builds (or reuses) the client for one provider.
    /// </summary>
    /// <remarks>
    /// Note this resolves whichever provider was ASKED for, which on a read is
    /// the one named in the key rather than the workspace's current setting.
    /// That is why the entity keeps Azure and GCS credentials in separate
    /// columns: switching provider leaves the old ones in place, and files
    /// written under the old one stay readable. Clearing them is what breaks
    /// history — which is why the admin screen says so.
    /// </remarks>
    private IFileStorage Build(Guid workspaceId, string provider, StorageConfig? config)
    {
        if (provider == StorageProviders.Local || config is null)
            return local;

        return cache.GetOrCreate(workspaceId, provider, config.UpdatedAt, () => provider switch
        {
            StorageProviders.Azure => new AzureBlobFileStorage(
                Require(config.AzureConnectionStringEncrypted, "Azure connection string"),
                RequirePlain(config.AzureContainer, "Azure container")),

            StorageProviders.Gcs => new GcsFileStorage(
                Require(config.GcsCredentialsJsonEncrypted, "GCP service-account JSON"),
                RequirePlain(config.GcsBucket, "GCS bucket")),

            _ => local,
        });
    }

    private string Require(string? encrypted, string what) =>
        string.IsNullOrEmpty(encrypted)
            ? throw new InvalidOperationException(
                $"Attachment storage is misconfigured: {what} is missing. Set it under Admin → Storage.")
            : secrets.Unprotect(encrypted);

    private static string RequirePlain(string? value, string what) =>
        string.IsNullOrWhiteSpace(value)
            ? throw new InvalidOperationException(
                $"Attachment storage is misconfigured: {what} is missing. Set it under Admin → Storage.")
            : value;
}
