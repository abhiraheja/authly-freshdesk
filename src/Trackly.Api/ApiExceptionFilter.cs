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
