using DnsClient;
using Trackly.Core.Interfaces;

namespace Trackly.Infrastructure.Sso;

public class DnsClientTxtLookup : IDnsTxtLookup
{
    private readonly LookupClient _client = new();

    public async Task<IReadOnlyList<string>> GetTxtRecordsAsync(string domain, CancellationToken cancellationToken = default)
    {
        try
        {
            var result = await _client.QueryAsync(domain, QueryType.TXT, cancellationToken: cancellationToken);
            return result.Answers.TxtRecords()
                .SelectMany(r => r.Text)
                .ToList();
        }
        catch (DnsResponseException)
        {
            // NXDOMAIN / no records / server failure — treat as "no TXT records".
            return [];
        }
    }
}
