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
        // A request the browser gave up on is not a failure. It aborts an image
        // load whenever the element goes away — switching a tab, navigating,
        // reloading a thread — and the token is cancelled before the query
        // finishes. Answering rather than throwing keeps that out of the logs
        // and out of the debugger.
        if (ct.IsCancellationRequested)
            return new StatusCodeResult(StatusCodes.Status499ClientClosedRequest);

        (AttachmentDto Meta, Stream Content)? result;
        try
        {
            result = await attachments.DownloadAsync(User.GetActor(), id, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            return new StatusCodeResult(StatusCodes.Status499ClientClosedRequest);
        }

        if (result is null)
            return NotFound();
        var (meta, content) = result.Value;

        // Attachment bytes never change: the id IS the content, there is no
        // endpoint that replaces one, and deleting a ticket removes the row
        // rather than repointing it. Without this every thumbnail re-downloaded
        // the whole file on every render — the same screenshot fetched once in
        // the conversation, again in the Attachments tab, and again after each
        // reply reloaded the thread.
        //
        // `private` keeps it out of shared proxy caches. `Vary: Cookie` is the
        // part that makes a long max-age safe on a shared machine: the cache
        // entry is keyed by the session cookie, so the next person to sign in
        // gets a miss and a real authorisation check rather than somebody
        // else's document out of the browser cache.
        Response.Headers.CacheControl = "private, max-age=86400";
        Response.Headers.Vary = "Cookie";

        // Without this the browser may ignore the Content-Type below and guess
        // from the bytes — which hands the decision back to whoever uploaded the
        // file, and is precisely what the downgrade is there to prevent.
        Response.Headers.XContentTypeOptions = "nosniff";

        // The stored type came from the uploader and nothing has checked it
        // against the bytes, so anything not known-safe is served as
        // octet-stream. `fileDownloadName` also sets Content-Disposition:
        // attachment, so nothing here is ever rendered in Trackly's origin.
        var safeType = UploadPolicy.SafeContentType(meta.FileName, meta.ContentType);
        return File(content, safeType, meta.FileName);
    }
}
