namespace Trackly.Core.Interfaces;

// One storage backend: local disk, Azure Blob, GCS. Implementations are
// single-tenant and know nothing about workspaces — IWorkspaceFileStorage picks
// which one a given workspace gets and owns the provider prefix on the key.
// Storage keys handed to these methods are bare (no "azure:"/"gcs:" prefix).
public interface IFileStorage
{
    Task<string> SaveAsync(string keyPrefix, string fileName, Stream content, CancellationToken ct = default);
    Task<Stream> OpenReadAsync(string storageKey, CancellationToken ct = default);
    Task DeleteAsync(string storageKey, CancellationToken ct = default);
}
