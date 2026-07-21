namespace Trackly.Core.Interfaces;

// Local disk for self-hosted deployments; S3-compatible object storage later.
public interface IFileStorage
{
    Task<string> SaveAsync(string keyPrefix, string fileName, Stream content, CancellationToken ct = default);
    Task<Stream> OpenReadAsync(string storageKey, CancellationToken ct = default);
    Task DeleteAsync(string storageKey, CancellationToken ct = default);
}
