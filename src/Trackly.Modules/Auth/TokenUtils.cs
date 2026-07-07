using System.Security.Cryptography;
using System.Text;

namespace Trackly.Modules.Auth;

public static class TokenUtils
{
    // 256-bit random token, base64url — used for magic links and session cookies.
    public static string GenerateToken()
    {
        var bytes = RandomNumberGenerator.GetBytes(32);
        return Convert.ToBase64String(bytes)
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    public static string GenerateSixDigitCode()
        => RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");

    public static string Sha256Hex(string value)
        => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
}
