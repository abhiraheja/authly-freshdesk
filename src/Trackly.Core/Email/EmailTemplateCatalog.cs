namespace Trackly.Core.Email;

/// <param name="Variables">
/// Offered in the editor's reference panel. Also the *whole* set a template can
/// reach — the renderer resolves against a dictionary, so a name that is not
/// here resolves to nothing rather than to data. That is what keeps invariant 5
/// structural: no internal comment is in any dictionary, so no template can
/// print one.
/// </param>
/// <param name="Required">
/// Must appear in the saved body, or the save is refused. Only ever the things
/// that make the email pointless by their absence — a link or a code. Requiring
/// cosmetic variables would turn a safety check into an obstacle.
/// </param>
public record EmailTemplateDescriptor(
    string Key,
    string Name,
    string Description,
    string Subject,
    string BodyHtml,
    string[] Variables,
    string[] Required)
{
    public bool IsLayout => Key == EmailTemplateCatalog.LayoutKey;
}

/// <summary>
/// Every email Trackly sends, and the built-in version of each.
///
/// Bodies here are **content fragments**, not documents: they are rendered into
/// <see cref="LayoutKey"/>, which carries the logo, the accent colour and the
/// footer. The alternative — thirteen complete documents — puts the brand colour
/// in thirteen places and freezes whoever edits one into that year's markup.
///
/// **On the string literals.** Placeholders and C# interpolation both use braces,
/// so the fragment helpers are written as <c>$$$"""</c> raw strings: three braces
/// open an interpolation hole, which leaves <c>{{brand_name}}</c> and
/// <c>{{{body}}}</c> as literal text. The descriptor bodies below take the
/// simpler road and concatenate ordinary string literals, where no brace means
/// anything at all.
/// </summary>
public static class EmailTemplateCatalog
{
    public const string LayoutKey = "_layout";
    public const string DefaultLocale = "en";

    /// <summary>Available to every template, including the layout.</summary>
    public static readonly string[] GlobalVariables =
    [
        "brand_name", "workspace_name", "logo_url", "primary_color",
        "footer_text", "hide_powered_by", "portal_url", "support_email", "year",
    ];

    public static IReadOnlyList<EmailTemplateDescriptor> All => Descriptors;

    public static IReadOnlyList<EmailTemplateDescriptor> Editable =>
        Descriptors.Where(d => !d.IsLayout).ToList();

    public static EmailTemplateDescriptor? Find(string? key) =>
        key is not null && Lookup.TryGetValue(key, out var descriptor) ? descriptor : null;

    // ---- Fragment helpers ----------------------------------------------------
    //
    // Built-ins are assembled from these so all thirteen stay visually
    // consistent and each descriptor reads as content rather than markup. What
    // an admin opens in the editor is the assembled HTML — these are a way of
    // writing the defaults, not a layer anyone has to learn.

    private static string H(string text) =>
        $$$"""<h1 style="margin:0 0 16px;font-family:Helvetica,Arial,sans-serif;font-size:22px;line-height:30px;font-weight:700;color:#0F172A;">{{{text}}}</h1>""";

    private static string P(string html) =>
        $$$"""<p style="margin:0 0 16px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:23px;color:#334155;">{{{html}}}</p>""";

    private static string Muted(string html) =>
        $$$"""<p style="margin:0 0 16px;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:#64748B;">{{{html}}}</p>""";

    // A table rather than an <a> with padding: Outlook ignores padding on inline
    // elements, which turns a button into underlined text.
    private static string Button(string url, string label) =>
        $$$"""
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
            <tr><td align="center" bgcolor="{{primary_color}}" style="border-radius:6px;">
              <a href="{{{url}}}" target="_blank" style="display:inline-block;padding:12px 26px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;">{{{label}}}</a>
            </td></tr>
          </table>
          """;

