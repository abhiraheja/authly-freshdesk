namespace Trackly.Infrastructure.Email;

public class SmtpOptions
{
    public const string SectionName = "Email:Smtp";

    public string? Host { get; set; }
    public int Port { get; set; } = 587;
    public string? Username { get; set; }
    public string? Password { get; set; }
    public bool UseStartTls { get; set; } = true;
    public string FromEmail { get; set; } = "no-reply@trackly.local";
    public string FromName { get; set; } = "Trackly";
}
