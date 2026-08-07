namespace Trackly.Core.Entities;

// Per-workspace attachment storage (one row per workspace). Secret columns are
// suffixed *_encrypted and hold AES-256-GCM ciphertext via ISecretProtector —
// never plaintext, never returned to a client (invariant 3).
//
// A workspace with no row falls back to local disk, which is what every
// existing deployment already does — adding this table changes nothing until
// an admin picks a provider.
public class StorageConfig
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Workspace Workspace { get; set; } = null!;

    public string Provider { get; set; } = StorageProviders.Local;

    // ---- Azure Blob Storage ----
    // The connection string carries the account key, so it is the secret; the
    // container name is not and stays readable so the admin screen can show it.
    public string? AzureConnectionStringEncrypted { get; set; }
    public string? AzureContainer { get; set; }

    // ---- Google Cloud Storage ----
    // The whole service-account JSON is the secret: it contains a private key.
    public string? GcsCredentialsJsonEncrypted { get; set; }
    public string? GcsBucket { get; set; }

    /// <summary>
    /// Folder inside the bucket that everything Trackly writes lives under,
    /// e.g. <c>trackly</c>.
    /// </summary>
    /// <remarks>
    /// Buckets get shared between applications. Without a prefix Trackly would
    /// scatter workspace-id folders across the root of a bucket that something
    /// else also owns, and "which of these can I delete" becomes unanswerable.
    /// Stored inside the key, so changing it later does not strand old files.
    /// </remarks>
    public string? PathPrefix { get; set; }

    /// <summary>
    /// Optional CDN origin in front of the bucket, e.g.
    /// <c>https://cdn-beta.saarvix.in</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Maps onto the bucket root, so it replaces
    /// <c>https://storage.googleapis.com/{bucket}</c> — the bucket name is not
    /// part of a CDN path.
    /// </para>
    /// <para>
    /// <b>Only objects written as <c>StorageVisibility.Public</c> are ever given
    /// one of these URLs</b> — today that is workspace logos alone. Trackly
    /// never produces a CDN URL for a ticket attachment: such a link carries no
    /// sign-in, so it would bypass workspace isolation, requester scoping, and
    /// the rule that an attachment on an internal note never reaches a customer
    /// (invariant 5). Attachments stay proxied through the API.
    /// </para>
    /// <para>
    /// Setting this means the bucket itself has to be publicly readable, and
    /// attachments share that bucket. Trackly never publishes their paths, but
    /// it cannot make a public bucket private — see the warning on the admin
    /// screen. A separate private bucket for attachments is the way to avoid
    /// that trade entirely.
    /// </para>
    /// </remarks>
    public string? PublicBaseUrl { get; set; }

    // Set by the last successful "test connection", so the admin screen can say
    // "verified 5 minutes ago" rather than making them guess whether it works.
    public DateTime? LastVerifiedAt { get; set; }

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public static class StorageProviders
{
    public const string Local = "local";
    public const string Azure = "azure";
    public const string Gcs = "gcs";
    public static readonly string[] All = [Local, Azure, Gcs];
}