    /// <summary>
    /// A one-time code, built to be taken *out* of the mail.
    ///
    /// <para>
    /// There is no copy button here and there cannot be one: every mail client
    /// strips JavaScript, so nothing in an email can reach the clipboard. What
    /// is available is three things, and this block uses all of them.
    /// </para>
    /// <para>
    /// <b>No spacing, ever.</b> Not a literal space in the value, not
    /// <c>letter-spacing</c> in the CSS. The mail client's own "copy code" chip
    /// and the phone's autofill both look for a bare run of six digits, so
    /// anything sitting between them is the difference between a code the device
    /// offers to fill in and a code the reader has to retype. Monospace at 26px
    /// is what makes it legible; the spacing was not.
    /// </para>
    /// <para>
    /// <b><c>user-select:all</c></b> — a single click selects the whole code
    /// rather than one digit, which is as close to a copy button as email gets.
    /// Honoured by Apple Mail and the webmail clients; ignored harmlessly by the
    /// rest, who fall back to double-click, which works because the code is one
    /// unbroken word.
    /// </para>
    /// <para>
    /// <b>Its own line, adjacent to the word "code"</b> in the sentence above it
    /// — that adjacency is half of what the client-side detectors match on.
    /// </para>
    /// </summary>
    private static string Code(string variable) =>
        $$$"""
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
            <tr><td bgcolor="#F1F5F9" style="border-radius:6px;padding:14px 22px;font-family:'Courier New',Courier,monospace;font-size:26px;font-weight:bold;color:#0F172A;-webkit-user-select:all;-moz-user-select:all;-ms-user-select:all;user-select:all;">{{{variable}}}</td></tr>
          </table>
          """;

    // The customer's or agent's own words, already sanitised server-side — hence
    // the triple braces at every call site. The one place raw output is correct.
    private static string Quote(string variable) =>
        $$$"""
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px;">
            <tr><td bgcolor="#F8FAFC" style="border-radius:6px;padding:16px 18px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:23px;color:#334155;">{{{variable}}}</td></tr>
          </table>
          """;

    // Reference + subject, the block every ticket email opens with.
    private const string TicketMeta =
        """
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px;border-left:3px solid {{primary_color}};">
          <tr><td style="padding:4px 0 4px 14px;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:21px;color:#0F172A;">
            <strong>{{ticket_ref}}</strong><br>{{ticket_subject}}
          </td></tr>
        </table>
        """;

    // ---- The catalogue -------------------------------------------------------

