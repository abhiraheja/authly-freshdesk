using Azure;
using Azure.Storage.Blobs;
using Trackly.Core.Interfaces;

namespace Trackly.Infrastructure.Storage;

/// <summary>
/// Azure Blob Storage, configured per workspace from a connection string.
/// Constructed by <see cref="WorkspaceFileStorage"/> and cached — building a
/// <see cref="BlobServiceClient"/> sets up a connection pool, so one per upload
/// would be wasteful.
/// </summary>
public sealed class AzureBlobFileStorage : IFileStorage
{
    private readonly BlobContainerClient _container;
    private readonly SemaphoreSlim _initGate = new(1, 1);
    private bool _containerChecked;

    private readonly bool _autoCreate;

    /// <param name="autoCreate">
    /// False for the public container. A container created here would be
    /// PRIVATE, so auto-creating one would silently produce a container that
    /// accepts uploads and then serves nothing — worse than failing outright.
    /// The admin creates the public container with the access level they want.
    /// </param>
    public AzureBlobFileStorage(string connectionString, string containerName, bool autoCreate = true)
    {
        _container = new BlobServiceClient(connectionString).GetBlobContainerClient(containerName);
        _autoCreate = autoCreate;
    }

    public async Task<string> SaveAsync(
        string keyPrefix, string fileName, Stream content, CancellationToken ct = default)
    {
        await EnsureContainerAsync(ct);

        // Same shape as local disk: a GUID keeps two files of the same name
        // apart, and GetFileName strips any path the client tried to smuggle in.
        var key = $"{keyPrefix}/{Guid.NewGuid():N}_{Path.GetFileName(fileName)}";
        await _container.GetBlobClient(key).UploadAsync(content, overwrite: false, ct);
        return key;
    }

    public async Task<Stream> OpenReadAsync(string storageKey, CancellationToken ct = default)
        => await _container.GetBlobClient(storageKey).OpenReadAsync(cancellationToken: ct);

    public async Task DeleteAsync(string storageKey, CancellationToken ct = default)
        => await _container.GetBlobClient(storageKey).DeleteIfExistsAsync(cancellationToken: ct);

    /// <summary>Creates the container on first use, once per instance.</summary>
    /// <remarks>
    /// Failures are swallowed deliberately. The credential may be scoped to an
    /// existing container with no permission to create one — a legitimate,
    /// least-privilege setup that must not break uploads. If the container
    /// genuinely is missing, the upload that follows fails with Azure's own
    /// error, which says far more than anything we could invent here.
    /// </remarks>
    private async Task EnsureContainerAsync(CancellationToken ct)
    {
        if (_containerChecked || !_autoCreate) return;
        await _initGate.WaitAsync(ct);
        try
        {
            if (_containerChecked) return;
            try { await _container.CreateIfNotExistsAsync(cancellationToken: ct); }
            catch (RequestFailedException) { }
            _containerChecked = true;
        }
        finally
        {
            _initGate.Release();
        }
    }
}
