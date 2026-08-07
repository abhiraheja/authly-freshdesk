using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;

namespace Trackly.Api.Dev;

// Development-only demo data for a single workspace, so a fresh workspace has
// something to click around. Everything is workspace-scoped and consistent with
// the real entities/enums. Refuses to run if the workspace already has tickets.
public class DevSeeder(TracklyDbContext db)
{
    public async Task<object> SeedAsync(Guid workspaceId, Guid adminUserId, CancellationToken ct)
    {
        if (await db.Tickets.AnyAsync(t => t.WorkspaceId == workspaceId, ct))
            return new { seeded = false, reason = "Workspace already has tickets — seeding skipped." };

        var now = DateTime.UtcNow;

        // ---- People -----------------------------------------------------------
        var maya = await UpsertUserAsync(workspaceId, "maya.agent@demo.trackly", "Maya Chen", TracklyRoles.Agent, ct);
        var sam = await UpsertUserAsync(workspaceId, "sam.agent@demo.trackly", "Sam Patel", TracklyRoles.Agent, ct);
        var alice = await UpsertUserAsync(workspaceId, "alice@acme-customer.com", "Alice Johnson", TracklyRoles.Customer, ct);
        var bob = await UpsertUserAsync(workspaceId, "bob@acme-customer.com", "Bob Lee", TracklyRoles.Customer, ct);
        var carol = await UpsertUserAsync(workspaceId, "carol@acme-customer.com", "Carol Diaz", TracklyRoles.Customer, ct);

        // ---- Categories -------------------------------------------------------
        var billing = new Category { WorkspaceId = workspaceId, Name = "Billing", Color = "#F59E0B" };
        var technical = new Category { WorkspaceId = workspaceId, Name = "Technical", Color = "#3B82F6" };
        var general = new Category { WorkspaceId = workspaceId, Name = "General", Color = "#10B981" };
        db.Categories.AddRange(billing, technical, general);

        // ---- Team -------------------------------------------------------------
        var team = new Team { WorkspaceId = workspaceId, Name = "Support team" };
        db.Teams.Add(team);
        db.TeamMembers.Add(new TeamMember { Team = team, UserId = maya.Id });
        db.TeamMembers.Add(new TeamMember { Team = team, UserId = sam.Id });

        // ---- SLA policies -----------------------------------------------------
        db.SlaPolicies.AddRange(
            new SlaPolicy { WorkspaceId = workspaceId, Priority = TicketPriority.Urgent, FirstResponseMinutes = 30, ResolveMinutes = 240 },
            new SlaPolicy { WorkspaceId = workspaceId, Priority = TicketPriority.High, FirstResponseMinutes = 120, ResolveMinutes = 480 },
            new SlaPolicy { WorkspaceId = workspaceId, Priority = TicketPriority.Medium, FirstResponseMinutes = 480, ResolveMinutes = 1440 },
            new SlaPolicy { WorkspaceId = workspaceId, Priority = TicketPriority.Low, FirstResponseMinutes = 960, ResolveMinutes = 2880 });

        // ---- Tags -------------------------------------------------------------
        var vip = new Tag { WorkspaceId = workspaceId, Name = "vip" };
        var bug = new Tag { WorkspaceId = workspaceId, Name = "bug" };
        var refund = new Tag { WorkspaceId = workspaceId, Name = "refund" };
        db.Tags.AddRange(vip, bug, refund);

        // ---- Problem ----------------------------------------------------------
        var problem = new Problem
        {
            WorkspaceId = workspaceId,
            Title = "Checkout failing for card payments",
            Description = "Multiple reports of card declines at checkout since the 3pm deploy.",
            Status = ProblemStatus.Investigating,
            AssigneeId = maya.Id,
            CreatedBy = adminUserId,
        };
        db.Problems.Add(problem);

        // ---- Tickets ----------------------------------------------------------
        // (subject, description, requester, priority, status, category, assignee, ageHours, tags, problem, firstDueInMins, resolveDueInMins, responded)
        var t1 = MakeTicket(workspaceId, "Can't pay — card keeps declining", "Every card I try is declined at checkout.", alice, TicketPriority.Urgent, "open", technical, maya, 2, [vip, bug], problem, 30, 240, false);
        var t2 = MakeTicket(workspaceId, "Checkout error 500", "I get a server error when I click Pay.", bob, TicketPriority.High, "open", technical, sam, 5, [bug], problem, 120, 480, true);
        var t3 = MakeTicket(workspaceId, "Payment failed but I was charged", "My card was charged twice but the order failed.", carol, TicketPriority.Urgent, "pending", billing, maya, 26, [refund], problem, 30, 240, true);
        var t4 = MakeTicket(workspaceId, "How do I change my plan?", "I want to upgrade from Team to Enterprise.", alice, TicketPriority.Medium, "open", billing, null, 8, [], null, 480, 1440, false);
        var t5 = MakeTicket(workspaceId, "Invoice missing VAT number", "Can you add our VAT number to invoices?", bob, TicketPriority.Low, "pending", billing, sam, 50, [], null, 960, 2880, true);
        var t6 = MakeTicket(workspaceId, "Feature request: dark mode", "Would love a dark mode in the portal.", carol, TicketPriority.Low, "open", general, null, 70, [], null, 960, 2880, false);
        var t7 = MakeTicket(workspaceId, "Password reset email not arriving", "I never get the reset email.", alice, TicketPriority.High, "resolved", technical, maya, 96, [], null, 120, 480, true);
        var t8 = MakeTicket(workspaceId, "Thanks for the quick help!", "Just wanted to say your team was great.", bob, TicketPriority.Low, "closed", general, sam, 120, [vip], null, 960, 2880, true);

        // A couple of guest tickets (no account).
        var g1 = MakeGuestTicket(workspaceId, "Website is down", "Your marketing site returns 502.", "dana@prospect.com", "Dana Prospect", TicketPriority.High, "open", technical, maya, 3, 120, 480, false);
        var g2 = MakeGuestTicket(workspaceId, "Question about pricing", "Do you offer nonprofit discounts?", "evan@nonprofit.org", "Evan Reyes", TicketPriority.Medium, "open", general, null, 12, 480, 1440, false);

        var tickets = new[] { t1, t2, t3, t4, t5, t6, t7, t8, g1, g2 };
        db.Tickets.AddRange(tickets);

        // Comments: a public reply + an internal note on a few tickets.
        db.Comments.Add(new Comment { Ticket = t1, AuthorId = maya.Id, Body = "Thanks Alice — we're investigating card declines now.", IsInternal = false, CreatedAt = now.AddHours(-1.5) });
        db.Comments.Add(new Comment { Ticket = t1, AuthorId = maya.Id, Body = "Looks related to the 3pm deploy — grouped under the problem.", IsInternal = true, CreatedAt = now.AddHours(-1.4) });
        db.Comments.Add(new Comment { Ticket = t3, AuthorId = maya.Id, Body = "We've confirmed the double charge and are issuing a refund.", IsInternal = false, CreatedAt = now.AddHours(-20) });
        db.Comments.Add(new Comment { Ticket = t7, AuthorId = maya.Id, Body = "Resent the reset email and whitelisted your domain. Let us know!", IsInternal = false, CreatedAt = now.AddHours(-90) });

        // ---- Knowledge base ---------------------------------------------------
        db.KbArticles.AddRange(
            PublishedArticle(workspaceId, adminUserId, technical.Id, "Reset your password", "Go to the sign-in page and click \"Email me a sign-in link\". Check spam if it doesn't arrive within a minute."),
            PublishedArticle(workspaceId, adminUserId, billing.Id, "Update your billing details", "Open Settings → Billing, then edit your card and company details. Changes apply to your next invoice."),
            PublishedArticle(workspaceId, adminUserId, technical.Id, "Why is checkout failing?", "If your card is declined, first confirm the billing address matches your bank records, then try another card."),
            new KbArticle { WorkspaceId = workspaceId, CategoryId = general.Id, Title = "Draft: upcoming maintenance", Body = "We will perform maintenance next weekend.", Status = KbArticleStatus.Draft, CreatedBy = adminUserId });

        // ---- Canned responses -------------------------------------------------
        db.CannedResponses.AddRange(
            new CannedResponse { WorkspaceId = workspaceId, Title = "Greeting", Body = "Hi there — thanks for reaching out! I'd be happy to help with this." },
            new CannedResponse { WorkspaceId = workspaceId, Title = "Ask for more info", Body = "Could you share a screenshot and the exact time this happened? That'll help us track it down." },
            new CannedResponse { WorkspaceId = workspaceId, Title = "Resolved follow-up", Body = "Glad that's sorted! I'll close this out — reply any time to reopen." });

        // ---- Automation -------------------------------------------------------
        db.AutomationRules.Add(new AutomationRule
        {
            WorkspaceId = workspaceId,
            Name = "Tag urgent tickets sev1",
            Trigger = AutomationTrigger.OnCreate,
            ConditionsJson = """[{"field":"priority","op":"equals","value":"urgent"}]""",
            ActionsJson = """[{"type":"add_tag","value":"sev1"}]""",
            Enabled = true,
        });

        // ---- Announcement (draft) --------------------------------------------
        db.Announcements.Add(new Announcement
        {
            WorkspaceId = workspaceId,
            Type = AnnouncementType.UnplannedOutage,
            Subject = "We're investigating checkout issues",
            Body = "Some customers are seeing card declines at checkout. We're on it and will update shortly.",
            CreatedBy = adminUserId,
        });

        await db.SaveChangesAsync(ct);

        return new
        {
            seeded = true,
            agents = 2,
            customers = 3,
            tickets = tickets.Length,
            categories = 3,
            kbArticles = 4,
            note = "Sign in as maya.agent@demo.trackly (or your admin) to explore. Guest emails are dana@prospect.com / evan@nonprofit.org.",
        };
    }

