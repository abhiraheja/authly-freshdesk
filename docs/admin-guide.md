# Trackly — Admin Guide

A practical, feature-by-feature handbook for **workspace admins**. For each
feature you get: **what it is**, **how to set it up**, and **how to use it**.

> This is the product/usage guide. Two companion docs cover other angles:
> - **`docs/go-live.md`** — deploying Trackly to a server (config keys, secrets,
>   infrastructure). Anything marked _“deployment-level”_ below lives there.
> - **`docs/trackly-plan.md`** — the architecture/design reference for engineers.

---

## Contents

1. [Core concepts](#1-core-concepts)
2. [Getting started](#2-getting-started)
3. [Access & identity](#3-access--identity)
   - 3.1 Passwordless login · 3.2 Members & roles · 3.3 SSO (OIDC/SAML) · 3.4 Domains & login routing
4. [Ticketing](#4-ticketing)
   - 4.1 Tickets & the agent workspace · 4.2 Categories · 4.3 Customer portal · 4.4 Guest submission
5. [Agent productivity](#5-agent-productivity)
   - 5.1 Canned responses · 5.2 Tags · 5.3 Teams & routing · 5.4 Problems
6. [SLA policies](#6-sla-policies)
7. [Automation rules](#7-automation-rules)
8. [Knowledge base](#8-knowledge-base)
9. [Email](#9-email)
10. [Branding](#10-branding)
11. [Embeddable widget](#11-embeddable-widget)
12. [Announcements](#12-announcements)
13. [AI copilot](#13-ai-copilot)
14. [Omnichannel connectors (Slack / WhatsApp / Teams)](#14-omnichannel-connectors)
15. [Live chat](#15-live-chat)
16. [CSAT (satisfaction surveys)](#16-csat)
17. [Analytics](#17-analytics)
18. [Where everything lives (nav map)](#18-where-everything-lives)
19. [Security & privacy you should know](#19-security--privacy-you-should-know)

---

## 1. Core concepts

- **Workspace** — your organisation’s isolated tenant. Every ticket, user, and
  setting belongs to exactly one workspace; data is never shared across
  workspaces.
- **Roles** (stored in Trackly, not derived from your IdP):
  - **Admin** — full access, including all settings in the **Admin ▾** menu.
  - **Agent** — works tickets, chat, KB, canned responses; no settings access.
  - **Customer** — your end users; they see only the portal / branded surfaces,
    never Trackly’s interface.
- **Two faces of Trackly:**
  - **Agent/admin surfaces** carry the **Trackly** look (with dark mode).
  - **Customer-facing surfaces** (submit form, portal, guest view, widget, KB,
    live chat, CSAT, notification emails) carry **your workspace branding** and
    are always light. Setting up branding (§10) changes all of them at once.
- **Sessions** — login issues an HttpOnly session cookie. There are **no
  passwords** anywhere in Trackly.

---

## 2. Getting started

1. **Create your workspace.** Sign up with your work email; you’ll get a 6-digit
   code / magic link (see §3.1), then name your workspace and pick a slug (the
   slug appears in customer URLs like `/submit?workspace=<slug>`).
2. **Invite your team** — **Admin ▾ → People → Members** (§3.2).
3. **Set your branding** — **Admin ▾ → Workspace → Branding** (§10) so customer
   surfaces show your logo and colour.
4. **Decide how tickets arrive** — a shareable submit form and portal work out of
   the box; add **email** (§9), the **widget** (§11), **live chat** (§15), or
   **messaging connectors** (§14) as needed.
5. **Optional power features:** SLA policies (§6), automation (§7), knowledge
   base (§8), AI copilot (§13).

---

## 3. Access & identity

### 3.1 Passwordless login

**What it is.** Everyone signs in without a password. Trackly emails a **magic
link** and a **6-digit code**; either one signs you in. Logging in with a new
address creates the account (sign-up = login).

**Set up.** Nothing to configure — it works as soon as outbound email is
available (§9; without an SMTP relay, codes are written to the server log for
local testing). You can disable email login per workspace if you require SSO
only (the toggle lives with the workspace’s login settings).

**Use.** Users enter their email on the login page, then paste the code or click
the link. Verify links are single-use and safe against email-scanner prefetch
(the link is only consumed when the user confirms, not when it’s opened).

### 3.2 Members & roles

**What it is.** Your team directory: invite agents/admins and manage their roles.
**Where:** **Admin ▾ → People → Members**.

**Set up / use.**
- **Invite** — enter an email, choose **Agent** or **Admin**, send. The invitee
  gets an email with a join link **valid for 7 days**.
- **Change a role** — pick a new role on any member row; it takes effect on their
  next request (no re-login needed).
- Roles always come from Trackly’s own records — never from an SSO token at
  request time (see §3.3 for how SSO groups map to roles **at login**).

### 3.3 SSO (OIDC / SAML)

**What it is.** Let your team sign in with your identity provider — **Okta,
Google, Entra ID, Authly, or any standard OIDC/SAML IdP**. Trackly still owns its
users, roles, and sessions; the IdP only authenticates.
**Where:** **Admin ▾ → Workspace → SSO**.

**Set up (OIDC).**
1. In your IdP, create an app and add Trackly’s **redirect URI**:
   `{your-domain}/api/auth/sso/callback`.
2. In Trackly SSO settings, enter the **discovery URL**, **client ID**, and
   **client secret** (the secret is encrypted at rest and never shown again).
3. Optionally add **group → role mappings** so an IdP group provisions the right
   Trackly role. Mapping is applied **at login only**.

**Set up (SAML).**
1. Give your IdP Trackly’s **ACS URL** `{your-domain}/api/auth/saml/acs` and **SP
   metadata** `{your-domain}/api/auth/saml/metadata?workspace=<slug>`.
2. Paste the IdP metadata into Trackly. The IdP’s response signature is validated
   against that metadata.

**Use.** New SSO users are auto-created on first login (JIT provisioning) with the
role from your group mapping (default: customer if unmapped). SSO and magic-link
login coexist. _Deployment note: callback URLs must be public HTTPS — see
go-live.md §5._

### 3.4 Domains & login routing

**What it is.** Verify email domains you own so users at those domains are routed
to the right login experience (e.g. straight to your SSO).
**Where:** **Admin ▾ → Workspace → Domains**.

**Set up.** Add a domain; Trackly gives you a **DNS TXT record** to publish. Once
it resolves, the domain is verified. (Requires the server to make outbound DNS
lookups — deployment concern.)

---

## 4. Ticketing

### 4.1 Tickets & the agent workspace

**What it is.** The heart of Trackly. A ticket has a **subject/description**, a
**status** (open → pending → resolved → closed), a **priority** (low / medium /
high / urgent), an optional **category**, an **assignee**, **watchers**, **tags**,
**attachments**, and a threaded conversation.
**Where:** agents work in **Tickets** (a three-pane workspace: list · conversation
· details).

**Use.**
- **Reply** to the customer, or add a **private note** (internal-only — never
  shown to customers or guests; this is enforced server-side).
- **Assign / reassign**, add **watchers**, set **priority/category/team**, and
  **tag** from the details pane.
- **Attach files** to the ticket or a specific reply.
- The **✨ AI** actions (draft reply, summarize, triage, KB draft) appear here when
  the copilot is on (§13).

### 4.2 Categories

**What it is.** An organising dimension for tickets (e.g. Billing, Technical).
Categories are per-workspace and used for filtering, automation, and reporting.

**Set up / use.** Categories are applied to a ticket from the details pane.
Admins create them via the API (`POST /api/categories`) or they arrive with demo
data; automation can also route by category (§7). _(There is no dedicated
category-management screen yet — this is a known gap.)_

### 4.3 Customer portal

**What it is.** A signed-in space where your customers see **their own** tickets
and replies, branded as your workspace.
**Where (customer):** `/portal`.

**Set up.** Nothing beyond branding (§10). Customers reach it after signing in
(magic link) or from links in notification emails.

### 4.4 Guest submission

**What it is.** Anyone can raise a ticket without an account via a branded submit
form; they verify with a one-time code and get a private **tracking link** to
follow the ticket.
**Where (customer):** `/submit?workspace=<slug>`.

**Use.** Share the submit URL, embed the widget (§11), or let email create guest
tickets (§9). Guests view their ticket through the emailed tracking link — they
never see private notes.

---

## 5. Agent productivity

### 5.1 Canned responses

**What it is.** Reusable reply snippets. **Where:** **Canned** (top nav) to
manage; agents insert them with the **⚡** button in the reply box.

**Set up / use.** Create a titled snippet; agents pick it while replying and edit
before sending.

### 5.2 Tags

**What it is.** Free-form labels on tickets for triage and search. Tags are
**agent-only** — customers never see them.

**Use.** Add tags from the ticket details pane (existing tags autocomplete, or
type a new one). Automation can add tags automatically (§7); AI triage can
suggest them (§13).

### 5.3 Teams & routing

**What it is.** Groups of agents (e.g. Billing team). A ticket routed to a team is
**round-robin assigned** among that team’s members only.
**Where:** **Admin ▾ → People → Teams**.

**Set up.** Create a team, add members. Then route tickets to it manually (details
pane) or automatically via an automation rule (§7, “Assign team”).

### 5.4 Problems

**What it is.** Group many related tickets under one underlying **problem** (e.g.
an outage), so you can track and communicate once.
**Where:** **Problems** (top nav).

**Use.** Create a problem, link the affected tickets, and update its status as you
investigate and resolve.

---

## 6. SLA policies

**What it is.** Per-priority response and resolution targets, shown as a live
countdown badge (green → amber → red) on tickets. The **resolve clock pauses while
a ticket is pending** and resumes when it’s reopened.
**Where:** **Admin ▾ → Workflow → SLA policies**.

**Set up.** For each priority, set **first-response** and **resolution** targets
in minutes. New tickets are stamped with due dates on creation.

**Use.** Agents see the SLA badge on each ticket; **Analytics** (§17) reports
first-response and resolution **attainment** (the % met on time).

---

## 7. Automation rules

**What it is.** “When *this*, do *that*” rules that run on ticket **create** or
**update**. **Where:** **Admin ▾ → Workflow → Automation**.

**Set up.** Each rule has:
- **When** — *Ticket created* or *Ticket updated*.
- **Conditions** — field **is / is not / contains** a value (e.g. priority *is*
  urgent).
- **Actions** — **Set priority**, **Assign team**, or **Add tag**.
- **Enabled** toggle and an order (rules run top-down).

**Use / safety.** A rule’s own changes aren’t re-evaluated in the same pass, so
rules can’t loop; a malformed rule is skipped, not fatal. Example: *when priority
is urgent → add tag “sev1” and assign the on-call team*.

---

## 8. Knowledge base

**What it is.** Self-service help articles. Drafts are private; **published**
articles appear on your branded public help centre and are suggested to customers
on the submit form (deflection).
**Where:** **Knowledge** (top nav) to author; **customer:** `/kb?workspace=<slug>`.

**Set up / use.**
- Write an article, keep it **Draft** while editing, then **Publish**.
- Only published articles are ever public; drafts and other workspaces’ articles
  never leak.
- The AI copilot can **draft a KB article from a resolved ticket** (§13) — it’s
  saved as a draft for you to review and publish.

---

## 9. Email

**What it is.** Two-way email: Trackly **notifies** customers/agents by email, and
customers can **reply by email** (or email you to open a ticket).
**Where:** **Admin ▾ → Channels → Email**.

**Set up — interaction mode & sending.**
- **Interaction mode** — notifications-only, or notifications **plus inbound**
  replies.
- **Sending** — use the deployment’s shared relay, or enter your **own SMTP**
  host/credentials (encrypted at rest) and a From name/address.

**Set up — inbound (pick one):**
- **Parse webhook** — add an **MX record** on a subdomain pointing at your email
  provider (SendGrid/Mailgun/…), which posts inbound mail to Trackly. Trackly
  verifies an HMAC signature against your stored webhook secret.
- **Mailbox polling (IMAP)** — enter a mailbox host/user/app-password; Trackly
  polls it on an interval. _(Requires the server to run continuously — a
  deployment concern; see go-live.md §4.)_
- **New ticket via email** toggle — turn cold inbound mail into tickets (off by
  default).

**Set up — notifications.** Toggle each notification (customer on create/reply/
status; agent on assign/reply/reassign) and the **CSAT survey** on resolution
(§16). Replies from non-participants are rejected; private notes never go out.

_Deployment note: without a configured relay, mail is written to the server log —
fine for testing, not for real users._

---

## 10. Branding

**What it is.** Your logo, primary colour, page title, welcome/footer text applied
to **every customer-facing surface** (submit form, portal, guest view, widget, KB,
live chat, CSAT, notification emails). Trackly’s own agent/admin screens are
unaffected.
**Where:** **Admin ▾ → Workspace → Branding**.

**Set up.** Upload a logo, pick a primary colour, set the page title and copy.
Changes apply everywhere customers see you.

---

## 11. Embeddable widget

**What it is.** A snippet you drop on your website so visitors can reach support
without leaving your site. **Where:** **Admin ▾ → Channels → Widget**.

**Set up.** Choose an **embed type** (floating button / inline / link) and a
**theme**, pick which **fields** the form collects, then copy the generated embed
snippet onto your site. The widget renders your branded submit form.

_Deployment note: `/widget.js` and the widget endpoints must be reachable over
HTTPS from wherever you embed them (go-live.md §8)._

---

## 12. Announcements

**What it is.** Broadcast messages to your customers, optionally **scheduled** for
a future time. **Where:** **Admin ▾ → Insights → Announcements**.

**Set up / use.** Compose an announcement and send now or schedule it; a
background worker sends scheduled announcements at the set time. _(The scheduler
assumes a single running server instance — deployment concern.)_

---

## 13. AI copilot

**What it is.** Claude-powered **assists for agents**: draft a reply, summarize a
thread, suggest triage (priority/category/tags/sentiment), and draft a KB article
from a resolved ticket. Everything is **agent-reviewed** — nothing is ever sent to
a customer automatically.
**Where:** **Admin ▾ → Workflow → AI copilot**.

**Set up (two switches, both required).**
1. **Deployment key** — an admin must set the Claude API key on the server
   (`Ai:ApiKey`; see go-live.md §1). Until then the settings page shows *not
   configured* and all AI actions stay off.
2. **Workspace toggle** — turn **AI copilot** on for your workspace.

When both are on, agents see **✨** actions on tickets.

**Use / privacy.** The model receives the ticket subject/description, the public
thread, and (for reply drafts) published KB excerpts. **Private notes and other
workspaces’ data are never sent.** Triage suggestions apply with one click;
KB drafts save as drafts for your review.

---

## 14. Omnichannel connectors

**What it is.** Bring **Slack, WhatsApp, and Microsoft Teams** conversations into
Trackly as tickets, threaded per conversation, feeding the same pipeline as email.
**Where:** **Admin ▾ → Channels → Messaging**.

**Set up.**
1. For each provider, toggle it **on** and set a **signing secret** (stored
   encrypted; never shown again). Copy the per-provider **webhook URL** shown on
   the page.
2. Stand up a small **relay** in front of the provider (this is a deployment task)
   that translates the provider’s native payload into Trackly’s format and signs
   the request with your secret (`X-Trackly-Signature`, HMAC-SHA256). The relay +
   provider app credentials live outside Trackly.

**Use.** A new conversation opens a ticket (channel = the provider); follow-up
messages thread into the same ticket; retried deliveries are de-duplicated;
badly-signed requests are rejected. See go-live.md §8 for the relay model.

---

## 15. Live chat

**What it is.** Real-time chat between visitors and agents, with presence and
typing indicators. **When a chat ends, the whole transcript becomes a ticket.**
**Where (agent):** **Chat** (top nav) — the live console.
**Where (customer):** `/chat?workspace=<slug>` (branded).

**Set up.** Works out of the box for visitors and agents. The first agent to reply
**claims** the chat. _Deployment note: live chat uses WebSockets — the server
must allow the WebSocket upgrade on `/hubs/*`, and run as a single instance (or
add a SignalR backplane). See go-live.md §8._

**Use.** Agents watch the console for incoming chats, respond in real time, and
click **End → ticket** to file the transcript (each message becomes a comment).
Visitors can also end the chat themselves.

---

## 16. CSAT

**What it is.** A **customer satisfaction survey** sent when a ticket is resolved.
The customer rates 1–5 (with optional comment) via a branded page; scores are
attributed **per agent** for reporting.

**Set up.** Toggle **“Include a satisfaction survey link in the resolution
email”** in **Admin ▾ → Channels → Email** (on by default). Requires the
resolution notification to be enabled and outbound email available.

**Use.** On resolve, the customer gets a rating link (single-use — a ticket can’t
be rated twice). Agents see the rating on the ticket; **Analytics** (§17) shows
the workspace average and a per-agent CSAT column.

---

## 17. Analytics

**What it is.** A workspace performance dashboard over a trailing window (7 / 30 /
90 days). **Where:** **Admin ▾ → Insights → Analytics**.

**Reports:** tickets created & resolved, **average first-response and resolution
time**, **first-response / resolution SLA attainment**, **CSAT** average and
response count, a per-day **volume** chart, channel/status breakdowns, and an
**agent leaderboard** (resolved count, avg times, avg CSAT).

_Not yet included: deflection rate (needs self-service-session instrumentation) —
a known gap._

---

## 18. Where everything lives (nav map)

**Top nav (agents & admins):** Dashboard · Tickets · Chat · Problems · Knowledge ·
Canned.

**Admin ▾ (admins only):**

| Group | Items |
|---|---|
| **Insights** | Analytics · Announcements |
| **People** | Members · Teams |
| **Workflow** | SLA policies · Automation · AI copilot |
| **Channels** | Messaging (connectors) · Widget · Email |
| **Workspace** | Branding · SSO · Domains |

**Customer-facing URLs:** `/submit` · `/portal` · `/kb` · `/chat` · guest tracking
& CSAT links (emailed), all with `?workspace=<slug>` where shown.

---

## 19. Security & privacy you should know

- **Workspace isolation** — every query is scoped to your workspace; no
  cross-workspace access, ever.
- **No passwords** — login is magic link / code / SSO only.
- **Secrets encrypted at rest** — SSO client secrets, SMTP/IMAP credentials, and
  connector signing secrets are AES-256-GCM encrypted and never shown again after
  saving (you’ll see “set”, and can rotate).
- **Tokens are hashed** — session, magic-link, guest, invite, CSAT, and chat
  tokens are stored hashed and are single-use where applicable.
- **Private notes never leak** — internal notes are filtered server-side; they’re
  never sent to customers, guests, connectors, or the AI model.
- **Roles are Trackly’s** — never taken from an IdP token at request time; SSO
  group→role mapping applies only at login.
- **AI needs both switches** — the deployment key and the workspace toggle; with
  either off, no data is sent to the model.

---

_Keep this guide updated when features change — it’s the admin-facing counterpart
to `docs/trackly-plan.md` (design) and `docs/go-live.md` (deployment)._
