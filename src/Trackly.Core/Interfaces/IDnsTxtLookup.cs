namespace Trackly.Core.Interfaces;

// Reads TXT records for a domain — used for domain-ownership verification.
public interface IDnsTxtLookup
{
    Task<IReadOnlyList<string>> GetTxtRecordsAsync(string domain, CancellationToken cancellationToken = default);
}
