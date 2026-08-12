namespace Trackly.Modules.Email;

/// <summary>
/// The relay refused a message the caller had already promised to send.
///
/// Distinct from a validation error because nothing about the request was wrong:
/// the admin typed a good address, the template rendered, and the mail server
/// said no. The caller is being told which half of the operation failed so it can
/// say so, rather than surfacing an unmapped 500 that reads as "Trackly is
/// broken".
///
/// <para>
/// **Only throw this where the message is safe to show.** It carries the relay's
/// own words — "535 authentication failed", a host name, a port — which is
/// exactly what an admin fixing their SMTP settings needs and exactly what an
/// anonymous caller should never be handed. That is why
/// <see cref="TransactionalMailer"/> does not wrap its own failures: its other
/// callers include the public sign-in and widget endpoints. Wrapping happens at
/// the admin-only call sites that can afford the detail.
/// </para>
/// </summary>
public class EmailDeliveryException(string message, Exception inner) : Exception(message, inner);
