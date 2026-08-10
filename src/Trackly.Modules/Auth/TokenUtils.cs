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

    // A short public identifier — the embeddable widget's token. Deliberately not
    // a secret: it sits in the page source of every site that embeds the widget,
    // so unguessability buys nothing and readability buys a lot. Lowercase
    // alphanumeric with no ambiguous glyphs, so it survives being read aloud or
    // retyped from a screenshot.
    private const string ShortTokenAlphabet = "abcdefghjkmnpqrstuvwxyz23456789";

    public static string GenerateShortToken(int length = 12)
    {
        var chars = new char[length];
        for (var i = 0; i < length; i++)
            chars[i] = ShortTokenAlphabet[RandomNumberGenerator.GetInt32(ShortTokenAlphabet.Length)];
        return new string(chars);
    }

    public static string Sha256Hex(string value)
        => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    // PKCE S256 challenge: base64url(SHA-256(ASCII(verifier))), no padding.
    public static string Base64UrlSha256(string value)
        => Convert.ToBase64String(SHA256.HashData(Encoding.ASCII.GetBytes(value)))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
