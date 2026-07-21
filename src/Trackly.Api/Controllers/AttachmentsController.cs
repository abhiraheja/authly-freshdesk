using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Trackly.Api.Auth;
using Trackly.Modules.Tickets;

namespace Trackly.Api.Controllers;

[ApiController]
[Route("api/attachments")]
[Authorize]
public class AttachmentsController(AttachmentService attachments) : ControllerBase
{
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Download(Guid id, CancellationToken ct)
    {
        var result = await attachments.DownloadAsync(User.GetActor(), id, ct);
        if (result is null)
            return NotFound();
        var (meta, content) = result.Value;
        return File(content, meta.ContentType, meta.FileName);
    }
}
