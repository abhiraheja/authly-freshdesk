using System.Net;
using Google;
using Google.Apis.Auth.OAuth2;
using Google.Cloud.Storage.V1;
using Trackly.Core.Interfaces;

namespace Trackly.Infrastructure.Storage;

/// <summary>
/// Google Cloud Storage, configured per workspace from a service-account JSON
/// key. Constructed by <see cref="WorkspaceFileStorage"/> and cached — building
/// the client parses the key and sets up an auth pipeline.
/// </summary>
public sealed class GcsFileStorage : IFileStorage
{
    private readonly StorageClient _client;
    private readonly string _bucket;

    public GcsFileStorage(string credentialsJson, string bucket)
    {
        _client = StorageClient.Create(GoogleCredential.FromJson(credentialsJson));
        _bucket = bucket;
    }

    public async Task<string> SaveAsync(
        string keyPrefix, string fileName, Stream content, CancellationToken ct = default)
    {
        var key = $"{keyPrefix}/{Guid.NewGuid():N}_{Path.GetFileName(fileName)}";
        // contentType null: GCS infers it, and the value we serve on download
        // comes from the attachments table, not from the object's metadata.
        await _client.UploadObjectAsync(_bucket, key, contentType: null, content, cancellationToken: ct);
        return key;
    }

    /// <remarks>
    /// The GCS client downloads into a stream rather than handing one back, so
    /// this buffers. Safe because attachments are capped at 10 MB
    /// (AttachmentService.MaxSizeBytes) — revisit if that cap ever moves.
    /// </remarks>
    public async Task<Stream> OpenReadAsync(string storageKey, CancellationToken ct = default)
    {
        var buffer = new MemoryStream();
        await _client.DownloadObjectAsync(_bucket, storageKey, buffer, cancellationToken: ct);
        buffer.Position = 0;
        return buffer;
    }

    public async Task DeleteAsync(string storageKey, CancellationToken ct = default)
    {
        // Deleting something already gone is the outcome the caller wanted.
        try
        {
            await _client.DeleteObjectAsync(_bucket, storageKey, cancellationToken: ct);
        }
        catch (GoogleApiException e) when (e.HttpStatusCode == HttpStatusCode.NotFound)
        {
        }
    }
}
