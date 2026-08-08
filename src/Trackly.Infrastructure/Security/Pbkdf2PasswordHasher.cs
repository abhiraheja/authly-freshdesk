using System.Buffers.Binary;
using System.Security.Cryptography;
using Trackly.Core.Interfaces;

namespace Trackly.Infrastructure.Security;

/// <summary>
/// PBKDF2-HMAC-SHA256, in the same shape as <see cref="AesGcmSecretProtector"/>:
/// one self-describing base64 string that round-trips through a `text` column.
///
/// PBKDF2 rather than Argon2/bcrypt because it is in the framework — no package,
/// no native dependency, and nothing to keep patched in a container someone else
/// operates. It is the weakest of the three against GPU attack, which is why the
/// iteration count is carried *in* the stored value: raising it later re-hashes
/// each password on its owner's next sign-in, with no migration and no lockout.
/// </summary>
public class Pbkdf2PasswordHasher : IPasswordHasher
{
    private const byte Version = 1;
    private const int SaltBytes = 16;
    private const int HashBytes = 32;

    /// OWASP's 2023 floor for PBKDF2-HMAC-SHA256. Raise it, don't lower it —
    /// NeedsRehash compares against this number.
    private const int Iterations = 210_000;

    // 1 version + 4 iterations + salt + hash.
    private const int PayloadBytes = 1 + 4 + SaltBytes + HashBytes;

    public string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltBytes);
        var hash = Derive(password, salt, Iterations);

        var payload = new byte[PayloadBytes];
        payload[0] = Version;
        BinaryPrimitives.WriteInt32BigEndian(payload.AsSpan(1, 4), Iterations);
        salt.CopyTo(payload.AsSpan(5, SaltBytes));
        hash.CopyTo(payload.AsSpan(5 + SaltBytes, HashBytes));

        return Convert.ToBase64String(payload);
    }

    public bool Verify(string password, string storedHash)
    {
        if (!TryDecode(storedHash, out var iterations, out var salt, out var expected))
            return false;

        var actual = Derive(password, salt, iterations);
        // Fixed-time: a length-or-content comparison that short-circuits leaks
        // how much of the hash matched.
        return CryptographicOperations.FixedTimeEquals(actual, expected);
    }

    public bool NeedsRehash(string storedHash)
        => !TryDecode(storedHash, out var iterations, out _, out _) || iterations < Iterations;

    private static byte[] Derive(string password, byte[] salt, int iterations)
        => Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, HashBytes);

    private static bool TryDecode(string stored, out int iterations, out byte[] salt, out byte[] hash)
    {
        iterations = 0;
        salt = [];
        hash = [];

        if (string.IsNullOrWhiteSpace(stored))
            return false;

        Span<byte> payload = stackalloc byte[PayloadBytes];
        if (!Convert.TryFromBase64String(stored, payload, out var written) || written != PayloadBytes)
            return false;
        if (payload[0] != Version)
            return false;

        iterations = BinaryPrimitives.ReadInt32BigEndian(payload[1..5]);
        if (iterations <= 0)
            return false;

        salt = payload.Slice(5, SaltBytes).ToArray();
        hash = payload.Slice(5 + SaltBytes, HashBytes).ToArray();
        return true;
    }
}
