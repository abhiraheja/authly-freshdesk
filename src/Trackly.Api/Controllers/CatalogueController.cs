using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Trackly.Api.Auth;
using Trackly.Modules.Tickets;

namespace Trackly.Api.Controllers;

/// <summary>
/// The workspace's registers: assets, services, and its own ticket properties.
///
/// **Agents read, admins write.** An agent picking the laptop a ticket is about
/// has to see the list; deciding what is on it is a configuration decision, and
/// a register everyone can edit stops being a register within a month.
/// </summary>
[ApiController]
[Route("api")]
[Authorize(Policy = "AgentOrAdmin")]
public class CatalogueController(AssetService assets, TicketFieldService fields) : ControllerBase
{
    public record SaveAssetRequest(
        string? Name, string? Kind, string? Tag, string? Location,
        Guid? AssignedToId, bool ClearAssignee, string? Notes, bool? IsActive);

    public record SaveServiceRequest(
        string? Name, string? Description, Guid? OwnerTeamId, bool ClearOwner,
        int? SortOrder, bool? IsActive);

    public record CreateFieldRequest(
        string Label, string Type, string? HelpText, string? Options,
        bool AllowNewOptions, bool IsRequired);

    public record SaveFieldRequest(
        string? Label, string? HelpText, string? Options,
        bool? AllowNewOptions, bool? IsRequired, int? SortOrder, bool? IsActive);

    // ---- Assets ----------------------------------------------------------------

    /// <summary>
    /// The register. <c>search</c> matches name or tag — half the time somebody
    /// is holding the machine and reading the sticker on it.
    /// </summary>
    [HttpGet("assets")]
    public async Task<IActionResult> Assets(
        [FromQuery] string? search, [FromQuery] bool includeInactive, CancellationToken ct)
        => Ok(await assets.ListAssetsAsync(User.GetActor(), search, includeInactive, ct));

    /// <summary>
    /// The register in aggregate — how many, how many are out with somebody, and
    /// where. Agent-readable: "have we got a spare laptop" is a support question,
    /// not a configuration one.
    /// </summary>
    [HttpGet("assets/summary")]
    public async Task<IActionResult> AssetSummary(CancellationToken ct)
        => Ok(await assets.AssetSummaryAsync(User.GetActor(), ct));

    /// <summary>Every ticket ever raised about one asset — the drill-down behind its count.</summary>
    [HttpGet("assets/{assetId:guid}/tickets")]
    public async Task<IActionResult> AssetTickets(Guid assetId, CancellationToken ct)
        => await assets.AssetTicketsAsync(User.GetActor(), assetId, ct) is { } list
            ? Ok(list)
            : NotFound();

