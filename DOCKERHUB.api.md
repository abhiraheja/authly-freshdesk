# Trackly API

The backend half of **[Trackly](https://github.com/abhiraheja/authly-freshdesk)** —
an open-source, **self-hosted** support desk (a Freshdesk/Zendesk alternative you
run on your own infrastructure, with your own database, branding and identity
provider).

This image is **ASP.NET Core 10**: the REST API, the SignalR live-chat hub, and
the background workers (SLA breach, announcements, IMAP mail polling). It serves
no HTML.

> ### You need two images
>
> | Image | Role |
> |---|---|
> | **`abhiraheja/trackly-web`** | Angular SPA behind nginx — **the port you publish**. Also reverse-proxies `/api`, `/hubs` and `/widget.js` to this one |
> | `abhiraheja/trackly-api` | ← you are here |
>
> They are two containers but must be **one origin** to the browser. The session
> is an `HttpOnly; SameSite=Strict` cookie, so publishing this image's port
> directly — instead of going through `trackly-web` — means the cookie is never
> sent back and every request 401s. Nothing in the UI explains why.
>
> Start from the compose file on
> **[`abhiraheja/trackly-web`](https://hub.docker.com/r/abhiraheja/trackly-web)**
> rather than running this image alone.

## What it needs

- **PostgreSQL 16+.** Point `ConnectionStrings__Trackly` at it. EF Core
  migrations apply automatically on boot, so an empty database is fine — that is
  the normal first run.
- **A volume on `/app/data`** for attachments, workspace logos and avatars.
- **`Security__MasterKey`** — see below. The app refuses to start meaningful work
  without one outside Development.

```yaml
  api:
    image: abhiraheja/trackly-api:latest
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      ConnectionStrings__Trackly: "Host=postgres;Port=5432;Database=trackly;Username=trackly;Password=change-me"
      Security__MasterKey: "CHANGE_ME_openssl_rand_base64_32"   # openssl rand -base64 32
      App__FrontendBaseUrl: "https://support.example.com"
      App__ApiBaseUrl: "https://support.example.com"
      App__ForwardedHeaders: "true"     # required behind trackly-web / any proxy
    volumes:
      - trackly-storage:/app/data
    # No `ports:` — trackly-web is what the browser talks to.
```

## Configuration

Every key maps to an environment variable with `__` in place of `:`.

### Required

| Variable | What it is |
|---|---|
| `ConnectionStrings__Trackly` | PostgreSQL connection string (Npgsql format) |
| `Security__MasterKey` | Base64 **32-byte** AES-256-GCM key encrypting every stored secret — SMTP/IMAP passwords, SSO client secrets, OAuth tokens, connector signing keys. **Generate once, back it up.** If it is lost or changed, none of those values can ever be decrypted again |

### Strongly recommended

| Variable | Default | What it is |
|---|---|---|
| `App__FrontendBaseUrl` | `http://localhost:5173` | Public URL of the app. Builds the links inside magic-link, invite and guest-tracking emails. Leave it at localhost and every recipient gets a link to their own machine |
| `App__ApiBaseUrl` | request host | Public URL used for SSO/SAML and mail-OAuth redirect URIs, and for the workspace logo in HTML email. Mail clients fetch that logo over the open internet, so an address that only resolves inside your cluster gives everyone a broken image |
| `App__ForwardedHeaders` | `false` | Trust `X-Forwarded-For` / `X-Forwarded-Proto`. **Set `true` behind `trackly-web` or any proxy** — without it the per-IP auth rate limiter collapses onto a single bucket and the session cookie silently loses `Secure` behind TLS termination. Leave `false` if this container is directly internet-reachable: the headers are client-spoofable and this flag is the trust boundary |
| `AllowedHosts` | `*` | Host header allow-list. Set your real hostname in production |

### Optional

| Variable | Default | What it is |
|---|---|---|
| `Storage__LocalPath` | `/app/data/storage` | Where attachments, logos and avatars are written. Already set in the image — just mount a volume on `/app/data`. Per-workspace S3/Azure/GCS is configured in the admin UI |
| `Trackly__AutoMigrate` | `true` | Apply EF migrations on boot. Set `false` only if you apply them out of band, or run several replicas and want exactly one touching DDL |
| `Ai__ApiKey` | — | Anthropic API key. Empty ⇒ the AI copilot stays off everywhere |
| `Ai__Model` | `claude-opus-5` | Claude model id for the copilot |
| `Email__Smtp__Host` / `Port` / `Username` / `Password` / `FromEmail` / `FromName` | — | Deployment-level SMTP relay. Empty host ⇒ outbound mail is written to the log instead of sent. Per-workspace SMTP configured in the admin UI is the normal path; this is the shared fallback that carries sign-in mail before one exists |
| `ASPNETCORE_ENVIRONMENT` | `Production` | Leave it. `Development` exposes a demo-data seeder and a fixed fallback master key |

## Storage permissions

The container runs as **uid 1654** (non-root). `/app/data` is created with that
ownership in the image, so a **named volume inherits it** and needs nothing.

A **bind mount does not** — `chown -R 1654:1654` the host directory first, or
uploads fail with a permission error that only surfaces the first time someone
attaches a file to a ticket.

## Health

`GET /health` — anonymous, returns `{"status":"ok"}`, and **deliberately does not
touch the database**: first boot runs EF migrations, and a probe that waited on
the DB would restart the container mid-migration. Use it for liveness, not
readiness.

A `HEALTHCHECK` is declared in the image, so `depends_on: condition:
service_healthy` works out of the box.

## Scaling

Run **one replica** if any workspace uses IMAP mail polling or live chat. The
SignalR hub is in-process (no backplane yet) and the mail/announcement workers
have no leader election, so a second replica would double-poll mailboxes and
split chat connections. Everything else is stateless.

## Ports & tags

- Listens on **8080** (HTTP). It does not terminate TLS — that belongs in front
  of `trackly-web`.
- Tags: `latest` (whatever last landed on `main`), `sha-<commit>`, and `X.Y.Z` /
  `X.Y` on releases. **Pin a version or digest in production.**

## Tech stack

ASP.NET Core 10 · EF Core · PostgreSQL 16 · SignalR · MailKit ·
ITfoxtec SAML2 · Anthropic SDK

---

Source, issues and the full deployment guide:
**[github.com/abhiraheja/authly-freshdesk](https://github.com/abhiraheja/authly-freshdesk)**
