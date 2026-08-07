using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

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
