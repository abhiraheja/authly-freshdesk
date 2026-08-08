namespace Trackly.Core.Interfaces;

/// <summary>
/// Hashes and verifies user passwords.
///
/// Passwords exist because Trackly is self-hosted: on a fresh install SMTP is
/// not configured yet, so a magic link or a 6-digit code has no way to reach
/// anybody. Reading the code out of the server log works for a developer and is
/// not a way to run a production deployment.
/// </summary>
public interface IPasswordHasher
{
    /// <summary>Encodes the algorithm and its parameters alongside the hash, so stored values stay verifiable after the cost is raised.</summary>
    string Hash(string password);

    /// <summary>Constant-time. False for a malformed or unknown-format stored value rather than throwing.</summary>
    bool Verify(string password, string storedHash);

    /// <summary>True when <paramref name="storedHash"/> was produced with weaker parameters than the current ones, so it should be re-hashed on the next successful sign-in.</summary>
    bool NeedsRehash(string storedHash);
}
