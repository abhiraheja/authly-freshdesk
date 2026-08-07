namespace Trackly.Core.Interfaces;

/// <summary>
/// Which bucket a file belongs in.
/// </summary>
/// <remarks>
/// This is a security boundary, not a hint. <see cref="Private"/> is the
/// default for everything; <see cref="Public"/> is only for assets that are
/// already served anonymously — today, workspace logos.
/// </remarks>
public enum StorageVisibility
{
    /// <summary>Reachable only through the API, after its permission checks.</summary>
    Private,

    /// <summary>Anonymously readable, and CDN-cacheable.</summary>
    Public,
}

/// <summary>
/// Attachment storage for a workspace that brings its own bucket. Resolves the
/// workspace's configured provider (local disk, Azure Blob, GCS) and delegates
/// to it.
/// </summary>
/// <remarks>
/// <para>
/// <b>Keys returned by <see cref="SaveAsync"/> carry a provider prefix</b> —
/// <c>azure:</c>, <c>gcs:</c>, <c>local:</c>, and the <c>-public</c> variants
/// (<c>gcs-public:</c>). Reads and deletes route on that prefix, NOT on the
/// workspace's current setting, because a workspace that switches provider still
/// has to serve every file it wrote beforehand. Without the prefix, switching
/// would orphan the entire attachment history with no way to recover it from the
/// key alone.
/// </para>
/// <para>
/// A key with no prefix predates this and means local disk. Never strip or
/// rewrite a stored key.
/// </para>
/// </remarks>
public interface IWorkspaceFileStorage
{
    Task<string> SaveAsync(
        Guid workspaceId,
        string keyPrefix,
        string fileName,
        Stream content,
        StorageVisibility visibility = StorageVisibility.Private,
        CancellationToken ct = default);

    Task<Stream> OpenReadAsync(Guid workspaceId, string storageKey, CancellationToken ct = default);

    Task DeleteAsync(Guid workspaceId, string storageKey, CancellationToken ct = default);

    /// <summary>
    /// A CDN URL for an object, or null if there isn't one.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Only ever call this for assets saved as <see cref="StorageVisibility.Public"/></b>.
    /// A CDN URL carries no authorisation, so returning one for a ticket
    /// attachment would hand out a link that bypasses every visibility check,
    /// including the rule that an internal note's attachment never reaches a
    /// customer (invariant 5). Private keys return null here regardless.
    /// </para>
    /// <para>
    /// Returns null unless the workspace has a CDN configured AND the key was
    /// written by the provider that CDN fronts. A logo still sitting on local
    /// disk after a move to GCS is not on the CDN, so it must keep being served
    /// by the API.
    /// </para>
    /// </remarks>
    Task<string?> PublicUrlAsync(Guid workspaceId, string storageKey, CancellationToken ct = default);
}
