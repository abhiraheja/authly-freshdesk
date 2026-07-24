using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Options;
using MimeKit;
using Trackly.Core.Interfaces;

namespace Trackly.Infrastructure.Email;

public class SmtpEmailSender(IOptions<SmtpOptions> options) : IEmailSender
{
    private readonly SmtpOptions _options = options.Value;

    public async Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(_options.Host))
            throw new InvalidOperationException("Email:Smtp:Host is not configured.");

        var mime = MimeMessageBuilder.Build(
            message,
            fallbackFromEmail: _options.FromEmail,
            fallbackFromName: _options.FromName);

        using var client = new SmtpClient();
        await client.ConnectAsync(_options.Host, _options.Port,
            _options.UseStartTls ? SecureSocketOptions.StartTlsWhenAvailable : SecureSocketOptions.Auto,
            cancellationToken);
        if (!string.IsNullOrEmpty(_options.Username))
            await client.AuthenticateAsync(_options.Username, _options.Password ?? "", cancellationToken);
        await client.SendAsync(mime, cancellationToken);
        await client.DisconnectAsync(true, cancellationToken);
    }
}
