using Microsoft.Extensions.Configuration;
using Trackly.Core.Interfaces;

namespace Trackly.Infrastructure.Storage;

// Stores files under a root directory (config Storage:LocalPath, default
// ./storage next to the app). Storage keys are relative paths generated here —
// never taken from user input.
public class LocalFileStorage(IConfiguration configuration) : IFileStorage
{
    private readonly string _root = Path.GetFullPath(
        configuration["Storage:LocalPath"] ?? Path.Combine(AppContext.BaseDirectory, "storage"));

    public async Task<string> SaveAsync(string keyPrefix, string fileName, Stream content, CancellationToken ct = default)
    {
        var safeName = Path.GetFileName(fileName);
        var key = $"{keyPrefix}/{Guid.NewGuid():N}_{safeName}";
        var fullPath = Resolve(key);
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
        await using var file = File.Create(fullPath);
        await content.CopyToAsync(file, ct);
        return key;
    }

    public Task<Stream> OpenReadAsync(string storageKey, CancellationToken ct = default)
        => Task.FromResult<Stream>(File.OpenRead(Resolve(storageKey)));

    public Task DeleteAsync(string storageKey, CancellationToken ct = default)
    {
        var path = Resolve(storageKey);
        if (File.Exists(path)) File.Delete(path);
        return Task.CompletedTask;
    }

    // Guards against a storage key escaping the root via traversal.
    private string Resolve(string storageKey)
    {
        var fullPath = Path.GetFullPath(Path.Combine(_root, storageKey));
        if (!fullPath.StartsWith(_root, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Storage key escapes the storage root.");
        return fullPath;
    }
}
