namespace Trackly.Core.Interfaces;

// Symmetric envelope for secrets at rest (SMTP/IMAP passwords, webhook signing
// secrets, OAuth refresh tokens). AES-256-GCM — authenticated, so tampering with
// the ciphertext fails decryption rather than yielding garbage.
public interface ISecretProtector
{
    string Protect(string plaintext);
    string Unprotect(string ciphertext);
}