    [HttpPost("assets")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> CreateAsset([FromBody] SaveAssetRequest request, CancellationToken ct)
    {
        var created = await assets.CreateAssetAsync(
            User.GetActor(), request.Name ?? "", request.Kind, request.Tag,
            request.Location, request.AssignedToId, request.Notes, ct);
        return StatusCode(StatusCodes.Status201Created, created);
    }

    [HttpPut("assets/{assetId:guid}")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> SaveAsset(
        Guid assetId, [FromBody] SaveAssetRequest request, CancellationToken ct)
    {
        var saved = await assets.UpdateAssetAsync(
            User.GetActor(), assetId, request.Name, request.Kind, request.Tag, request.Location,
            request.AssignedToId, request.ClearAssignee, request.Notes, request.IsActive, ct);
        return saved is null ? NotFound() : Ok(saved);
    }

    [HttpDelete("assets/{assetId:guid}")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> DeleteAsset(Guid assetId, CancellationToken ct)
        => await assets.DeleteAssetAsync(User.GetActor(), assetId, ct) switch
        {
            AssetDeleteResult.Deleted => NoContent(),
            AssetDeleteResult.NotFound => NotFound(),
            _ => Conflict(new
            {
                error = "Tickets reference this asset. Retire it instead so their history keeps its meaning.",
            }),
        };

    // ---- Services ----------------------------------------------------------------

    [HttpGet("services")]
    public async Task<IActionResult> Services([FromQuery] bool includeInactive, CancellationToken ct)
        => Ok(await assets.ListServicesAsync(User.GetActor(), includeInactive, ct));

    /// <summary>
    /// Open tickets saying a service is affected, worst impact first.
    ///
    /// <c>includeFinished</c> turns it into the service's incident history, which
    /// is the view for "how often does this break" rather than "is it broken now".
    /// </summary>
    [HttpGet("services/{serviceId:guid}/tickets")]
    public async Task<IActionResult> ServiceTickets(
        Guid serviceId, [FromQuery] bool includeFinished, CancellationToken ct)
        => await assets.ServiceTicketsAsync(User.GetActor(), serviceId, includeFinished, ct) is { } list
            ? Ok(list)
            : NotFound();

    [HttpPost("services")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> CreateService(
        [FromBody] SaveServiceRequest request, CancellationToken ct)
    {
        var created = await assets.CreateServiceAsync(
            User.GetActor(), request.Name ?? "", request.Description, request.OwnerTeamId, ct);
        return StatusCode(StatusCodes.Status201Created, created);
    }

    [HttpPut("services/{serviceId:guid}")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> SaveService(
        Guid serviceId, [FromBody] SaveServiceRequest request, CancellationToken ct)
    {
        var saved = await assets.UpdateServiceAsync(
            User.GetActor(), serviceId, request.Name, request.Description,
            request.OwnerTeamId, request.ClearOwner, request.SortOrder, request.IsActive, ct);
        return saved is null ? NotFound() : Ok(saved);
    }

    [HttpDelete("services/{serviceId:guid}")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> DeleteService(Guid serviceId, CancellationToken ct)
        => await assets.DeleteServiceAsync(User.GetActor(), serviceId, ct) switch
        {
            AssetDeleteResult.Deleted => NoContent(),
            AssetDeleteResult.NotFound => NotFound(),
            _ => Conflict(new
            {
                error = "Tickets reference this service. Retire it instead so their history keeps its meaning.",
            }),
        };

    // ---- Custom ticket properties ---------------------------------------------------

    /// <summary>
    /// The definitions. Agents need them to render the form; only admins change
    /// what is on it.
    /// </summary>
    [HttpGet("ticket-fields")]
    public async Task<IActionResult> Fields([FromQuery] bool includeInactive, CancellationToken ct)
        => Ok(await fields.ListAsync(User.GetActor(), includeInactive, ct));

    [HttpPost("ticket-fields")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> CreateField(
        [FromBody] CreateFieldRequest request, CancellationToken ct)
    {
        var created = await fields.CreateAsync(
            User.GetActor(), request.Label, request.Type, request.HelpText,
            request.Options, request.AllowNewOptions, request.IsRequired, ct);
        return StatusCode(StatusCodes.Status201Created, created);
    }

    /// <summary>
    /// The key and the type are deliberately not editable — see
    /// <see cref="TicketFieldService.UpdateAsync"/> for why there is no honest
    /// migration for a text field becoming a checkbox.
    /// </summary>
    [HttpPut("ticket-fields/{fieldId:guid}")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> SaveField(
        Guid fieldId, [FromBody] SaveFieldRequest request, CancellationToken ct)
    {
        var saved = await fields.UpdateAsync(
            User.GetActor(), fieldId, request.Label, request.HelpText, request.Options,
            request.AllowNewOptions, request.IsRequired, request.SortOrder, request.IsActive, ct);
        return saved is null ? NotFound() : Ok(saved);
    }

    [HttpDelete("ticket-fields/{fieldId:guid}")]
    [Authorize(Policy = "Admin")]
    public async Task<IActionResult> DeleteField(Guid fieldId, CancellationToken ct)
        => await fields.DeleteAsync(User.GetActor(), fieldId, ct) switch
        {
            AssetDeleteResult.Deleted => NoContent(),
            AssetDeleteResult.NotFound => NotFound(),
            _ => Conflict(new
            {
                error = "Tickets have answered this field. Retire it instead — the answers are kept.",
            }),
        };
}
