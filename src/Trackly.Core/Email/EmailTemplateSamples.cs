namespace Trackly.Core.Email;

/// <summary>
/// Stand-in values for the preview and the per-template test send.
///
/// Every variable a template declares gets one, so a preview never shows a gap
/// where a name should be — an admin judging their wording needs to see the
/// sentence as a customer will read it, not "Hi ,".
///
/// Conditional variables are populated on purpose: a preview whose `{{#if
/// csat_url}}` block never appears would hide half the template from the person
/// editing it.
/// </summary>
public static class EmailTemplateSamples
{
    public static Dictionary<string, string?> For(string key) => key switch
    {
        "magic_link" => new()
        {
            ["action_url"] = "https://trackly.example.com/auth/verify?token=sample",
            ["otp"] = "482 913",
            ["expiry_minutes"] = "10",
        },
        "guest_otp" => new()
        {
            ["otp"] = "482 913",
            ["expiry_minutes"] = "10",
        },
        "invitation" => new()
        {
            ["action_url"] = "https://trackly.example.com/invite/sample",
            ["inviter_name"] = "Priya Sharma",
            ["role_name"] = "an agent",
            ["expiry_days"] = "7",
        },
        "announcement" => new()
        {
            ["title"] = "Scheduled maintenance this Sunday",
            ["body"] = "<p>We'll be upgrading our systems on Sunday between 02:00 and 04:00 UTC. "
                       + "You may notice a brief interruption while the work completes.</p>",
        },
        "email_test" => [],
        _ => Ticket(key),
    };

    // Every ticket template shares a shape, so they share a sample.
    private static Dictionary<string, string?> Ticket(string key) => new()
    {
        ["ticket_ref"] = "TRK-4821",
        ["ticket_subject"] = "Cannot export invoices to CSV",
        ["ticket_url"] = "https://trackly.example.com/portal/tickets/sample",
        ["customer_name"] = "Alex Doyle",
        ["agent_name"] = "Priya Sharma",
        ["author_name"] = key == "ticket_reply_agent" ? "Alex Doyle" : "Priya Sharma",
        ["status"] = "In progress",
        ["body"] = "<p>Thanks for getting in touch — I've reproduced this on my side "
                   + "and a fix is going out with tomorrow's release.</p>",
        ["excerpt"] = "<p>Could you take a look at this one? It's the same export bug from last week.</p>",
        ["csat_url"] = "https://trackly.example.com/csat/sample",
        // Truthy so the "reply to this email" branch is visible in a preview.
        ["can_reply"] = "true",
    };
}
