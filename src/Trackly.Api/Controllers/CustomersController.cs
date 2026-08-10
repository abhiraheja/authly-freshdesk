using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Trackly.Api.Auth;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;

namespace Trackly.Api.Controllers;

/// <summary>
/// The people who raise tickets — browsable, searchable and countable.
///
/// **Why this is not `GET /api/users?role=customer`.** That endpoint exists to fill
/// a picker: five columns, active rows only, no paging and no counts. A workspace
/// with four thousand customers cannot be *managed* through it — "how many are
/// there", "which of them ever signed in", "who keeps raising tickets" are all
/// questions it cannot answer, and answering them by pulling every row to the
/// client is how a screen dies at scale.
///
/// Agent/admin. A customer must never reach this: it is every other customer's
/// email address and company in one response.
/// </summary>
[ApiController]
[Route("api/customers")]
[Authorize(Policy = "AgentOrAdmin")]
public class CustomersController(TracklyDbContext db) : ControllerBase
{
    private const int MaxPageSize = 100;

    /// <summary>
    /// A page of customers, with the ticket counts that make the row worth reading.
    ///
    /// <c>signedIn</c>: <c>yes</c> for people who have actually logged in,
    /// <c>no</c> for those who never have. That second one is the useful half — a
    /// customer with tickets who has never signed in is somebody emailing the desk
    /// who does not know the portal exists.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] string? search,
        [FromQuery] string? signedIn,
        [FromQuery] bool includeInactive,
        [FromQuery] string? sort,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 25,
        CancellationToken ct = default)
    {
        var workspaceId = User.GetWorkspaceId();
        var customers = db.Users.Where(u =>
            u.WorkspaceId == workspaceId && u.Role == TracklyRoles.Customer);

        if (!includeInactive) customers = customers.Where(u => u.IsActive);

        if (string.Equals(signedIn, "yes", StringComparison.OrdinalIgnoreCase))
            customers = customers.Where(u => u.LastLoginAt != null);
        else if (string.Equals(signedIn, "no", StringComparison.OrdinalIgnoreCase))
            customers = customers.Where(u => u.LastLoginAt == null);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = $"%{search.Trim()}%";
            // The four fields somebody actually searches a customer by. Not the
            // custom fields: those are workspace-defined and unindexed, and an
            // ILIKE across a jsonb column is a sequential scan of the table.
            customers = customers.Where(u =>
                (u.Name != null && EF.Functions.ILike(u.Name, term))
                || (u.Email != null && EF.Functions.ILike(u.Email, term))
                || (u.Phone != null && EF.Functions.ILike(u.Phone, term))
                || (u.Company != null && EF.Functions.ILike(u.Company, term)));
        }

        var total = await customers.CountAsync(ct);
        var size = Math.Clamp(pageSize, 1, MaxPageSize);
        var wanted = Math.Max(page, 1);

        // Ticket counts are correlated sub-queries rather than a join+group, so a
        // customer with no tickets still returns a row with zeroes instead of
        // disappearing from the list.
        var ordered = Sorted(customers, sort);
        var rows = await ordered
            .Skip((wanted - 1) * size)
            .Take(size)
            .Select(u => new
            {
                u.Id, u.Name, u.Email, u.Phone, u.Company, u.Location,
                u.IsActive, u.CreatedAt, u.LastLoginAt, u.AvatarStorageKey,
                TotalTickets = db.Tickets.Count(t => t.RequesterId == u.Id),
                OpenTickets = db.Tickets.Count(t =>
                    t.RequesterId == u.Id
                    && t.StatusCategory != TicketStatusCategory.Resolved
                    && t.StatusCategory != TicketStatusCategory.Closed),
                LastTicketAt = db.Tickets
                    .Where(t => t.RequesterId == u.Id)
                    .Max(t => (DateTime?)t.CreatedAt),
            })
            .ToListAsync(ct);

        return Ok(new
        {
            items = rows.Select(u => new
            {
                u.Id, u.Name, u.Email, u.Phone, u.Company, u.Location,
                u.IsActive, u.CreatedAt, u.LastLoginAt,
                AvatarUrl = UserAvatar.UrlFor(u.Id, u.AvatarStorageKey),
                u.TotalTickets, u.OpenTickets, u.LastTicketAt,
            }),
            total,
        });
    }

    /// <summary>
    /// The register in aggregate. Counted over **every** customer, active or not —
    /// deliberately unlike the list, which hides deactivated ones by default: "how
    /// many customers do we have" and "who can I pick right now" are different
    /// questions, and a summary that silently answered the second would not add up
    /// against the first.
    /// </summary>
    [HttpGet("summary")]
    public async Task<IActionResult> Summary(CancellationToken ct)
    {
        var workspaceId = User.GetWorkspaceId();
        var customers = db.Users.Where(u =>
            u.WorkspaceId == workspaceId && u.Role == TracklyRoles.Customer);

        var monthStart = new DateTime(
            DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1, 0, 0, 0, DateTimeKind.Utc);

        return Ok(new
        {
            Total = await customers.CountAsync(ct),
            Active = await customers.CountAsync(u => u.IsActive, ct),
            SignedIn = await customers.CountAsync(u => u.LastLoginAt != null, ct),
            // The number worth acting on: they email the desk and have never found
            // the portal. Restricted to customers who actually have a ticket,
            // because a contact somebody typed in once and never used is not a
            // person who failed to sign in.
            NeverSignedInWithTickets = await customers.CountAsync(u =>
                u.LastLoginAt == null && db.Tickets.Any(t => t.RequesterId == u.Id), ct),
            WithOpenTickets = await customers.CountAsync(u => db.Tickets.Any(t =>
                t.RequesterId == u.Id
                && t.StatusCategory != TicketStatusCategory.Resolved
                && t.StatusCategory != TicketStatusCategory.Closed), ct),
            NewThisMonth = await customers.CountAsync(u => u.CreatedAt >= monthStart, ct),
        });
    }

    /// <summary>
    /// Sort orders, all with a tie-break on id.
    ///
    /// The tie-break is not decoration: two customers created in the same
    /// millisecond — which happens on an import — can otherwise swap places between
    /// page 1 and page 2, so one is shown twice and another never at all.
    ///
    /// An instance method, not static, because "most tickets" needs a correlated
    /// count against the context.
    /// </summary>
    private IQueryable<User> Sorted(IQueryable<User> customers, string? sort) => sort switch
    {
        "name" => customers.OrderBy(u => u.Name ?? u.Email).ThenBy(u => u.Id),
        "tickets" => customers
            .OrderByDescending(u => db.Tickets.Count(t => t.RequesterId == u.Id))
            .ThenBy(u => u.Id),
        "lastSeen" => customers
            // Nulls last: "never signed in" is not the most recent thing to happen,
            // and PostgreSQL sorts NULL highest on a DESC by default — which would
            // put every customer who never logged in at the top of "most recent".
            .OrderByDescending(u => u.LastLoginAt != null)
            .ThenByDescending(u => u.LastLoginAt)
            .ThenBy(u => u.Id),
        _ => customers.OrderByDescending(u => u.CreatedAt).ThenBy(u => u.Id),
    };
}
