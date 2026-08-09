# Email providers — design plan

Replacing the dropdown-driven email setup at `/admin/settings/email` with a
provider-card surface, and adding OAuth-based connections (Google, Microsoft,
Yahoo) alongside the manual SMTP/IMAP path that exists today.

> **Working document.** Fold the settled parts into `docs/trackly-plan.md`
> (§ Email Architecture, § Email Configuration) as each phase lands, then delete
> this file — the same lifecycle `docs/workspace-login-plan.md` had.

---

## 1. Why

Today an admin configures email by filling in a form: SMTP host, port, username,
password, then a second set of fields for IMAP, then two dropdowns choosing an
inbound connector and a provider. It works, and it asks the admin to know things
their mail provider already knows.

Google, Microsoft and Yahoo all expose OAuth-authenticated mail access. An admin
who runs Google Workspace should be able to click **Connect**, consent, and be
done — no app password, no host names, no port numbers, and no long-lived
credential sitting in Trackly's database.

Manual SMTP does not go away. It is the escape hatch for every provider we don't
have a card for, and for organisations whose mail lives somewhere bespoke.

---

## 2. What exists today

Grounding, so the plan is measured against the real code rather than the doc.

| Piece | File | State |
|---|---|---|
| Config entity | `src/Trackly.Core/Entities/EmailConfig.cs` | one row; flat `smtp_*` + `mailbox_*` columns |
| Admin API | `src/Trackly.Api/Controllers/EmailSettingsController.cs` | `GET`/`PUT /api/admin/settings/email`, same for `/notifications` |
| Outbound | `src/Trackly.Infrastructure/Email/WorkspaceEmailSender.cs` | MailKit `SmtpClient`, password auth, falls back to the shared relay |
| Inbound (poll) | `src/Trackly.Infrastructure/Email/ImapMailboxReader.cs` | MailKit `ImapClient`, password auth |
| Inbound (webhook) | `src/Trackly.Api/Controllers/EmailInboundController.cs` | `POST /api/email/inbound/{slug}`, HMAC-SHA256 over the raw body |
| Worker | `src/Trackly.Api/Workers/EmailPollingWorker.cs` | 15s base tick; selects `InboundConnector.MailboxPoll && MailboxProtocol.Imap` |
| Pipeline | `src/Trackly.Modules/Email/InboundEmailService.cs` | shared by both connectors — **unchanged by this work** |
| Test + proof | `EmailSettingsController.TestEmail`, `EmailConfig.LastVerifiedAt` | added by `8d7f3ac`; **no UI yet** — see § 4.5 |
| Lockout guard | `src/Trackly.Api/Controllers/LoginSettingsController.cs` | added by `8d7f3ac`; **no UI yet**; reads `LastVerifiedAt` |
| Angular screen | `/admin/settings/email` | `ComingSoon`; React source is `frontend/src/pages/admin/EmailSettingsPage.tsx` (265 lines) |

Three things already anticipate this work and were never built:

- `EmailConfig.MailboxOauthTokensEncrypted` — an encrypted column with no writer.
- `MailboxProtocol.MsGraph` / `MailboxProtocol.GmailApi` — reserved enum values.
- The plan's own note at § Option B: *"only IMAP is implemented today."*

**What the self-hosted pivot changed.** One deployment, one workspace, no public
sign-up. For this feature that removes the hardest question: whose OAuth app
authenticates the connection. It is the operator's own — each company registers
its own Google Cloud project and Entra app registration, exactly as they already
supply their own SMTP relay and their own Azure/GCS storage credentials.

---

## 3. The load-bearing decision: OAuth is an auth method, not a new transport

Google, Microsoft and Yahoo all support **XOAUTH2 over ordinary IMAP and SMTP**.
MailKit 4.17 (already referenced) ships `SaslMechanismOAuth2`.

So the cheapest correct implementation is *not* a Gmail API reader and a Graph
sender. It is:

```csharp
// ImapMailboxReader — today
await client.AuthenticateAsync(connection.Username, connection.Password, ct);

// with OAuth
await client.AuthenticateAsync(
    new SaslMechanismOAuth2(connection.Username, connection.AccessToken), ct);
```

Two files change by a handful of lines each, the inbound pipeline is untouched,
the polling worker keeps its shape, and no SDK is added. Everything that already
works — threading headers, quoted-reply stripping, Message-ID dedup, attachment
extraction — keeps working because none of it knows how the bytes arrived.

**This is the assumption the whole plan rests on, and it must be verified before
Phase 2 starts** (§ 8). If Microsoft has closed SMTP AUTH for delegated apps, the
Microsoft card specifically needs Graph `sendMail` + `messages` behind the
existing `IMailboxReader` / `IWorkspaceEmailSender` interfaces — a real cost, but
a contained one, and the interfaces were designed for exactly that ("Graph/Gmail
later behind the same interface").

---

## 4. Data model

### 4.1 New table — `email_providers`

One row per provider the admin has touched, mirroring `ChannelConnector`'s shape
(the existing precedent for "a connector per provider, secrets encrypted, never
returned").

```sql
CREATE TABLE email_providers (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id              UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    provider                  TEXT NOT NULL,   -- google | microsoft | yahoo | smtp | ses
    enabled                   BOOLEAN NOT NULL DEFAULT false,

    -- The connected identity. Shown on the card; this is what makes a card read
    -- "Connected as support@acme.com" rather than just "Connected".
    account_email             TEXT,

    -- OAuth (google | microsoft | yahoo). Client id/secret are the operator's
    -- own app registration, entered in the admin UI — not deployment config,
    -- because SMTP is already configured from inside the admin UI and splitting
    -- email setup across two places is how half of it ends up unconfigured.
    oauth_client_id           TEXT,
    oauth_client_secret_encrypted TEXT,
    oauth_tokens_encrypted    TEXT,            -- JSON: access, refresh, expires_at, scope
    oauth_scopes              TEXT,            -- what was actually granted

    -- Manual SMTP (provider = 'smtp'), and the SMTP half of any provider that
    -- needs host overrides.
    smtp_host                 TEXT,
    smtp_port                 INT,
    smtp_username             TEXT,
    smtp_password_encrypted   TEXT,
    smtp_use_start_tls        BOOLEAN NOT NULL DEFAULT true,

    -- IMAP half, same story.
    imap_host                 TEXT,
    imap_port                 INT,
    imap_username             TEXT,
    imap_password_encrypted   TEXT,

    -- AWS SES
    ses_region                TEXT,
    ses_access_key_id         TEXT,
    ses_secret_key_encrypted  TEXT,

    -- Health, so a card can say something truthful without a round trip.
    last_verified_at          TIMESTAMPTZ,
    last_error                TEXT,
    last_polled_at            TIMESTAMPTZ,

    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, provider)
);
```

The table is wide because the credential shapes genuinely differ per provider.
The alternative — one `settings_encrypted` JSON blob — is narrower but loses the
`has*` boolean pattern the admin API depends on, and makes "which providers have
an IMAP host?" unanswerable in SQL. Explicit columns match `EmailConfig` and the
storage settings; keep them.

### 4.2 `email_configs` — what stays and what moves

**Stays** (it is workspace policy, not provider credentials):
`email_mode`, `new_ticket_via_email`, `inbound_connector`, `inbound_provider`,
`inbound_reply_domain`, `inbound_webhook_secret_encrypted`,
`poll_interval_seconds`, `from_name`, `from_email`.

**Added** — which connected provider is doing which job:

```sql
ALTER TABLE email_configs
  ADD COLUMN sending_provider_id   UUID REFERENCES email_providers(id) ON DELETE SET NULL,
  ADD COLUMN receiving_provider_id UUID REFERENCES email_providers(id) ON DELETE SET NULL;
```

`sending_provider_id IS NULL` keeps today's meaning: use the deployment's shared
relay (`Email:Smtp:*`), or the dev logger when none is set. `use_shared_smtp`
becomes redundant and is dropped by the same migration.

**Deprecated** — `smtp_host`, `smtp_port`, `smtp_user`, `smtp_password_encrypted`,
`smtp_use_start_tls`, `mailbox_protocol`, `mailbox_address`, `mailbox_host`,
`mailbox_port`, `mailbox_username`, `mailbox_password_encrypted`,
`mailbox_oauth_tokens_encrypted`.

### 4.3 The migration must carry existing configuration forward

An installation with working email must not wake up disconnected. In the same
EF migration, as a data step:

- `use_shared_smtp = false` and an `smtp_host` present → insert an `smtp` provider
  row from the `smtp_*` columns, point `sending_provider_id` at it, `enabled = true`.
- `inbound_connector = 'mailbox_poll'` → insert (or extend) a provider row from
  the `mailbox_*` columns and point `receiving_provider_id` at it.
- Everything else → no rows; `sending_provider_id` stays null, which is the
  shared relay, which is what those installations were already using.

Drop the old columns in a **second** migration, one release later, so a rollback
in between doesn't lose credentials that were never re-entered.

### 4.4 New table — `email_oauth_states` — Phase 2, not Phase 1

Exactly `SsoLoginState`'s job and shape. The `state` is echoed by the provider;
the PKCE `code_verifier` must survive the redirect and must never reach the
browser, so it lives server-side, single-use and short-lived.

```sql
CREATE TABLE email_oauth_states (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    provider      TEXT NOT NULL,
    state         TEXT NOT NULL UNIQUE,
    code_verifier TEXT NOT NULL,
    return_url    TEXT,
    expires_at    TIMESTAMPTZ NOT NULL,
    consumed_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 4.5 `LastVerifiedAt` is a lockout guard, not a health field

Commit `8d7f3ac` (password sign-in) added a coupling this feature must respect,
and getting it wrong locks an installation out of itself.

`email_configs.last_verified_at` is set only when `POST /api/admin/settings/email/test`
actually delivers a message. `LoginSettingsController` then treats
`last_verified_at IS NOT NULL` as **proof that email login can let somebody in**,
and refuses to disable the last working sign-in method without it:

```csharp
// LoginSettingsController — the guard
var usable = (password ? 1 : 0) + (email && emailWorks ? 1 : 0) + (ssoActive ? 1 : 0);
if (usable == 0) return BadRequest(…);

private Task<bool> EmailWorksAsync(Guid workspaceId, CancellationToken ct)
    => db.EmailConfigs.AnyAsync(c => c.WorkspaceId == workspaceId && c.LastVerifiedAt != null, ct);
```

Trackly is self-hosted: there is no support desk and no account recovery. A false
"email works" is a permanent lockout. Four rules follow, and none are optional:

1. **`last_verified_at` stays on `email_configs`.** It means *this installation's
   outbound email is proven*, which is a different question from
   `email_providers.last_verified_at` (*this provider's credentials authenticate*).
   Both exist; do not merge them.
2. **Phase 1 must rewrite `TestEmail` to resolve the sender through
   `EmailProviderService.ResolveSenderAsync()`.** It currently reads
   `config.UseSharedSmtp` / `SmtpHost` / `SmtpPasswordEncrypted` directly — the
   exact columns Phase 1 deprecates. Leave it as-is and the test proves the
   *shared relay* while real mail goes out through a connected provider. That
   false proof is what unlocks turning off password sign-in. **This is the single
   highest-consequence line item in the plan.**
3. **Every provider mutation clears `last_verified_at`** — connect, disconnect,
   enable/disable, credential edit, and any change of `sending_provider_id`. Today
   only `PUT /api/admin/settings/email` clears it, and after this work most
   changes to how mail is sent will not go through that endpoint.
4. **A per-provider test sets `email_providers.last_verified_at` only.** It may
   set the installation-wide flag *only* when that provider is the designated
   sender — otherwise "I tested Yahoo" would unlock disabling password login on
   an installation that actually sends through Google.

Neither the test endpoint nor `LoginSettingsController` has any UI yet. The email
screen is the natural home for the test button (§ 6.1); the login-method toggles
are a separate screen and out of scope here.

---

## 5. Backend

### 5.1 Core

- `Entities/EmailProvider.cs` — the entity above, plus an `EmailProviderKind`
  static class (`Google`, `Microsoft`, `Yahoo`, `Smtp`, `Ses`, `All`) following
  `ChannelProvider`'s pattern.
- `Entities/EmailOAuthState.cs`.
- `Interfaces/IEmailOAuthClient.cs` — **new, and deliberately not `IOidcClient`**.
  `IOidcClient` answers "who is this person" and throws the tokens away; this one
  answers "give me a refreshable mail credential":

  ```csharp
  public interface IEmailOAuthClient
  {
      string BuildAuthorizeUrl(EmailOAuthApp app, string redirectUri, string state, string codeChallenge);
      Task<OAuthTokens> ExchangeCodeAsync(EmailOAuthApp app, string redirectUri, string code, string codeVerifier, CancellationToken ct = default);
      Task<OAuthTokens> RefreshAsync(EmailOAuthApp app, string refreshToken, CancellationToken ct = default);
  }

  public record EmailOAuthApp(string Provider, string ClientId, string ClientSecret);
  public record OAuthTokens(string AccessToken, string? RefreshToken, DateTime ExpiresAt, string Scope, string? AccountEmail);
  ```

- `Interfaces/IMailboxReader.cs` — `MailboxConnection` gains an auth mode:

  ```csharp
  public record MailboxConnection(
      string Host, int Port, string Username,
      string? Password, string? AccessToken, bool UseSsl = true);
  ```

  `SmtpSettings` in `IWorkspaceEmailSender.cs` gets the same treatment. Prefer a
  nullable `AccessToken` over a discriminator enum: exactly one of the two is set,
  and the transport branches on `AccessToken is not null` in one place.

### 5.2 Infrastructure

- `Email/EmailOAuthClient.cs` — one `HttpClient`-based implementation driving a
  static per-provider endpoint table (authorize URL, token URL, scopes, whether
  the provider needs `access_type=offline&prompt=consent` to hand back a refresh
  token at all). Registered via `IHttpClientFactory`, which is already referenced.
- `Email/ImapMailboxReader.cs` — the `SaslMechanismOAuth2` branch from § 3.
- `Email/WorkspaceEmailSender.cs` — the same branch on the SMTP path.
- `Email/SesEmailSender.cs` — **only if** the SES SMTP endpoint proves
  insufficient. SES exposes an SMTP interface whose credentials derive from IAM,
  which means the SES card can reuse the existing SMTP transport and add **zero**
  new dependencies. Start there; reach for `AWSSDK.SimpleEmailV2` only if a real
  requirement (per-message tags, dedicated IPs) demands the API.

### 5.3 Modules

`Email/EmailProviderService.cs`:

- `ListAsync()` — one row per supported provider whether configured or not, the
  way `ChannelsController.List` does it. The card grid renders this directly.
- `StartConnectAsync(provider, returnUrl)` — generates state + PKCE, persists an
  `email_oauth_states` row, returns the authorize URL.
- `CompleteConnectAsync(state, code)` — consumes the state row single-use,
  exchanges the code, encrypts and stores the tokens, records `account_email`.
- `DisconnectAsync(provider)` — clears tokens and nulls any
  `sending_provider_id` / `receiving_provider_id` pointing at it. **Revoke at the
  provider too where the API allows it**; leaving a live refresh token behind
  after an admin clicks Disconnect is a real leak, not a tidiness issue.
- `GetAccessTokenAsync(provider)` — returns a valid access token, refreshing when
  it expires inside a 5-minute margin. Serialise refreshes per provider row;
  the polling worker and an outbound send can race, and some providers rotate the
  refresh token on use, so two concurrent refreshes can invalidate each other.
- `ResolveSenderAsync()` / `ResolveReceiverAsync()` — the designated provider
  turned into `SmtpSettings` / `MailboxConnection`, decrypting secrets or
  fetching a token as appropriate. This is the single place that knows how a
  provider becomes a transport.
- `TestAsync(provider)` — connect, authenticate, disconnect; write
  `email_providers.last_verified_at` / `last_error`. Mirrors `AdminApi.testStorage()`.
  It writes `email_configs.last_verified_at` **only** when this provider is the
  designated sender (§ 4.5 rule 4).
- `InvalidateProofAsync()` — clears `email_configs.last_verified_at`, called from
  every mutation in this service (§ 4.5 rule 3). One method rather than a line in
  each caller, because the one caller that forgets is the one that causes a
  lockout.

### 5.4 API

`Controllers/EmailProvidersController.cs`, `[Authorize(Policy = "Admin")]`:

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/admin/email/providers` | one row per supported provider; secrets as `has*` booleans |
| `PUT` | `/api/admin/email/providers/{provider}` | manual fields + `enabled`; `ApplySecret` semantics (null keeps, `""` clears) |
| `POST` | `/api/admin/email/providers/{provider}/connect` | returns `{ authorizeUrl }` |
| `DELETE` | `/api/admin/email/providers/{provider}` | disconnect + revoke |
| `POST` | `/api/admin/email/providers/{provider}/test` | `{ ok, error? }` |
| `PUT` | `/api/admin/email/roles` | `{ sendingProvider, receivingProvider }` |

Plus **`GET /api/email/oauth/callback`** on a separate controller — no session
policy, because the provider redirects the browser there and a cookie-authed
endpoint would 401 on some providers' redirect. It is protected by the single-use
`state` row instead, exactly as `SsoController.Callback` is. It redirects to
`{FrontendBaseUrl}/admin/settings/email?connected=<provider>` or `?email_error=…`.

`EmailSettingsController` keeps `/api/admin/settings/email` (now mode, inbound
connector, reply domain, poll interval, from name/address) and
`/api/admin/settings/notifications` unchanged.

`POST /api/admin/settings/email/test` keeps its path and its meaning — *prove
this installation can send* — but **Phase 1 rewrites its body** to resolve the
sender via `EmailProviderService.ResolveSenderAsync()` instead of reading the
`UseSharedSmtp` / `SmtpHost` columns it deprecates (§ 4.5 rule 2).

**The redirect URI must be byte-identical between start and callback**, and must
be registered in the operator's Google/Entra/Yahoo app. Reuse
`SsoController.CallbackUri()`'s approach — derive from `App:ApiBaseUrl`, fall
back to the request — and surface the exact string in the UI so the admin can
paste it into their provider console. Getting this wrong is the single most
common OAuth setup failure and it produces an opaque provider-side error.

### 5.5 Worker

`EmailPollingWorker` currently selects on
`InboundConnector.MailboxPoll && MailboxProtocol.Imap`. It changes to: load
configs with a `receiving_provider_id`, ask `EmailProviderService` for the
connection (which refreshes the token if needed), poll. The claim-before-work
`LastPolledAt` guard and the per-config interval stay as they are.

---

## 6. Frontend

**Every screen here is built in Angular. Nothing is built in `frontend/`.**
The React app is read for *behaviour* — what it fetches, what the admin can do,
which edge cases it handles — and never for markup. It is retiring, and adding UI
to it would mean writing the same screen twice and deleting one of them.

Lands in `@trackly/admin` — the app and every other library are untouched.

### 6.1 Screen

`/admin/settings/email`, replacing the `ComingSoon` entry. Structure:

```
tk-page-header            "Email" + a subtitle naming the active sender/receiver
search input              filters the card grid (visible once >6 cards exist)
card grid                 2 / 3 / 4 columns — one IntegrationCard per provider
tk-card  "Receiving"      inbound connector, reply domain, poll interval, new-ticket toggle
tk-card  "Notifications"  the 7 switches, own save button
```

**The "Send test email" button lives on this page**, in the sending section, and
it is the only UI for `POST /api/admin/settings/email/test`. Its copy must say
what the test unlocks, not just that it passed: a green tick reading "Verified"
undersells it, because this is the flag that permits turning off password
sign-in (§ 4.5). Show the address it was sent to and when — `lastVerifiedAt`
comes back on the config — and make the state visible again when a settings
change clears it, since an admin who tested last week and edited today has no
proof any more and no reason to suspect it.

The category chip row from the reference image is **deliberately not built**.
With one category it would be a single chip that filters nothing. It is a small
addition — a `computed()` over the registry and a chip row — the day a second
category exists, and the card grid should be written so that day is cheap.

### 6.2 Components

- `tk-integration-card` → `@trackly/ui`. It is not email-specific and messaging
  connectors will want the identical thing; putting it in `admin` guarantees a
  second copy later. Inputs: `name`, `category`, `description`, `logo`,
  `connected`, `enabled`, `plan` (`free` | `paid`), `favourite`;
  outputs: `enabledChange`, `favouriteChange`, `opened`.
- Provider logos: inline SVG in the `ui` icon subset, same as every other icon —
  no remote image, no `<img src>` to a CDN. Brand marks are multi-colour, so they
  need their own component rather than the `currentColor` `tk-icon` path.
- `tk-drawer` per provider for the detail/configure panel. A drawer, not a modal:
  the admin is comparing this provider against the grid behind it, which is the
  distinction `components.md` draws.

### 6.3 Data

New `projects/core/src/lib/api/email.api.ts` — typed, over `ApiService`, exported
from `core`'s `public-api.ts`. Types come from the React `frontend/src/api/email.ts`
verbatim where they survive (`NotificationSettings` is unchanged), plus the new
provider shapes.

### 6.4 The OAuth round trip

Connect posts to `/connect`, then `window.location.assign(authorizeUrl)` — a
full-page redirect, not a popup. Popups get blocked, need `postMessage` plumbing,
and break entirely in an embedded browser view. On return, the page reads
`?connected=` / `?email_error=` from the query string, shows a toast or a
`tk-alert`, and calls `providers.reload()`.

`?connected=` is a display-only breadcrumb — the provider list from the server is
the truth about connection state. Never render "Connected" from the query param.

### 6.5 Obligations

- `admin.email.*` keys in **both** `public/i18n/en.json` and `hi.json`, trees
  identical. Provider names (Google, Microsoft, Yahoo, AWS) are proper nouns and
  stay literal; everything around them is a key, `aria-label` included.
- Four states on the grid, the receiving card and the notifications card.
- No interpolated Tailwind classes — the `plan` badge and the connection dot both
  vary by state, so both need a static `Record<…, string>` lookup or a
  `styles.scss` class.
- Delete `frontend/src/pages/admin/EmailSettingsPage.tsx`, `frontend/src/api/email.ts`
  and the route that reaches them, in the same change.

---

## 7. Phasing

Each phase builds, passes `npx ng build` + `dotnet build`, and is shippable alone.

| Phase | Contents | Ships |
|---|---|---|
| **0** | Verification spikes (§ 8). No production code. | knowledge |
| **1** ✅ | `email_providers` migration with the data carry-forward; **every outbound path rewired onto `ResolveSenderAsync` (§ 4.5)**; the screen ported to Angular as cards with the SMTP/app-password and manual-IMAP paths wired, including both test buttons. | the new UI, feature parity |
| **2** | `IEmailOAuthClient`, connect/callback/disconnect/refresh, XOAUTH2 in both transports, **Google** card live. | one-click Google |
| **3** | **Microsoft** card — same flow, or Graph if Phase 0 says so. | one-click M365 |
| **4** | **Yahoo** card, then **AWS SES** outbound via the SES SMTP endpoint. | all five cards live |
| **5** | Second migration dropping the deprecated `email_configs` columns. | cleanup |

Phase 1 is the one that must not be skipped or merged into 2. It de-risks
everything after it by proving the card UI and the provider table against
credentials that already work.

### What Phase 1 actually shipped, where it differs from this plan

Three decisions were taken during the build. Each is recorded here rather than
left as a surprise in the diff.

1. **OAuth providers resolve by app password, not to null.** The plan had
   `ToSmtp`/`ToMailbox` return null for anything with `AuthKind == oauth2`, so
   Google, Microsoft and Yahoo would have been decorative until Phase 2 — three
   of five cards that an admin could fill in and that would silently fall back to
   the shared relay. But all three accept an app password over ordinary
   SMTP/IMAP, which is a complete credential, not a half-configured one. They now
   use the password path, and Phase 2 prefers XOAUTH2 when tokens are present with
   this as the fallback. The screen says so in as many words, so nobody goes
   hunting for a Connect button that does not exist yet.

2. **`ResolveSenderAsync` owns the legacy columns too, and *every* sender calls
   it.** § 4.5 named `TestEmail` as the one to rewrite. It was not the only one —
   `NotificationService` and `AnnouncementService` each had their own copy of the
   same `UseSharedSmtp` block. Fixing the test alone would have left it proving a
   transport that two of the three real senders did not use, which is the precise
   false proof § 4.5 exists to prevent. The legacy fallback now lives inside
   `ResolveSenderAsync` (and `ResolveReceiver` for the mailbox), all three callers
   go through it, and the deprecated columns are read in exactly one place — so
   Phase 5 deletes one method rather than hunting three.

3. **A separate `GET`/`PUT /api/admin/email/config`.** The new screen does not
   edit the deprecated SMTP columns, but `PUT /api/admin/settings/email` writes
   them on every save — so saving a From name through it would have cleared the
   credentials a rollback lands on, quietly undoing the whole point of keeping
   them. The narrow endpoint touches only the installation-level settings
   (identity, mode, inbound connector, poll interval) and clears the delivery
   proof, since the From address is part of what a delivered test proved. The old
   endpoint stays until Phase 5 for the React screen, which is still live.

**Deferred, deliberately:** `email_oauth_states` ships with Phase 2, not Phase 1
— an empty table with no code path is schema nobody can review against a caller.
Deleting the React page is deferred to a single cleanup pass at the end of the
whole SPA migration, at the user's instruction; both screens write compatible
data in the meantime.

---

## 8. Decide before Phase 2 — spikes, not opinions

These are the assumptions the design rests on. Each is a one-afternoon test with
a real account, and each has a concrete fallback. **Do not build against any of
them until they are checked** — provider auth policy has churned repeatedly and
current documentation beats recollection every time.

1. **Microsoft: is delegated XOAUTH2 over IMAP + SMTP AUTH still viable for M365?**
   Microsoft has been progressively retiring basic auth and tightening client
   submission, and the situation has moved more than once. Verify against current
   Microsoft docs and a live tenant.
   *Fallback:* Graph `sendMail` + `messages`, behind the existing
   `IWorkspaceEmailSender` / `IMailboxReader` interfaces.
2. **Google: which scope, and does the operator's app need verification?**
   IMAP/SMTP access uses a restricted scope. An app published **Internal** to the
   operator's own Workspace organisation should avoid the external-app assessment
   entirely — which is precisely what self-hosting buys us. Confirm that, and
   confirm the behaviour for an operator on a personal Gmail account rather than
   Workspace, which cannot publish internally.
   *Fallback:* document Workspace-only for the Google card; personal Gmail uses
   the SMTP card with an app password.
3. **Yahoo: what does registering the operator's own OAuth app involve?**
   Yahoo is **in scope** — the question is mechanics, not whether to ship it:
   which developer console the operator uses, which scope grants IMAP/SMTP, and
   whether approval is automatic or reviewed.
   *Fallback:* if approval turns out to be gated, the Yahoo card ships pointing
   at the SMTP card with an app password, and gains OAuth when the gate clears.
   The card exists either way.
4. **AWS SES: does the SMTP endpoint cover the need?** If yes, Phase 4 is
   configuration and no new dependency.

---

## 9. Risks

- **Locking the installation out of itself.** The highest-severity risk here, and
  it is not an email bug — it is `LoginSettingsController` acting on a stale or
  wrong `last_verified_at` (§ 4.5). Self-hosted means no support desk and no
  recovery. Treat every rule in § 4.5 as a correctness requirement, and cover
  them in the checklist rather than trusting review to catch them.
- **Refresh-token loss is silent.** A revoked or expired refresh token turns into
  a polling worker that logs a warning every 60 seconds while inbound email
  quietly stops. Surface it: `last_error` on the provider row, a `danger` badge on
  the card, and an entry in the notification menu. A support desk that stops
  receiving mail and says nothing is the worst failure this feature can have.
- **Token refresh races.** Two callers refreshing at once can invalidate each
  other where the provider rotates refresh tokens. Serialise per row (§ 5.3).
- **Scope creep into an integrations marketplace.** The reference image spans
  eleven categories. This plan covers email only, by instruction. The card
  component going into `@trackly/ui` is the deliberate concession to the rest —
  everything else stays out.
- **`workspace_id` stays on the new tables — this was asked and settled.**
  Self-hosting removed multi-tenancy (public sign-up, the workspace picker,
  subdomains, domain verification), not the column. `CLAUDE.md` invariant 1 keeps
  it deliberately: *"This stands even though a deployment only ever has one
  workspace — the column is what makes the guarantee checkable."* `SetupService`
  still creates one `workspaces` row with the fixed slug `default`, and every
  admin controller scopes through `User.GetWorkspaceId()`.

  Omitting it from `email_providers` and `email_oauth_states` alone would make
  them the only tables without it while `email_configs` beside them still has it,
  and would make `EmailProvidersController` the one admin endpoint that doesn't
  scope — the asymmetry that hides a real isolation bug later. Dropping it
  everywhere is a separate refactor across every entity, query and controller,
  and belongs in its own plan.

---

## 10. Documentation to update, in the same changes

- ✅ `docs/trackly-plan.md` — § Email Architecture and § Email Configuration
  updated for the provider table and the endpoint list (Phase 1).
- ✅ `docs/admin-guide.md` § 9 Email — rewritten for cards; it described dropdowns
  and pointed at "Admin ▾ → Channels → Email".
- ✅ `docs/go-live.md` — the provider table, the carry-forward migration and the
  "re-send the test after any change" rule. The shared-relay keys are unchanged.
  The per-provider OAuth callback URL lands with Phase 2.
- ~~`.claude/skills/trackly-ui/references/components.md` — a row for
  `tk-integration-card`.~~ **Not needed.** The provider card is markup inside
  `email-settings.ts`, not a component: it is used in exactly one place, and a
  design-system entry for a single caller is a shape nobody can change without
  guessing who else depends on it. Promote it if a second screen wants one.

---

## 11. Verification checklist

- [ ] Existing SMTP-configured installation still sends after the Phase 1 migration
- [ ] Existing IMAP-polling installation still receives after the Phase 1 migration
- [ ] Connect → consent → callback stores tokens; `account_email` shows on the card
- [ ] Access token refreshes automatically; polling survives expiry
- [ ] Disconnect clears tokens, revokes at the provider, and unsets the role pointers
- [ ] A provider designated for receiving is polled; a second connected-but-not-designated provider is not
- [ ] `state` is single-use — replaying a callback URL fails
- [ ] No secret is ever returned by any endpoint (`has*` booleans only)
- [ ] Test button reports a real failure with a usable message
- [ ] After Phase 1, the test sends through the **designated sending provider**, not the shared relay
- [ ] Connect, disconnect, enable, credential edit and sender reassignment each clear `email_configs.last_verified_at`
- [ ] Testing a non-sending provider does **not** set `email_configs.last_verified_at`
- [ ] With password login off and email as the only method, clearing the proof does not strand the installation — `LoginSettingsController` still refuses the unsafe transition
- [ ] Four states on every card and panel; both colour modes
- [ ] No horizontal page scroll at 380px
- [ ] `en.json` and `hi.json` structurally identical
- [ ] React email page and `frontend/src/api/email.ts` deleted
- [ ] `npx ng build` and `dotnet build` both exit 0