    // ---- Builders ------------------------------------------------------------

    private async Task<User> UpsertUserAsync(Guid workspaceId, string email, string name, string role, CancellationToken ct)
    {
        var user = await db.Users.SingleOrDefaultAsync(u => u.WorkspaceId == workspaceId && u.Email == email, ct);
        if (user is null)
        {
            user = new User { WorkspaceId = workspaceId, Email = email, Name = name, Role = role };
            db.Users.Add(user);
            await db.SaveChangesAsync(ct); // need the Id for assignments/comments
        }
        return user;
    }

    private static Ticket MakeTicket(
        Guid workspaceId, string subject, string description, User requester, string priority, string status,
        Category category, User? assignee, double ageHours, Tag[] tags, Problem? problem,
        int firstDueMins, int resolveDueMins, bool responded)
    {
        var created = DateTime.UtcNow.AddHours(-ageHours);
        var ticket = new Ticket
        {
            WorkspaceId = workspaceId,
            Subject = subject,
            Description = description,
            RequesterId = requester.Id,
            Priority = priority,
            Status = status,
            Category = category,
            AssigneeId = assignee?.Id,
            Problem = problem,
            CreatedAt = created,
            UpdatedAt = created.AddHours(ageHours / 2),
            FirstResponseDueAt = created.AddMinutes(firstDueMins),
            ResolveDueAt = created.AddMinutes(resolveDueMins),
            FirstResponseAt = responded ? created.AddMinutes(firstDueMins / 2.0) : null,
        };
        foreach (var tag in tags)
            ticket.TicketTags.Add(new TicketTag { Ticket = ticket, Tag = tag });
        return ticket;
    }