    private static readonly List<EmailTemplateDescriptor> Descriptors =
    [
        new(LayoutKey,
            "Shared layout",
            "The frame every email is rendered into — logo, colours and footer. Edit this to change all emails at once.",
            Subject: string.Empty,
            BodyHtml:
            """
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F1F5F9;padding:32px 12px;">
              <tr><td align="center">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background-color:#FFFFFF;border-radius:10px;overflow:hidden;">

                  <tr><td style="padding:28px 32px 0;">
                    {{#if logo_url}}
                      <img src="{{logo_url}}" alt="{{brand_name}}" height="36" style="height:36px;max-width:200px;display:block;border:0;">
                    {{else}}
                      <div style="font-family:Helvetica,Arial,sans-serif;font-size:19px;font-weight:700;color:{{primary_color}};">{{brand_name}}</div>
                    {{/if}}
                  </td></tr>

                  <tr><td style="padding:24px 32px 8px;">
                    {{{content}}}
                  </td></tr>

                  <tr><td style="padding:8px 32px 28px;border-top:1px solid #E2E8F0;">
                    {{#if footer_text}}
                      <p style="margin:16px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:19px;color:#94A3B8;">{{footer_text}}</p>
                    {{/if}}
                    {{#if hide_powered_by}}{{else}}
                      <p style="margin:10px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#94A3B8;">Powered by Trackly</p>
                    {{/if}}
                  </td></tr>

                </table>
              </td></tr>
            </table>
            """,
            Variables: ["content"],
            Required: ["content"]),

        new("magic_link",
            "Sign-in link",
            "Sent when someone signs in with an emailed link and code.",
            Subject: "Sign in to {{brand_name}}",
            BodyHtml:
            H("Sign in to {{brand_name}}") +
            P("Use the button below to sign in. It expires in {{expiry_minutes}} minutes and works once.") +
            Button("{{action_url}}", "Sign in") +
            P("Or enter this code where you started signing in:") +
            Code("{{otp}}") +
            Muted("If you didn't request this, you can safely ignore this email."),
            Variables: ["action_url", "otp", "expiry_minutes"],
            Required: ["action_url"]),

        new("guest_otp",
            "Guest verification code",
            "Confirms a customer's email address before their ticket is submitted.",
            Subject: "Your {{brand_name}} verification code",
            BodyHtml:
            H("Confirm your email") +
            P("Enter this code to submit your support request:") +
            Code("{{otp}}") +
            Muted("The code expires in {{expiry_minutes}} minutes. If you didn't request this, ignore this email."),
            Variables: ["otp", "expiry_minutes"],
            Required: ["otp"]),

        new("invitation",
            "Team invitation",
            "Sent when an admin invites someone to join the workspace.",
            Subject: "You're invited to join {{workspace_name}}",
            BodyHtml:
            H("Join {{workspace_name}}") +
            P("{{inviter_name}} invited you to join <strong>{{workspace_name}}</strong> as {{role_name}}.") +
            Button("{{action_url}}", "Accept invitation") +
            Muted("The invitation is valid for {{expiry_days}} days. No password needed — the link signs you in."),
            Variables: ["action_url", "inviter_name", "role_name", "expiry_days"],
            Required: ["action_url"]),

        new("ticket_received",
            "Ticket received (guest)",
            "Confirmation sent to a customer who submitted a ticket without an account. Carries their private tracking link.",
            Subject: "[{{ticket_ref}}] We received your request",
            BodyHtml:
            H("We've got your request") +
            P("Thanks — a member of our team will respond soon.") +
            TicketMeta +
            Button("{{ticket_url}}", "Track your ticket") +
            Muted("This link is private to you and needs no account. Keep this email to come back to it."),
            Variables: ["ticket_ref", "ticket_subject", "ticket_url", "customer_name"],
            Required: ["ticket_url"]),

        new("ticket_created_customer",
            "Ticket received (portal)",
            "Confirmation sent to a signed-in customer when their ticket is created.",
            Subject: "[{{ticket_ref}}] We received your request — {{ticket_subject}}",
            BodyHtml:
            H("We've got your request") +
            P("Thanks — your request has been logged and a member of our team will respond soon.") +
            TicketMeta +
            Button("{{ticket_url}}", "View your ticket"),
            Variables: ["ticket_ref", "ticket_subject", "ticket_url", "customer_name"],
            Required: []),

        new("ticket_assigned",
            "Ticket assigned (agent)",
            "Tells an agent a ticket is now theirs, on assignment and reassignment.",
            Subject: "[{{ticket_ref}}] Assigned to you — {{ticket_subject}}",
            BodyHtml:
            H("A ticket was assigned to you") +
            TicketMeta +
            Button("{{ticket_url}}", "Open ticket"),
            Variables: ["ticket_ref", "ticket_subject", "ticket_url", "agent_name"],
            Required: ["ticket_url"]),

        new("ticket_reply_customer",
            "Agent replied (customer)",
            "The customer-facing copy of an agent's reply.",
            Subject: "[{{ticket_ref}}] {{ticket_subject}}",
            // Two independent conditions, not an if/else: a guest reply can be
            // repliable *and* have no ticket URL (their tracking link is private
            // to the confirmation email and is not reissued here), and a portal
            // reply can have both.
            BodyHtml:
            Quote("{{{body}}}") +
            "{{#if can_reply}}" +
            Muted("Reply to this email to respond.") +
            "{{/if}}" +
            "{{#if ticket_url}}" +
            Button("{{ticket_url}}", "View ticket") +
            "{{/if}}",
            Variables: ["body", "ticket_ref", "ticket_subject", "ticket_url", "can_reply", "agent_name"],
            Required: ["body"]),

        new("ticket_reply_agent",
            "Customer replied (agent)",
            "Notifies the assignee and watchers that the customer has responded.",
            Subject: "[{{ticket_ref}}] {{ticket_subject}}",
            BodyHtml:
            P("<strong>{{author_name}}</strong> replied:") +
            Quote("{{{body}}}") +
            TicketMeta +
            Button("{{ticket_url}}", "Open ticket"),
            Variables: ["body", "author_name", "ticket_ref", "ticket_subject", "ticket_url"],
            Required: ["body"]),

        new("ticket_mention",
            "Mention",
            "Sent when one agent @-mentions another on a ticket.",
            Subject: "[{{ticket_ref}}] {{author_name}} mentioned you — {{ticket_subject}}",
            BodyHtml:
            P("<strong>{{author_name}}</strong> mentioned you on a ticket.") +
            TicketMeta +
            "{{#if excerpt}}" +
            Quote("{{{excerpt}}}") +
            "{{/if}}" +
            Button("{{ticket_url}}", "Open ticket"),
            Variables: ["author_name", "excerpt", "ticket_ref", "ticket_subject", "ticket_url"],
            Required: ["ticket_url"]),

        new("ticket_status_changed",
            "Status changed",
            "Tells the customer their ticket moved to a new status.",
            Subject: "[{{ticket_ref}}] Status updated to {{status}} — {{ticket_subject}}",
            BodyHtml:
            H("Your ticket is now &ldquo;{{status}}&rdquo;") +
            TicketMeta +
            // Guarded: a guest ticket has no portal link, and an empty href
            // renders as a button that goes nowhere.
            "{{#if ticket_url}}" +
            Button("{{ticket_url}}", "View ticket") +
            "{{/if}}",
            Variables: ["status", "ticket_ref", "ticket_subject", "ticket_url", "customer_name"],
            Required: []),

        new("ticket_resolved",
            "Ticket resolved",
            "Sent when a ticket is resolved. Includes the satisfaction survey link when CSAT is enabled.",
            Subject: "[{{ticket_ref}}] Resolved — {{ticket_subject}}",
            BodyHtml:
            H("Your ticket has been resolved") +
            TicketMeta +
            "{{#if ticket_url}}" +
            Button("{{ticket_url}}", "View ticket") +
            "{{/if}}" +
            "{{#if csat_url}}" +
            P("How did we do? Rating takes a few seconds and helps us improve.") +
            Button("{{csat_url}}", "Rate your support") +
            "{{/if}}" +
            Muted("Still need help? Reply to this email or reopen the ticket from the link above."),
            Variables: ["ticket_ref", "ticket_subject", "ticket_url", "csat_url", "customer_name"],
            Required: []),

        new("announcement",
            "Announcement",
            "The frame around an announcement. The message itself is written when the announcement is sent.",
            Subject: "{{title}}",
            BodyHtml:
            H("{{title}}") +
            Quote("{{{body}}}"),
            Variables: ["title", "body"],
            Required: ["body"]),

        new("email_test",
            "Email test",
            "The message sent by the Send a test email button.",
            Subject: "{{brand_name}} email test",
            BodyHtml:
            H("Email is working") +
            P("If you're reading this, outbound email works — sign-in codes, invitations and ticket notifications can reach people.") +
            Muted("Sent from {{workspace_name}}."),
            Variables: [],
            Required: []),
    ];

    // Declared after Descriptors on purpose: static field initialisers run in
    // textual order, so building this above the list it reads would capture null.
    private static readonly Dictionary<string, EmailTemplateDescriptor> Lookup =
        Descriptors.ToDictionary(d => d.Key, StringComparer.Ordinal);
}
