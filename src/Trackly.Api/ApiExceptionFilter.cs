using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Trackly.Modules.Email;
using Trackly.Modules.Releases;
using Trackly.Modules.Tickets;

namespace Trackly.Api;

// Maps business-layer exceptions to HTTP responses so services can throw
// ArgumentException (validation) / UnauthorizedAccessException (role check)
// and controllers stay free of translation code.
public class ApiExceptionFilter : IExceptionFilter
{
    public void OnException(ExceptionContext context)
    {
        // A request the browser gave up on is not a failure, and it is not one
        // endpoint's problem either — it can happen to any of them. The browser
        // aborts in-flight requests constantly: an <img> whose element goes
        // away, a page navigated away from mid-load, a reload. ASP.NET cancels
        // the token, EF throws, and every one of those would otherwise be logged
        // as a server error and break the debugger.
        //
        // Handled HERE rather than per-controller, which is where this started
        // and does not scale past the first two files that hit it.
        //
        // The IsCancellationRequested check matters: an OperationCanceledException
        // thrown for any OTHER reason is a real bug and must keep bubbling.
        if (context.Exception is OperationCanceledException
            && context.HttpContext.RequestAborted.IsCancellationRequested)
        {
            // 499 is nginx's "client closed request". Nothing reads it — the
            // client is gone — but it keeps the log honest about what happened.
            context.Result = new StatusCodeResult(499);
            context.ExceptionHandled = true;
            return;
        }

        context.Result = context.Exception switch
        {
            // 409, not 400: the request was well formed and the answer is "confirm
            // first". The warnings travel with it so a client that never called the
            // preview can still put them in front of the agent instead of showing
            // a bare error.
            TicketWarningsException e => new ConflictObjectResult(new
            {
                error = e.Message,
                warnings = e.Warnings,
            }),
            // Same shape and the same reasoning as above: well-formed request,
            // answer is "confirm first". The code travels so the client can ask
            // the right question instead of surfacing the English sentence.
            ReleaseConfirmException e => new ConflictObjectResult(new
            {
                error = e.Message,
                code = e.Code,
            }),
            // 502, not 400 or 500: the request was fine and Trackly is fine — the
            // mail relay Trackly depends on refused. The distinction is what tells
            // an admin to go and look at their email settings rather than at their
            // typing or at the server log.
            EmailDeliveryException e => new ObjectResult(new { error = e.Message })
            {
                StatusCode = StatusCodes.Status502BadGateway,
            },
            ArgumentException e => new BadRequestObjectResult(new { error = e.Message }),
            UnauthorizedAccessException => new ObjectResult(new { error = "Forbidden." })
            {
                StatusCode = StatusCodes.Status403Forbidden,
            },
            _ => null!,
        };
        context.ExceptionHandled = context.Result is not null;
    }
}
