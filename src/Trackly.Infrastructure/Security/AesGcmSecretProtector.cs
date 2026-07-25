using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Configuration;
using Trackly.Core.Interfaces;

namespace Trackly.Infrastructure.Security;

// AES-256-GCM. The wire format is base64( nonce(12) || tag(16) || ciphertext ),
// so a single string round-trips through a text column. The 256-bit master key
// comes from configuration Security:MasterKey (base64, exactly 32 bytes). When
// unset, Development derives a stable 32-byte key from a constant passphrase so
// local runs work; production MUST set a real key or previously-encrypted
// secrets become unreadable.
public class AesGcmSecretProtector : ISecretProtector
{
    private const int NonceSize = 12; // AES-GCM standard nonce
    private const int TagSize = 16;   // 128-bit auth tag
    private readonly byte[] _key;

    // Constant passphrase for the Development fallback key. Never used in
    // production (a real Security:MasterKey must be configured there).
    private const string DevFallbackPassphrase = "trackly-dev-master-key-do-not-use-in-prod";

    public AesGcmSecretProtector(IConfiguration configuration)
    {
        var configured = configuration["Security:MasterKey"];
        if (string.IsNullOrWhiteSpace(configured))
        {
            // Derive a stable 32-byte dev key so local runs work without config.
            _key = SHA256.HashData(Encoding.UTF8.GetBytes(DevFallbackPassphrase));
            return;
        }

        _key = Convert.FromBase64String(configured);
        if (_key.Length != 32)
            throw new InvalidOperationException(
                "Security:MasterKey must be a base64-encoded 32-byte (256-bit) key.");
    }

    public string Protect(string plaintext)
    {
        var plainBytes = Encoding.UTF8.GetBytes(plaintext);
        var nonce = RandomNumberGenerator.GetBytes(NonceSize);
        var cipher = new byte[plainBytes.Length];
        var tag = new byte[TagSize];

        using var aes = new AesGcm(_key, TagSize);
        aes.Encrypt(nonce, plainBytes, cipher, tag);

        var output = new byte[NonceSize + TagSize + cipher.Length];
        Buffer.BlockCopy(nonce, 0, output, 0, NonceSize);
        Buffer.BlockCopy(tag, 0, output, NonceSize, TagSize);
        Buffer.BlockCopy(cipher, 0, output, NonceSize + TagSize, cipher.Length);
        return Convert.ToBase64String(output);
    }

    public string Unprotect(string ciphertext)
    {
        var input = Convert.FromBase64String(ciphertext);
        if (input.Length < NonceSize + TagSize)
            throw new CryptographicException("Ciphertext is too short to be valid.");

        var nonce = input.AsSpan(0, NonceSize);
        var tag = input.AsSpan(NonceSize, TagSize);
        var cipher = input.AsSpan(NonceSize + TagSize);
        var plain = new byte[cipher.Length];

        using var aes = new AesGcm(_key, TagSize);
        aes.Decrypt(nonce, cipher, tag, plain);
        return Encoding.UTF8.GetString(plain);
    }
}
