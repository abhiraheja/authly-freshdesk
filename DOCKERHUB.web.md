# Trackly — self-hosted ticket management

An open-source, **self-hosted** support desk — a Freshdesk/Zendesk alternative you
run on your own infrastructure, with your own database, your own branding and
your own identity provider. **One deployment, one workspace, no sign-up page:** an
empty database is claimed once at `/setup` by whoever gets there first.

Two images make up a deployment:

| Image | Role |
|---|---|
| **`abhiraheja/trackly-web`** ← you are here | Angular SPA behind nginx — **the only port you publish**. Also reverse-proxies `/api`, `/hubs` and `/widget.js` to the API |
| [`abhiraheja/trackly-api`](https://hub.docker.com/r/abhiraheja/trackly-api) | ASP.NET Core API, SignalR live-chat hub, background workers |

They are two images but **one origin**. The session is an `HttpOnly;
SameSite=Strict` cookie, so the browser must see the SPA and the API on the same
host — publishing the API separately does not work, and nothing in the UI will
tell you why.

**Start here.** This image is the front door: it serves the compiled Angular
bundle on port **8080** and proxies everything under `/api`, `/hubs` (WebSocket
upgrade included, for live chat) and `/widget.js` to the API container. It holds
no state and needs no volume.

## Features

- 🔑 **Three ways in** — email + password, emailed magic link + 6-digit code, or your own IdP (Okta, Google Workspace, Entra ID, Authly, custom SAML/OIDC). Roles live in Trackly's database, never derived from IdP tokens at request time
- 🎫 **Ticketing** — statuses, priorities, categories, round-robin assignment, teams, watchers, private internal notes, tags, attachments, problem grouping
- ⏱️ **Service desk** — SLA policies with a live countdown, automation rules, canned responses, a public knowledge base with submit-form deflection
- 💬 **Omnichannel** — email (two-way threading), an embeddable widget, real-time live chat whose transcript becomes a ticket, and inbound Slack / WhatsApp / Teams connectors
- 🤖 **AI copilot (Claude)** — reply drafting, thread summarisation, triage suggestions, KB drafting. Opt-in per workspace; private notes are never sent to the model
- 📊 **Insight** — CSAT surveys on resolution with per-agent scores, plus volume / response-time / SLA-attainment analytics
- 🎨 **Customer surfaces in _your_ brand** — submit form, portal, KB, widget, chat and CSAT all render the workspace's branding, not Trackly's
- 🔒 **Security** — PBKDF2 password hashing, AES-256-GCM for secrets at rest, every token stored SHA-256 hashed and single-use

## Quick start

Trackly needs PostgreSQL alongside it, so the supported way to run is Docker
Compose. Save this as `docker-compose.yml`:

```yaml
name: trackly

services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_DB: trackly
      POSTGRES_USER: trackly
      POSTGRES_PASSWORD: change-me
    volumes:
      - trackly-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U trackly -d trackly"]
      interval: 5s
      timeout: 5s
      retries: 12

  api:
    image: abhiraheja/trackly-api:latest
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      ConnectionStrings__Trackly: "Host=postgres;Port=5432;Database=trackly;Username=trackly;Password=change-me"
      # REQUIRED and permanent — see below. openssl rand -base64 32
      Security__MasterKey: "CHANGE_ME_openssl_rand_base64_32"
      # The URL people type in. Emails and SSO redirects are built from it.
      App__FrontendBaseUrl: "http://localhost:8080"
      App__ApiBaseUrl: "http://localhost:8080"
      # nginx below is the only thing that reaches this service, so trust its
      # X-Forwarded-* headers. Without this every visitor shares one rate-limit
      # bucket and the session cookie loses `Secure` behind TLS.
      App__ForwardedHeaders: "true"
    volumes:
      - trackly-storage:/app/data      # attachments, logos, avatars

  web:
    image: abhiraheja/trackly-web:latest
    restart: unless-stopped
    depends_on:
      api:
        condition: service_healthy
    environment:
      TRACKLY_API_URL: http://api:8080
    ports:
      - "8080:8080"

volumes:
  trackly-pgdata:
  trackly-storage:
```

```bash
# 1. Generate the master key and paste it into Security__MasterKey above
openssl rand -base64 32

# 2. Start everything
docker compose up -d

# 3. Watch the API apply EF Core migrations on first boot
docker compose logs -f api
```

Open **http://localhost:8080**. An unclaimed installation lands on **`/setup`**:
name your organisation and create the first administrator with a password. You
are signed in immediately — no email needed, which matters because SMTP is
configured from *inside* the admin UI and does not exist yet.

> ⚠️ **`/setup` is anonymous by necessity** — there is no account to authenticate
> against yet, so **whoever reaches it first becomes your administrator.** Claim
> it the moment the URL is live. Afterwards it answers `409` forever.

## Configuration

### This image (`trackly-web`)

| Variable | Default | What it is |
|---|---|---|
| `TRACKLY_API_URL` | `http://api:8080` | Where nginx forwards `/api`, `/hubs`, `/widget.js`. **No trailing slash** — one turns into a `proxy_pass` URI and rewrites the request path |
| `TRACKLY_RESOLVER` | `127.0.0.11` | DNS used to re-resolve `TRACKLY_API_URL` per request (Docker's embedded resolver). Re-resolution is what keeps the proxy working after the API container restarts with a new IP. Change it if the API is not a compose service on the same network |
| `TRACKLY_MAX_BODY_SIZE` | `30m` | Upload ceiling at the proxy. Keep it ≥ the API's attachment limit or large uploads fail with a bare `413` before the API sees them |

Nothing about the app is baked in at build time — every API call is a relative
path, so the same image works in every environment.

### The API container (`trackly-api`)

Every key maps to an environment variable with `__` in place of `:`. Full detail
lives on [that image's page](https://hub.docker.com/r/abhiraheja/trackly-api);
repeated here so the compose file above is readable on its own.

#### Required

| Variable | What it is |
|---|---|
| `ConnectionStrings__Trackly` | PostgreSQL connection string (Npgsql format) |
| `Security__MasterKey` | Base64 **32-byte** AES-256-GCM key encrypting every stored secret — SMTP/IMAP passwords, SSO client secrets, OAuth tokens, connector signing keys. **Generate once, back it up.** If it is lost or changed, none of those values can ever be decrypted again |

#### Strongly recommended

| Variable | Default | What it is |
|---|---|---|
| `App__FrontendBaseUrl` | `http://localhost:5173` | Public URL of the app. Builds the links inside magic-link, invite and guest-tracking emails. Leave it at localhost and every recipient gets a link to their own machine |
| `App__ApiBaseUrl` | request host | Public URL used for SSO/SAML and mail-OAuth redirect URIs, and for the workspace logo in HTML email. Mail clients fetch that logo over the open internet, so an address that only resolves inside your cluster gives everyone a broken image |
| `App__ForwardedHeaders` | `false` | Trust `X-Forwarded-For` / `X-Forwarded-Proto`. **Set `true` behind a proxy** (including the `web` image). Leave `false` if the API is directly internet-reachable — these headers are client-spoofable and this flag is the trust boundary |
| `AllowedHosts` | `*` | Host header allow-list. Set your real hostname in production |

#### Optional

| Variable | Default | What it is |
|---|---|---|
| `Storage__LocalPath` | `/app/data/storage` | Where attachments, logos and avatars are written. Preset in the image — just mount a volume on `/app/data`. Per-workspace S3/Azure/GCS is configured in the admin UI |
| `Trackly__AutoMigrate` | `true` | Apply EF migrations on boot. Set `false` only if you apply them out of band, or run several replicas and want exactly one touching DDL |
| `Ai__ApiKey` | — | Anthropic API key. Empty ⇒ the AI copilot stays off everywhere |
| `Ai__Model` | `claude-opus-5` | Claude model id for the copilot |
| `Email__Smtp__Host` / `Port` / `Username` / `Password` / `FromEmail` / `FromName` | — | Deployment-level SMTP relay. Empty host ⇒ outbound mail is written to the log instead of sent. Per-workspace SMTP configured in the admin UI is the normal path; this is the shared fallback that carries sign-in mail before one exists |

## Persistence

| Mount | Holds |
|---|---|
| `postgres:/var/lib/postgresql/data` | everything |
| `api:/app/data` | attachments, workspace logos, avatars |

The API runs as **uid 1654** (non-root). `/app/data` is created with that
ownership in the image, so a *named* volume inherits it. A **bind mount does
not** — `chown -R 1654:1654` the host directory, or uploads fail with a
permission error that only appears the first time someone attaches a file.

## Production notes

- **Pin a tag.** `latest` is whatever last landed on `main`. Version tags
  (`1.2.3`, `1.2`) and `sha-<commit>` are published too.
- **Terminate TLS in front of `web`** (Caddy, Traefik, nginx) and forward
  `X-Forwarded-Proto`. Neither image does TLS itself.
- **Publish only `web`.** The API is reachable through it.
- **Keep two administrators.** There is no CLI password recovery and no reset
  script. One admin + a lost password + no working SMTP = restore from a database
  backup.
- **Back up the database.** Bulk delete (admin-only) is irreversible — no
  archive, no soft delete, no bin.
- **One API replica** if any workspace uses IMAP polling or live chat, until a
  SignalR backplane and worker leader election exist.

## Health

- API: `GET /health` — anonymous liveness, does not touch the database (first
  boot runs migrations; a DB-dependent probe would restart the container
  mid-migration).
- Web: `GET /healthz`, answered by nginx.

Both images declare a `HEALTHCHECK`, so `depends_on: condition: service_healthy`
works out of the box.

## Tech stack

ASP.NET Core 10 · EF Core · PostgreSQL 16 · SignalR · MailKit · Angular 22 ·
Tailwind v4 · nginx · Anthropic SDK

---

Source, issues and the full deployment guide:
**[github.com/abhiraheja/authly-freshdesk](https://github.com/abhiraheja/authly-freshdesk)**

**Tags:** helpdesk, ticketing, support, freshdesk-alternative, zendesk-alternative,
customer-support, self-hosted, service-desk, itsm, live-chat, knowledge-base