    private static Ticket MakeGuestTicket(
        Guid workspaceId, string subject, string description, string guestEmail, string guestName,
        string priority, string status, Category category, User? assignee, double ageHours,
        int firstDueMins, int resolveDueMins, bool responded)
    {
        var created = DateTime.UtcNow.AddHours(-ageHours);
        return new Ticket
        {
            WorkspaceId = workspaceId,
            Subject = subject,
            Description = description,
            GuestEmail = guestEmail,
            GuestName = guestName,
            Priority = priority,
            Status = status,
            Category = category,
            AssigneeId = assignee?.Id,
            Channel = TicketChannel.Web,
            CreatedAt = created,
            UpdatedAt = created,
            FirstResponseDueAt = created.AddMinutes(firstDueMins),
            ResolveDueAt = created.AddMinutes(resolveDueMins),
            FirstResponseAt = responded ? created.AddMinutes(firstDueMins / 2.0) : null,
        };
    }

    private static KbArticle PublishedArticle(Guid workspaceId, Guid author, Guid categoryId, string title, string body) => new()
    {
        WorkspaceId = workspaceId,
        CategoryId = categoryId,
        Title = title,
        Body = body,
        Status = KbArticleStatus.Published,
        PublishedAt = DateTime.UtcNow,
        CreatedBy = author,
    };
}
