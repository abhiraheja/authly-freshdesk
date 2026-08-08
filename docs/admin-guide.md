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
   - 4.1 Tickets & the agent workspace · 4.2 Statuses & workflow · 4.3 Registers · 4.4 Categories · 4.5 Customer portal · 4.6 Guest submission
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
20. [Attachment storage](#20-attachment-storage)
21. [Profile photos](#21-profile-photos)
22. [Resolution notes & time tracking](#22-resolution-notes--time-tracking)

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
**status** (whatever your workspace has defined — see §4.2), a **priority**
(low / medium / high / urgent), an optional **department** and **category**, an
**assignee**, **watchers**, **tags**, **attachments**, and a threaded
conversation.

**Department and category are different things.** The department (a *team*,
§5.3) is who the ticket is routed to — IT Support, Facilities. The category
(§4.4) is what it is about — Billing, Hardware. The ticket list shows both, in
their own columns.
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

**Raising a ticket from inside Trackly.** **Tickets → New ticket** (also the
**+ New ticket** button in the top bar) takes a subject, description, priority,
category, channel, tags and one attachment up to 10 MB.

Category, channel and tags are **type-ahead fields, not pickers**: what already
exists in the workspace is suggested as you type, and a value that doesn't exist
yet is created when the ticket is saved — never before, so an abandoned form
leaves nothing behind. Matching is case-insensitive, so "Billing" and "billing"
stay one thing rather than splitting every report in two. Only agents and admins
can introduce new values this way; a customer filing from the portal cannot.

Two things about it are worth knowing before you use it:

- The ticket is filed with **you** as the requester — there is no "on behalf of"
  field. It is meant for work an agent raises for themselves (an internal
  request, a phone call they are logging against their own account), not for
  filing a customer's issue under the customer's name. For that, the customer
  should come in through email, the portal, the widget or the guest form so the
  requester is genuinely them.
- The **assignee is chosen automatically** — the active agent with the fewest
  open and pending tickets (team routing applies where configured, §5.3). You
  cannot pick one at creation; reassign afterwards from the details pane.

### 4.2 Statuses & workflow

**Where:** Admin → Statuses & workflow (`/admin/settings/statuses`). Admin only.

**What it is.** The states a ticket can be in, and which moves between them are
allowed. Trackly ships five and you invent the rest.

**The five categories are fixed; the statuses under them are yours.** Want
`Todo → Estimated → In review → Done`? Create exactly those, and file each one
under a category so the rest of the product still knows what it means.

**Everything in Trackly reads the CATEGORY, never the name.** This is the one
thing to understand before you add anything:

| Category | What it does to a ticket |
|---|---|
| **Open** | Counts as open. SLA clocks run. A new ticket starts here. |
| **Pending** | Counts as open, but **SLA clocks pause** — when the ticket leaves, the waiting time is added back onto both deadlines. |
| **Active** | Counts as open. SLA clocks run. For work somebody has actually picked up. |
| **Resolved** | Ends the ticket. Clocks stop, a resolution note is **required** (§22), and the customer gets the resolution email plus the CSAT survey (§16). |
| **Closed** | Ends the ticket. Clocks stop and a resolution note is required, but **no survey** is sent. |

So a status called "Waiting on customer" only pauses the SLA if you file it
under **Pending**. Filing it under Open makes a ticket that quietly breaches
while you wait on somebody else.

**Set up.**
- **Add** — type a name in the box at the foot of a category and press Add. The
  stored value is derived from the name (`Testing Required` → `testing-required`)
  and never changes afterwards, so renaming is always safe.
- **Reorder** — the arrows. The order here is the order agents see in the picker,
  and it decides which status Trackly picks when it has to act on its own (a
  problem resolving all its tickets, an automation rule saying "close it"): the
  first active status in that category.
- **Default** — where new tickets start. Exactly one, always.
- **Hide** — retires a status. It disappears from every picker, but tickets
  already in it keep their label. **Prefer this to deleting.**
- **Delete** — only offered for a status you created that no ticket is using.
  Built-in statuses cannot be deleted at all. This is deliberate: a ticket
  holding a value with no status behind it renders as a raw slug, and the
  database looks corrupt when the truth is that somebody tidied up.

**Workflow (second tab).** A grid — rows are where the ticket is now, columns
are where it may go. Tick a cell to allow that move.

- The first row is **Any status**, which allows a move from wherever the ticket
  happens to be. Every status starts with this, so a workspace that never opens
  this screen behaves as Trackly always has.
- A cell already covered by the Any row shows ticked and greyed — it is allowed
  either way, and clearing it here would do nothing.
- Staying put is always allowed, so the diagonal is a dash.
- **An empty grid means everything is allowed, not nothing.** That rule exists so
  no workspace can lock every ticket in place. Tick at least one cell to take
  real control.
- The screen warns you if a status has become unreachable — easy to build, looks
  fine, and the only symptom is an agent finding an option missing weeks later.
- **Save replaces the whole workflow** in one go. Nothing is half-applied.

**Where it is enforced.** On the ticket screen, and on `PATCH /api/tickets/{id}`
behind it — an agent is told "this ticket cannot move straight to X". Automation
rules and problem bulk-resolve set a status directly and are **not** checked
against the workflow: those are your own rules acting, not somebody
freehand-editing a ticket.

### 4.3 Registers: assets, services & your own properties

**Where:** Admin → Registers (`/admin/settings/catalogue`). Agents read all three;
only admins change what is on them.

**Assets** — the machines, licences and equipment you support. Deliberately thin:
name, kind, tag, location, who has it. It is not a CMDB, and building a bad one
is worse than building none, because people put data in it and then cannot trust
it. What it buys you is the number on the ticket screen: *"this laptop has 4
other tickets"* turns a register from a list of nouns into the reason to replace
the machine.

**Services** — what your customers depend on: Payments, Email, the VPN. An asset
is a thing you own; a service is a thing you promise, and you want to count them
separately. Give each one an owning department and the catalogue answers "who do
we call" without asking.

**Ticket properties** — anything your workspace tracks that Trackly does not.
Four types: **Text**, **Dropdown**, **Radio buttons**, **Checkbox**.

- A **dropdown can learn.** Tick *"Let agents type a new value, and remember it"*
  and the first agent to type "Mumbai" adds it to the list for everybody. Without
  that, filling in a ticket means stopping to ask an admin, and the field gets
  left blank instead.
- **Required** blocks an agent saving the ticket. It never blocks an inbound
  email or a chat becoming a ticket — the customer has never seen your field, and
  dropping their message over it is not a trade any workspace would choose.
- **The label is editable; the type is not.** Turning a text field into a
  checkbox would leave a column of sentences that render as neither ticked nor
  unticked, and there is no honest way to convert them. Retire it and make a new
  one.
- **Retire rather than delete.** A retired field leaves the form but its answers
  stay, and a ticket that already answered it still shows the answer. Delete is
  only offered once nothing has answered it.

_These are your properties, not Trackly's: they are stored, shown and searched,
but no SLA, automation rule or report acts on them. That is the trade for being
able to invent them._

### 4.4 Categories

**What it is.** An organising dimension for tickets (e.g. Billing, Technical).
Categories are per-workspace and used for filtering, automation, and reporting.

**Set up / use.** Categories are applied to a ticket from the details pane.
Admins create them via the API (`POST /api/categories`) or they arrive with demo
data; automation can also route by category (§7). _(There is no dedicated
category-management screen yet — this is a known gap.)_

### 4.5 Customer portal

**What it is.** A signed-in space where your customers see **their own** tickets
and replies, branded as your workspace.
**Where (customer):** `/portal`.

**Set up.** Nothing beyond branding (§10). Customers reach it after signing in
(magic link) or from links in notification emails.

### 4.6 Guest submission

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
**in hours** — `0.5` is fine for half an hour. Leave a box **blank** for no
target: that leg's clock simply does not run, which is different from a target
of zero. Press **Save SLA targets**.

New tickets are stamped with due dates on creation. **Changing a policy does not
move tickets that already have deadlines** — they keep the ones they were given.
It applies to new tickets, and to any ticket whose priority changes afterwards.

**One exception, and it matters on day one.** A ticket raised *before* anybody
configured SLA has no deadlines at all — it was never given any. Saving a policy
adopts those: every **open or pending** ticket of that priority that has no
targets gets them, measured from when it was created. Without this, every ticket
raised before you reached this screen would stay outside SLA for the rest of its
life with no way to bring it in.

> Expect some of them to appear **already breached**, and that is the honest
> reading — you have just declared that an urgent ticket gets two hours, and a
> day-old unanswered urgent ticket is late by that standard. Resolved and closed
> tickets are left alone; the work is over and a deadline on it is a number
> nobody can act on.

**On a resolved ticket** the SLA card says the clock *stopped*, not that no
policy covers it, and shows whether the ticket beat its resolve target.

**Use.** Agents see the SLA badge on each ticket; **Analytics** (§17) reports
first-response and resolution **attainment** (the % met on time).

### 6.1 Business hours

**Where:** on the same screen, under the targets.

**Off by default, and off means round-the-clock.** A four-hour target is four
real hours, whatever the day or time. That is right for a 24/7 desk and wrong for
everyone else: a ticket raised at 17:55 on Friday with a four-hour target is
breached before anyone is back at their desk. That is not a missed SLA, it is a
badly measured one — and a team that stops trusting the number stops looking at
it.

**Switch it on** and the clocks only run while you are open. Set a **time zone**
(IANA name — `Asia/Kolkata`, `Europe/London`; it decides what "9am" means), tick
the days you work, and give each one an opening and closing time. An unticked day
is closed. **Holidays** shut the desk for a whole date regardless of the weekly
pattern.

With Mon–Fri 09:00–17:00, a ticket raised Saturday night with a two-hour target
is due **Monday at 11:00**.

**Deadlines already stamped on tickets are left alone.** They were promised under
the old schedule, and quietly moving a queue of due dates is how an agent finds a
ticket late that was not late a minute ago. This changes what new tickets get.

### 6.2 Breach alerts

Trackly sweeps every minute and sends **two** notifications, each **once**:

- a **warning** thirty minutes before a deadline, while there is still time to act;
- a **breach** when the deadline passes.

They go to the assignee, the responders and the watchers — **never the customer**.
A missed internal target is a fact about the desk, not about them.

Once each, deliberately. A ticket stays late from the moment it goes late until
somebody acts, so a sweep that kept re-checking would resend the same warning
every minute until the recipient filtered the lot into a folder — at which point
the feature is worse than nothing, because it looks like it is working.

Resolved, closed and **pending** tickets are skipped: the first two are over, and
a pending ticket's clock is deliberately paused. Reopening a ticket resets the
markers, so it can warn again on its second life.

### 6.3 The scorecard

**Where:** under business hours, readable by every agent.

Per agent, over the last 30 days, counted from tickets **they finished**: how many
they resolved, how many first responses and resolutions met their target out of
how many were measurable, and the **attainment** — the share of measurable legs
met.

**A ticket with no policy is neither met nor missed**, so it is left out of both
halves. Attainment shows as **—** rather than 0% when nothing they finished had a
target: "0%" reads as failure and the truth is that no target applied.

> **Trackly does not give agents a points score, and that is a decision, not a
> gap.** An invented formula in a support tool gets gamed within a month — agents
> cherry-pick easy tickets, or close and reopen to reset a clock — and the number
> stops measuring anything. What is here is the raw record plus one figure that is
> defensible on its own terms.

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
| **Workflow** | Statuses & workflow · SLA policies · Automation · AI copilot |
| **Ticket view** | Registers (§4.3) · Ticket layout (§23) |
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

## 20. Attachment storage

**What it is.** Where files uploaded to tickets — and your logo — are kept. By
default that is Trackly's own server; you can point it at **your own** Azure Blob
Storage or Google Cloud Storage bucket instead.
**Where:** **Admin ▾ → Workspace → Storage**.

**Set up.**

1. Pick a provider. **Local disk** needs nothing and is fine for a single
   server; it does not survive the server being replaced.
2. **Azure** — paste a connection string and name a container. Trackly creates
   the container if the credential is allowed to.
   **Google Cloud** — upload (or paste) the service-account JSON key and name a
   bucket that already exists. The service account needs object **read, write
   and delete** on it.
3. Optionally set a **folder prefix** (e.g. `trackly`) — do this whenever the
   bucket is shared with another application, so Trackly's files stay in one
   place.
4. Save, then press **Test connection**. It writes a small file, reads it back
   and deletes it, which is the only way to catch a credential that can upload
   but not download.

**Switching provider does not move existing files.** Attachments written before
the switch keep being served from where they are — but only while the old
provider's credentials are still saved. The screen warns you before a switch;
clearing the old credentials is what makes those attachments unreadable. There
is no tool that copies objects between providers.

**CDN (optional).** If a CDN sits in front of the bucket, put its origin here
(e.g. `https://cdn-beta.saarvix.in`). It maps onto the bucket root, so the bucket
name is *not* part of a CDN path. The preview on the page shows the finished URL
as you type.

Only your **logo** is ever served from the CDN. Ticket attachments and profile
photos never are — a CDN link carries no sign-in, so it would sidestep the checks
that keep one customer from reading another's ticket, and keep an internal note's
attachment away from the customer.

> ⚠️ A CDN needs the bucket to be publicly readable, and attachments live in the
> same bucket. Trackly never hands out an attachment's path, but it cannot make a
> public bucket private — someone who already knows an object's path could fetch
> it. If that matters, use a separate private bucket for Trackly and skip the
> CDN, or accept the trade knowingly.

**Good to know.**

- Credentials are AES-256-GCM encrypted and never shown again. The field says
  "Configured"; leave it blank to keep what is stored, or paste a new value to
  replace it.
- The 10 MB per-file limit is the same whichever provider you use.
- Logos are covered by [Branding](#10-branding); this section only decides where
  the file physically lives.
- Profile photos land in the same place, under `<workspace-id>/avatars/`.

---

## 21. Profile photos

**What it is.** A photo shown wherever a person appears — ticket lists, the
conversation thread, the assignee and watcher lists, the sidebar. Without one,
Trackly draws their initials on a colour derived from their name, so nobody looks
unfinished.

**Your own photo.** Click your name at the foot of the sidebar → **Change
photo**. Click the avatar in the dialog to pick a file; **Remove photo** clears
it. The change is live everywhere the moment it saves.

**Someone else's.** Open the customer (**Tickets → a customer's name**) and click
their avatar. Agents and admins can set or clear any photo in the workspace;
everyone else can only change their own.

**Rules.** PNG, JPEG or WebP, up to **1 MB**. There is no cropper — the image is
centre-cropped to a circle by the browser, so a roughly square photo looks best.

**Privacy.** Photos are stored **privately**, wherever
[Attachment storage](#20-attachment-storage) points, and served only to people
signed in to the same workspace. They are never given a CDN link and never
appear on the guest ticket view, which is opened with an emailed link rather
than a sign-in — agents show as initials there.

---

## 22. Resolution notes & time tracking

### Why a ticket was resolved

**Resolving or closing a ticket now asks what was fixed, and will not proceed
without it.** The dialog appears wherever a ticket can be ended — the Resolve
button on the ticket, the status list, and the quick-resolve icon on each row of
the ticket list.

| Field | Required | What it is |
|---|---|---|
| **What was fixed?** | Yes | Root cause, what changed, anything the next person needs |
| **Related work** | No | User story, pull request or issue. Must be a full `http(s)` URL |
| **Time spent** | No | Logged against the ticket under your name (see below) |

The note lands in two places: on the ticket, shown as a **Resolution** card in
the right-hand panel, and in the conversation as an **internal note** so the
thread reads in order. Reopening the ticket clears the card — it describes the
resolution the ticket *currently* has — while the internal note stays as history.

**Agents only.** The customer never sees the resolution note, the link, or the
time. They see that their ticket was resolved, and the resolution email as
usual. This is on the same footing as a private note.

**Resolved → Closed does not ask again.** The note is required on the way out of
Open or Pending. Filing an already-resolved ticket away keeps the note it has —
asking twice is how people learn to type "." to get past a dialog.

> There is one gap worth knowing: a ticket resolved by an **automation rule** has
> no resolution note, because nobody typed one. Automation is not blocked by this
> rule, so if you have a rule that auto-resolves, those tickets will show no
> Resolution card.

### Time spent

**Where:** the **Time spent** card on the right of any ticket.

Press **Log time**, enter hours and minutes, and optionally say what you did.
The card lists every entry with who logged it and when the work happened, and
shows the total in its header. A ticket can carry many entries — one per sitting,
from as many people as worked on it.

- **You can edit or delete your own entries.** Admins can correct anyone's, which
  is how a fat-fingered eight-hour entry gets fixed after someone has left.
- One entry is capped at **24 hours** — a typo guard, not a policy.
- Time entered in the resolve dialog appears here too, under the person who
  resolved the ticket.
- Time is entered by hand; there is no running stopwatch. A timer gets left
  going overnight or never started, and the number ends up corrected by hand
  anyway.

### Finding tickets

**Search** matches the subject *and* the description. It does not search replies —
that is a different kind of index and doing it with a plain text match would
scan every comment in the workspace.

**Sort** by clicking a column heading: Ticket, Priority, Status, SLA or Updated.
Clicking the active column flips the direction. Two things worth knowing:

- **Priority sorts by your configured order**, not alphabetically — so Urgent is
  above High because you put it there, not because of the letter it starts with.
- **Sorting by SLA puts tickets with no deadline last**, in both directions. A
  ticket with no policy is not the most urgent and it is not the least; floating
  it to the top would bury the ones that do have a clock.

**Filters** live in the rail on the left (or behind the **Filters** button on a
narrow screen). Every value shows a count, and you can tick more than one in a
group — "Open **or** Pending", "Priya **or** unassigned".

The counts are the useful part: each group is counted **ignoring its own
filter**. So after picking "Open" you can still see there are 12 Pending, and
add them. A filter list that counted itself would show every other option at
zero and there would be no way back out except clearing everything.

Everything is in the URL, so a filtered, sorted view is a link you can send
someone, and Back works.

### Activity: what happened to this ticket

**Where:** the **Activity** tab on any ticket, beside Conversation, Notes and
Attachments.

The audit trail — every change, oldest first, with who made it and when. Status
moves, priority, assignee, department, category, subject, watchers, replies,
notes, files, related work, time logged, resolutions and reopens.

Things worth knowing before you rely on it:

- **Agents and admins only.** Customers never see it, on the portal or anywhere
  else. It records *that* a private note was written — never its words, so "Only
  me" stays only yours.
- **Entries are frozen at the time they were written.** Rename a status and last
  month's entries still read as they did then, because that is what actually
  happened. The person's name is the exception: that is shown live.
- **Nothing you do creates a duplicate.** Saving the properties panel re-sends
  every field, but only what actually moved is recorded — one save that changed
  the priority is one line, not four.
- **"Trackly" as the actor** means nobody with an account did it: an automation
  rule fired, a guest or chat visitor replied, or a cold email arrived from
  somebody Trackly has no user record for.
- **History starts from the day this shipped.** Tickets raised before it show an
  empty tab; nothing was reconstructed, because inventing timestamps and actors
  from the ticket as it stands now would put entries in the log that are simply
  wrong.

**Where entries come from.** Everything that changes a ticket writes one —
agents, automation rules (§7), inbound email (§9), the messaging connectors
(§14), live chat (§15), guest submissions and replies (§4.5), problems being
linked or bulk-resolved (§5.4), and attachments. An automation rule that
re-prioritises a ticket at 3am leaves a line saying so.

**The SLA clock is the deliberate exception.** It writes nothing, because
everything it does follows something already in the feed — it pauses because the
status moved to Pending, recalculates because the priority changed, stops because
somebody replied. Entries for those would double every line without adding a
fact.

### Notes: who reads them

The composer has three modes, and they are three different promises:

| Mode | Who sees it |
|---|---|
| **Reply** | The customer, and everyone internally. This is the only one that leaves Trackly. |
| **Team note** | Every agent and admin in the workspace. Never the customer. |
| **Only me** | Just you. Not your colleagues, **not an admin**. |

"Only me" is for the reminder you leave yourself — *check the billing export
before closing this*. It is genuinely private, because a note that might be read
by somebody else is a note people stop writing.

Because of that, **"Only me" cannot mention anyone**. If you type a name in one,
it stays as ordinary words and nobody is notified — a chip that looks like it
pinged somebody, and did not, would be worse than no chip.

### Mentions

Type **@** in a reply or a team note and pick a colleague. They get:

- a **bell notification** in Trackly, and
- an **email**, so it reaches them whether or not they have Trackly open.

Mentioning somebody does **not** change the assignee and does **not** make them a
watcher. It is a nudge, not a handover — the ticket stays exactly where it was.

They can find everything they were named in under **Mentioning me** in the
sidebar, which also carries a count.

### Watchers

Any number of agents can watch a ticket. A watcher hears about **every** change
to it — status, priority, reassignment, and every reply or team note. The
assignee is treated as a watcher automatically; nobody has to remember to add
themselves to their own ticket.

**Watching** in the sidebar lists everything you watch, with a count.

Add and remove watchers from the **Watchers** card on the ticket.

### The bell

The bell in the top bar shows unread notifications with a count. Opening one
marks it read and takes you to the ticket; **Mark all read** clears the lot.

The count refreshes about once a minute, so a brand-new mention can take up to
that long to appear — the email has already gone out by then either way.

### Formatting a reply

**Where:** the reply and private-note composer on any ticket.

The composer has a toolbar: **bold, italic, underline, strikethrough, bullet and
numbered lists, quote, inline code, code block, link, clear formatting**.
Keyboard shortcuts work as you would expect — Ctrl+B, Ctrl+I, Ctrl+U, Ctrl+K for
a link.

- **Code blocks carry a language.** Pick it from the dropdown next to the code
  buttons; changing it while the cursor is inside a block re-tags that block.
  Trackly stores the language and renders the block in a monospace frame — it
  does not colour the syntax.
- **Pasting is cleaned automatically.** Copying from Word, Google Docs or Outlook
  normally brings a document's fonts, colours and hidden markup with it. Trackly
  keeps the words, the bold, the links and the list structure, and drops the
  rest. Hold **Shift** while pasting to paste with no formatting at all, and use
  **Clear formatting** on a selection that came out wrong.
- **A table pasted from a spreadsheet becomes plain lines.** Trackly does not
  render tables in a reply; the text survives, the grid does not.

Formatted replies reach the customer's **email as plain text** — bold becomes
plain words, lists become dashes. The formatting is for the agent view and the
portal.

> Replies and notes are formatted. The ticket **description** is still plain
> text, because it is written on the submit form that customers use.

### Related work

**Where:** the **Related work** card on the right of any ticket.

The stories, pull requests and documents a ticket is about. Paste a full
`https://…` URL and, if you like, a label saying what it points at. A ticket can
carry as many as it needs — the story it came from, the PR that fixed it and the
incident it was raised under are three different links, and one field could only
hold one of them.

- The link typed into the **resolve dialog** is filed here automatically, so
  there is never a link in one place that the other list does not know about.
- The same URL cannot be added twice; Trackly says so rather than listing it
  again.
- **Any agent can remove any link.** Unlike a time entry, a link is not a record
  of someone's work — a wrong reference on a ticket everyone reads is the worse
  problem.
- **Agents only**, like the resolution note. Customers never see these.

---

## 23. Ticket layout

**Where:** Admin → **Ticket layout**

The ticket view has a side panel down its right-hand side: Ticket information,
Resolution, SLA timer, Customer, Properties, Related work, Time spent, Watchers,
Actions, AI insights. This screen decides **which of them appear, and in what
order**.

- **Reorder** with the up/down arrows. If your team lives out of the customer
  record, put Customer at the top; if nobody looks at the SLA clock, push it to
  the bottom.
- **Hide** any card you do not want. Hiding changes what is *drawn* and nothing
  else — every field behind a card is optional, so switching SLA off does not
  remove an SLA, and switching it back on brings the whole card back exactly as
  it was. Nothing is deleted and no ticket changes.
- **Rename** any card. Once you rename one, Trackly stops translating it — the
  words become yours in every language.
- You cannot add or delete cards. The keys belong to Trackly because the page
  needs to know what to draw for each one; a made-up entry would be a line on
  this screen that renders nothing.

Individual agents can also **collapse** any card by clicking its heading. That is
personal and stored in their own browser — it does not change what anyone else
sees, and it does not touch this screen.

---

_Keep this guide updated when features change — it’s the admin-facing counterpart
to `docs/trackly-plan.md` (design) and `docs/go-live.md` (deployment)._
