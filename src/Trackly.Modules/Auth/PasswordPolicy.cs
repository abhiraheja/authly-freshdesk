using System.Security.Cryptography;

namespace Trackly.Modules.Auth;

/// <summary>
/// What counts as an acceptable password, in one place — setup, self-service
/// change and admin reset all go through here, so they cannot drift apart and
/// leave one door weaker than the others.
///
/// **Length only.** Composition rules ("one uppercase, one digit, one symbol")
/// push people towards `Password1!` and are no longer recommended by NIST
/// (SP 800-63B) or OWASP. A 12-character minimum buys more than a character
/// class ever did, and it is a rule someone can satisfy with a passphrase.
/// </summary>
public static class PasswordPolicy
{
    public const int MinLength = 12;

    /// Bcrypt-era inputs truncate; PBKDF2 does not, but an unbounded password is
    /// an unbounded amount of hashing work per login attempt.
    public const int MaxLength = 256;

    public static bool IsAcceptable(string? password)
        => password is not null
           && password.Length >= MinLength
           && password.Length <= MaxLength;

    public static string Describe()
        => $"Password must be at least {MinLength} characters.";

    /// <summary>
    /// A temporary password for an admin to hand over out-of-band.
    ///
    /// Unambiguous alphabet — no O/0, l/1/I — because this gets read down a phone
    /// line or retyped from a chat message, and a password that cannot be
    /// dictated is a support ticket of its own. 20 characters from a 32-symbol
    /// alphabet is 100 bits, which more than covers the short life it should have.
    /// </summary>
    public static string GenerateTemporary()
    {
        const string alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
        var chars = new char[20];
        for (var i = 0; i < chars.Length; i++)
            chars[i] = alphabet[RandomNumberGenerator.GetInt32(alphabet.Length)];

        // Grouped for reading aloud. The hyphens count towards the length, and
        // are part of the password.
        return $"{new string(chars, 0, 5)}-{new string(chars, 5, 5)}-{new string(chars, 10, 5)}-{new string(chars, 15, 5)}";
    }
}
