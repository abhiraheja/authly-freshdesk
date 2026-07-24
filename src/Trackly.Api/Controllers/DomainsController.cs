using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Trackly.Api.Auth;
using Trackly.Core.Entities;
using Trackly.Core.Interfaces;
using Trackly.Infrastructure.Data;
using Trackly.Modules.Auth;

namespace Trackly.Api.Controllers;

// Admin-only domain management. A verified + discoverable domain routes users who
// enter an @domain email on the login page to this workspace's SSO. Domains are
// globally unique — only one workspace may claim a domain.
[ApiController]
[Authorize(Policy = "Admin")]
public partial class DomainsController(TracklyDbContext db, IDnsTxtLookup dns) : ControllerBase
{
    public const string TxtPrefix = "trackly-verification=";

    [GeneratedRegex(@"^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$")]
    private static partial Regex DomainRegex();

    public record AddDomainRequest(string Domain);
    public record UpdateDomainRequest(bool Discoverable);

    [HttpGet("api/admin/domains")]
    public async Task<IActionResult> List(CancellationToken ct)
    {
        var workspaceId = User.GetWorkspaceId();
        var domains = await db.WorkspaceDomains
            .Where(d => d.WorkspaceId == workspaceId)
            .OrderBy(d => d.Domain)
            .ToListAsync(ct);
        return Ok(domains.Select(ToResponse));
    }

    [HttpPost("api/admin/domains")]
    public async Task<IActionResult> Add([FromBody] AddDomainRequest req, CancellationToken ct)
    {
        var domain = (req.Domain ?? "").Trim().ToLowerInvariant().TrimEnd('.');
        if (!DomainRegex().IsMatch(domain))
            return BadRequest(new { error = "Enter a valid domain like acme.com." });

        // Globally unique — surface a clear conflict rather than a DB error.
        if (await db.WorkspaceDomains.AnyAsync(d => d.Domain == domain, ct))
            return Conflict(new { error = "That domain is already claimed." });

        var record = new WorkspaceDomain
        {
            WorkspaceId = User.GetWorkspaceId(),
            Domain = domain,
            DnsTxtToken = TokenUtils.GenerateToken(),
        };
        db.WorkspaceDomains.Add(record);
        await db.SaveChangesAsync(ct);
        return StatusCode(StatusCodes.Status201Created, ToResponse(record));
    }

    [HttpPost("api/admin/domains/{id:guid}/verify")]
    public async Task<IActionResult> Verify(Guid id, CancellationToken ct)
    {
        var record = await FindAsync(id, ct);
        if (record is null) return NotFound();

        var expected = TxtPrefix + record.DnsTxtToken;
        var txts = await dns.GetTxtRecordsAsync(record.Domain, ct);
        var found = txts.Any(t => t.Trim() == expected);

        if (!found)
            return Ok(new { verified = false, expectedTxt = expected, found = txts });

        record.Verified = true;
        record.VerifiedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return Ok(ToResponse(record));
    }

    [HttpPatch("api/admin/domains/{id:guid}")]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateDomainRequest req, CancellationToken ct)
    {
        var record = await FindAsync(id, ct);
        if (record is null) return NotFound();
        record.Discoverable = req.Discoverable;
        await db.SaveChangesAsync(ct);
        return Ok(ToResponse(record));
    }

    [HttpDelete("api/admin/domains/{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var workspaceId = User.GetWorkspaceId();
        await db.WorkspaceDomains.Where(d => d.Id == id && d.WorkspaceId == workspaceId).ExecuteDeleteAsync(ct);
        return NoContent();
    }

    private Task<WorkspaceDomain?> FindAsync(Guid id, CancellationToken ct)
    {
        var workspaceId = User.GetWorkspaceId();
        return db.WorkspaceDomains.SingleOrDefaultAsync(d => d.Id == id && d.WorkspaceId == workspaceId, ct);
    }

    private static object ToResponse(WorkspaceDomain d) => new
    {
        id = d.Id,
        domain = d.Domain,
        verified = d.Verified,
        discoverable = d.Discoverable,
        verifiedAt = d.VerifiedAt,
        txtRecordName = d.Domain,
        txtRecordValue = TxtPrefix + d.DnsTxtToken,
    };
}
