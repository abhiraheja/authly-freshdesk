---
name: trackly-feature
description: Add or change a backend feature in Trackly — a new entity, EF migration, service, API endpoint, background worker, or admin setting. Use when working in src/Trackly.Core, Modules, Infrastructure, or Api. Covers the layer boundaries, the security invariants every endpoint must uphold, the migration workflow, and how to verify a slice end-to-end.
---

# Trackly backend feature slice

**.NET 10 + EF Core 10 + PostgreSQL.** Four projects, strict dependency direction:

```
Trackly.Core           entities, interfaces, enums        (depends on nothing)
Trackly.Infrastructure EF DbContext, migrations, email,    (→ Core)
                       storage, crypto — the outside world
Trackly.Modules        business logic / services           (→ Core, Infrastructure)
Trackly.Api            controllers, auth scheme, filters   (→ all)
```

Business rules live in **Modules**, never in a controller. Controllers translate
HTTP ↔ service calls and nothing more. Anything talking to a third party (SMTP,
IMAP, blob storage, AES) belongs in **Infrastructure** behind a `Core` interface.

## Non-negotiable invariants

From `CLAUDE.md`, enforced in code. Breaking one is a bug even if it compiles.

1. **Workspace isolation.** Every query filters by `workspace_id`. The pattern is
   a private `Visible…(Actor actor)` helper — copy it:
   ```csharp
   private IQueryable<Ticket> VisibleTickets(Actor actor)
   {
       var query = db.Tickets.Where(t => t.WorkspaceId == actor.WorkspaceId);
       if (!actor.IsAgentOrAdmin) query = query.Where(t => t.RequesterId == actor.UserId);
       return query;
   }
   ```
2. **Roles come from `users.role` in our DB**, never from an IdP token at request time.
3. **Secrets are AES-256-GCM encrypted at rest** via `ISecretProtector`; columns are
   named `*_encrypted`. Never return a secret — expose `hasX: bool`.
4. **Tokens are stored SHA-256 hashed**, single-use where applicable (sessions,
   magic links, OTPs, invites, guest links). Use `TokenUtils`.
5. **Private notes (`is_internal`) never reach customers or guests** — filter in the
   service, and force `is_internal = false` for customer authors.
6. **Customer-facing surfaces render workspace branding**, not Trackly's.
7. **Magic-link verify never consumes the token on GET** — only the confirm POST does.

## Adding a slice, in order

### 1. Entity — `Trackly.Core/Entities/`

Plain class, no EF attributes. Statuses as `static class` string constants with an
`All` array for validation (see `TicketStatus`).

### 2. DbContext — `Trackly.Infrastructure/Data/TracklyDbContext.cs`

Add the `DbSet`, configure in `OnModelCreating`. Snake-case is automatic, so
`WorkspaceId` → `workspace_id`.

```csharp
modelBuilder.Entity<Thing>(e =>
{
    e.ToTable("things");
    e.HasIndex(t => new { t.WorkspaceId, t.Status });
    e.Property(t => t.Status).HasDefaultValue(ThingStatus.Open);
    e.HasOne(t => t.Workspace).WithMany().HasForeignKey(t => t.WorkspaceId)
        .OnDelete(DeleteBehavior.Cascade);
});
```

### 3. Migration

```powershell
dotnet ef migrations add <Name> --project src/Trackly.Infrastructure --startup-project src/Trackly.Api --output-dir Data/Migrations
```

`Database.Migrate()` runs on startup in Development, so just run the API to apply.
If EF claims "pending model changes" but `migrations add` produces an **empty**
`Up()`, that's a known EF 10 false positive — suppress via `ConfigureWarnings`.

### 4. Service — `Trackly.Modules/<Area>/`

Constructor injection, `CancellationToken` on every async method, DTOs as `record`s
in a sibling `…Dtos.cs`. Throw `ArgumentException` for validation and
`UnauthorizedAccessException` for role failures — `ApiExceptionFilter` maps them to
400/403, so controllers stay clean.

### 5. Controller — `Trackly.Api/Controllers/`

```csharp
[ApiController]
[Route("api/things")]
[Authorize]
public class ThingsController(ThingService things) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
        => Ok(await things.ListAsync(User.GetActor(), ct));

    [HttpPost]
    [Authorize(Policy = "AgentOrAdmin")]   // or "Admin"
    public async Task<IActionResult> Create([FromBody] CreateThingRequest req, CancellationToken ct)
        => StatusCode(201, await things.CreateAsync(User.GetActor(), req, ct));
}
```

`User.GetActor()` (`Api/Auth/ActorExtensions.cs`) yields `Actor(UserId, WorkspaceId,
Role)` — pass it into every service call; that's how isolation is enforced.

Public endpoints (guest, webhooks, branding) skip `[Authorize]` but **must** prove
access another way: a hashed token in the query string, or an HMAC signature. Add
`[EnableRateLimiting("auth")]` to anything unauthenticated that sends email or
accepts credentials.

### 6. Register in `Program.cs`

`builder.Services.AddScoped<ThingService>();` — `AddHostedService<…>()` for a
`BackgroundService`.

## Background workers

Create a **scope per tick** (`scopeFactory.CreateScope()`) because `DbContext` is
scoped. Claim work by writing a timestamp *before* doing it so a crash doesn't
hot-loop, and make the operation idempotent.

## Verifying

No automated test project yet. Each phase is verified with a PowerShell suite
driving the real API; write one for your slice and keep it. (A `tests/` project is
the obvious next improvement — offer it.)

```powershell
docker compose up -d                       # Postgres on 5432
dotnet run --project src/Trackly.Api --urls http://localhost:5210
```

**`appsettings.Development.json` is gitignored** — on a fresh clone, create it with
the connection string and `App:FrontendBaseUrl` (the README has the exact content),
or the API fails with "ConnectionString property has not been initialized".

With no SMTP configured, sign-in emails and OTP codes print to the API console —
that's how the suites obtain login codes. Assert on **behaviour and status codes**,
and always include negative cases: cross-workspace read returns 404, customer PATCH
returns 403, a customer never sees `isInternal: true` comments, replayed tokens are
rejected.

Before finishing: `dotnet build Trackly.slnx` must be 0 errors, and if you changed
anything in the plan's scope, update `docs/trackly-plan.md` in the same change — it
is the source of truth.

## Conventions

- File-scoped namespaces; primary constructors on services and controllers.
- `record` for DTOs; `Guid` PKs; `DateTime.UtcNow` everywhere.
- Comment the *why*, not the *what* — especially around a security decision.
- **Commit and push after every phase.** Don't let multiple phases accumulate
  unpushed; this project has already lost work that way.
- **New config key or secret? Update `docs/go-live.md` in the same change.** Any
  new `IConfiguration` read, connection string, encrypted setting, external
  dependency, or prod-only concern goes in that deployment checklist immediately —
  it's how we avoid missing settings when deploying to a new environment.
