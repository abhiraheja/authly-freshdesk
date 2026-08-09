# Email templates — design plan

Making every message Trackly sends an editable, branded HTML email instead of a
plain-text string compiled into a service class.

> **Working document.** Fold the settled parts into `docs/trackly-plan.md`
> (§ Email Architecture) as each phase lands, then delete this file — the same
> lifecycle `docs/email-providers-plan.md` has.

---

## 1. Why

Today the body of every outbound message is a C# interpolated string sitting
inside the service that happens to trigger it. Consequences:

- **No branding.** An admin uploads a logo and picks a primary colour, and their
  customers receive grey monospace-ish plain text signed "Trackly". Invariant 6
  says customer-facing surfaces render the workspace's branding; notification
  emails are named in that list and are the one surface not honouring it.
- **No edits.** Changing "Thanks — your request has been logged" needs a code
  change, a rebuild and a redeploy. On a self-hosted product the person who wants
  that change is not the person who can make it.
- **No HTML.** `EmailMessage.HtmlBody` has existed since Phase 1 and every single
  call site passes `null`.
- **Copy drifts.** Eight files write their own subject-line format. Two of them
  already disagree about whether the reference goes in brackets.

The attached screenshots (a different product) show the shape that solves this: a
list of template keys with built-in/custom state, per-row Test, and an editor with
subject, HTML body, a variables reference and a live preview.

---

## 2. What exists today

Grounding, so the plan is measured against the real code.

| Piece | File | State |
|---|---|---|
| Message record | `src/Trackly.Core/Interfaces/IEmailSender.cs` | `EmailMessage` already carries `HtmlBody` — never set |
| MIME | `src/Trackly.Infrastructure/Email/MimeMessageBuilder.cs` | already does `BodyBuilder.HtmlBody` when non-null — **no change needed** |
| Branding (data) | `src/Trackly.Core/Entities/WorkspaceBranding.cs` | logo key + content type, `PrimaryColor`, `PageTitle`, `WelcomeText`, `FooterText`, `HidePoweredBy` |
| Branding (read) | `BrandingController.GetPublic` | public, cached, **defaults for every field**; already consumed by `login.ts` via `PublicBranding` |
| Branding (edit) | `/admin/settings/branding` | **`ComingSoon`** — still `frontend/src/pages/admin/BrandingSettingsPage.tsx`. See § 3.7 |
| Logo URL | `BrandingController.GetLogo` | `GET /api/public/workspaces/{slug}/logo`, public, CDN-redirecting |
| Sanitiser | `src/Trackly.Infrastructure/Text/RichText.cs` | tiny allowlist (no tables, no styles) + `ToPlainText` |
| Ticket mail | `src/Trackly.Modules/Email/NotificationService.cs` | 6 events, 8 send sites, all plain text, workspace SMTP |
| Announcements | `src/Trackly.Modules/Announcements/AnnouncementService.cs` | admin-authored body, workspace SMTP |
| Sign-in mail | `src/Trackly.Modules/Auth/AuthService.cs` | magic link + OTP — **shared relay, see § 3.6** |
| Guest mail | `src/Trackly.Modules/Guest/GuestService.cs` | OTP + "we received your ticket" — **shared relay** |
| Invites | `src/Trackly.Modules/Invitations/InvitationService.cs` | invite link — **shared relay** |
| Test mail | `src/Trackly.Api/Controllers/EmailSettingsController.cs` | workspace SMTP; the only send invariant 8 counts |

There is no template concept anywhere in the codebase, and nothing in
`docs/trackly-plan.md` reserves one. This is greenfield.

---

## 3. Design decisions

### 3.1 A missing row *is* the built-in default

`email_templates` holds only what an admin has customised. No row for a key means
render the built-in, which lives in code.

Seeding the table on first run would look tidier and is worse: a default improved
in a later release would never reach an existing install, because the row already
exists and Trackly can't tell "seeded, untouched" from "deliberately written that
way". Absent-means-default also gives three features for free — the mockup's
`built-in` / `custom` badge is `row is null`, **Reset** is `DELETE the row`, and a
fresh database needs no seed migration.

### 3.2 One layout, many content fragments

A template body is the **content** of the email, not the whole document. It is
rendered into a shared layout that carries the logo header, the accent colour, the
footer and the `Powered by Trackly` line.

The alternative — every template a complete `<html>` document — means the brand
colour lives in thirteen places, and an admin who edits one template in 2026
inherits that year's markup forever. With a layout, branding is set in one place
and applies everywhere at once — and, per § 3.7, the layout is the *only* file
that needs changing if where "one place" lives ever moves.

The layout is itself a template (key `_layout`, `{{content}}` where the fragment
goes), so it is editable by an admin who wants a different frame — and resettable
when they regret it. A per-template **Standalone** toggle skips the layout for the
case that genuinely needs it: a designer hands over a finished HTML email.

### 3.3 A deliberately small template engine, not Scriban

`{{variable}}` substitution against a fixed dictionary, plus
`{{#if x}}…{{else}}…{{/if}}`. Roughly 100 lines in
`src/Trackly.Core/Email/TemplateRenderer.cs`.

Conditionals are not optional: the resolved-ticket email carries a CSAT link only
sometimes, a mention carries an excerpt only sometimes, and a reply says "reply to
this email" only when inbound mail is configured. Without `{{#if}}` those become
pre-rendered HTML blobs passed in as variables, which is the current problem with
extra steps.

A real template language (Scriban, Fluid, Handlebars.NET) is rejected on purpose.
Those evaluate expressions against an object graph, and the template is
admin-editable data stored in a database — that is server-side template injection
with a friendly name. It also quietly breaks invariant 5: with a locked dictionary
there is *no expression* an admin can write that reaches an internal comment,
because internal comments were never put in the dictionary. With Scriban, one
`{{ ticket.comments }}` would.

### 3.4 Escaping, and where the danger actually is

| Syntax | Behaviour | Used for |
|---|---|---|
| `{{name}}` | HTML-escaped | everything by default — ticket subjects, customer names |
| `{{{name}}}` | raw | only values the server produced as already-sanitised HTML (a comment body through `RichText`) |

Ticket subjects and customer names are attacker-supplied: anyone can open a ticket
titled `<img onerror=…>`. Mail clients mostly neuter that; **Trackly's own preview
pane does not**, and that pane runs in an admin's browser.

The template body itself is admin-authored and cannot go through `RichText` — that
allowlist forbids tables and inline styles, which is precisely what an HTML email
is made of. It needs its own wider sanitiser (`EmailHtml`): allow tables, inline
`style`, `img`, `a`; strip `<script>`, `<iframe>`, `<object>`, every `on*`
attribute and `javascript:` URLs. Only admins can reach this endpoint, so it is
defence-in-depth rather than the primary control — but it is what makes the
preview safe to render.

**The preview renders in a sandboxed `<iframe srcdoc>`**, not `[innerHTML]`.
Angular's sanitiser would strip the inline styles and show the admin a preview
that does not match what customers receive, which is worse than no preview.
`sandbox` (no `allow-scripts`, no `allow-same-origin`) contains anything that
survived the sanitiser.

### 3.5 The text part is derived, not authored

Every HTML email needs a `text/plain` alternative for deliverability. Giving each
template a second editable body doubles the editing surface for something nobody
maintains, and a stale text part is worse than a generated one. So: render the
HTML, then `ToPlainText` it.

`RichText.ToPlainText` was written for the small comment allowlist and will need
work to handle table layouts (collapse cells, keep link URLs, drop the logo).
Budget for that — it is the one piece of § 4 with real unknowns.

### 3.6 Sign-in, guest and invite mail is routed wrong today

Found while surveying: `AuthService`, `GuestService` and `InvitationService` inject
`IEmailSender` — the **deployment-level shared relay** from `appsettings`, or
`LoggingEmailSender` in dev. They never touch the SMTP provider the admin
configured in the UI.

So on a self-hosted install where the admin connects Google or fills in ZeptoMail
and sees the test go green, magic links and invitations still go through
`Smtp:*` — which on that install is usually unset, meaning they are logged to the
console and never sent. The test email's own copy claims otherwise: *"sign-in codes,
invitations and ticket notifications can reach people."*

This is invariant 8 territory — the way in is the mail that isn't being sent — and
it must be fixed as part of this work, because a beautifully branded sign-in
template delivered through an unconfigured relay is a regression, not a feature.
Phase 4.

### 3.7 Branding is read through one seam, because branding isn't finished

Email must look like the workspace — that isn't in question, it's invariant 6.
But `WorkspaceBranding` is only half-built: the entity, the admin API and the
public read endpoint all exist and work, while the Angular editor at
`/admin/settings/branding` is still `ComingSoon`. How branding is ultimately
modelled may therefore still move.

The half that is settled is the half email needs. Templates only ever **read**
branding, and the read contract — `GetPublic`'s shape — already shipped and is
already consumed by the Angular login page. What is unfinished is *editing*.

Even so, nothing in the email path touches `WorkspaceBranding` directly. One
resolver owns the mapping:

```csharp
// src/Trackly.Modules/Email/EmailBrandResolver.cs
public record EmailBrand(
    string BrandName,      // PageTitle ?? Workspace.Name
    string? LogoUrl,       // absolute; null when none uploaded
    string PrimaryColor,   // "#2563EB" when unset
    string? FooterText,
    bool HidePoweredBy);
```

`_layout` sees only `EmailBrand`. If branding is later restructured — per-surface
branding, a theme object, a different table — the change is this one file, and no
template, no stored row and no admin's customised markup is touched. Roughly
forty lines to make the dependency reversible, which is the right trade against a
component still in motion.

Two consequences that matter:

- **No new columns on `WorkspaceBranding`.** Tempting ones exist (a postal
  address for the anti-spam footer, an email-specific accent). Adding columns to
  a table whose ownership is in flux is exactly the rework being avoided;
  `FooterText` is free text and covers it. Revisit once the editor is ported.
- **Every field needs a real fallback, not a blank.** Right now nobody *can* set
  branding from Angular, so the common case on any current install is an empty
  branding row. `GetPublic` already defines the fallbacks (workspace name,
  `#2563EB`, no logo) — the resolver uses the same ones, so an unbranded install
  sends a clean, plainly-Trackly-blue email rather than a broken one with a
  missing image.

This does **not** make porting the branding screen a prerequisite: Phase 1 is
correct with an empty branding row. It does mean the branding port gets more
valuable once this lands, since the email preview in Phase 3 becomes the fastest
way to see branding changes take effect.

---

## 4. Schema

```sql
CREATE TABLE email_templates (
    id            uuid PRIMARY KEY,
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    key           text NOT NULL,           -- 'magic_link', '_layout', …
    locale        text NOT NULL DEFAULT 'en',
    subject       text,                    -- NULL for '_layout'
    body_html     text NOT NULL,
    standalone    boolean NOT NULL DEFAULT false,
    is_active     boolean NOT NULL DEFAULT true,
    updated_at    timestamptz NOT NULL,
    updated_by    uuid NULL REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE (workspace_id, key, locale)
);
```

**`locale` ships now, unused.** Trackly has `en.json` and `hi.json` on the
frontend and no locale on `users`, so there is no per-recipient locale to select
on yet and the UI will only ever show `en`. It is in the unique key from day one
because adding it later means rebuilding that index on a table with live rows,
and the column costs nothing. Flagging it as a judgement call: it is the one piece
of speculative generality in this plan.

**`is_active = false` falls back to the built-in**, it does not suppress the mail.
A toggle that silently stops sending sign-in codes is an invariant 8 lockout with
a nice UI. (Whether a given *event* sends at all stays where it already is:
`NotificationSettings`.)

---

## 5. Template catalogue

`src/Trackly.Core/Email/EmailTemplateCatalog.cs` — descriptors carrying the key,
display name, built-in subject + body, and the variable contract.

| Key | Trigger | Replaces |
|---|---|---|
| `_layout` | wrapper for all of the below | — |
| `magic_link` | sign-in link + 6-digit code | `AuthService` |
| `guest_otp` | guest email verification | `GuestService` |
| `invitation` | agent/admin invite | `InvitationService` |
| `ticket_received` | guest submit confirmation | `GuestService` |
| `ticket_created_customer` | portal requester, on create | `NotificationService` |
| `ticket_assigned` | agent, on assign/reassign | `NotificationService` ×2 — one body today, one key |
| `ticket_reply_customer` | agent replied | `NotificationService` |
| `ticket_reply_agent` | customer replied | `NotificationService` |
| `ticket_mention` | `@`-mention | `NotificationService` |
| `ticket_status_changed` | status change | `NotificationService` |
| `ticket_resolved` | resolution, optional CSAT link | `NotificationService` |
| `announcement` | announcement wrapper (body stays admin-authored) | `AnnouncementService` |
| `email_test` | the invariant-8 test send | `EmailSettingsController` |

### Variables

Always available (from workspace + branding):
`{{workspace_name}}` `{{logo_url}}` `{{primary_color}}` `{{footer_text}}`
`{{portal_url}}` `{{support_email}}` `{{year}}`

Per-key, e.g.: `{{ticket_ref}}` `{{ticket_subject}}` `{{ticket_url}}`
`{{customer_name}}` `{{agent_name}}` `{{{body}}}` `{{otp}}` `{{action_url}}`
`{{expiry_minutes}}` `{{csat_url}}`.

`{{logo_url}}` is an **absolute** URL to the public logo endpoint, not a `cid:`
attachment — attaching means a paperclip icon on every notification, and blocked
images degrade to alt text either way. It is built from **`App:ApiBaseUrl`**
(which already existed for SAML and SSO — the plan originally proposed inventing
`App:PublicBaseUrl`, which would have been a second name for the same thing).
When it is unset, `logo_url` resolves to null and the layout falls back to the
workspace name in text, because a broken image icon in every email is worse than
no logo. Go-live entry.

### Required-variable validation

Each descriptor declares required variables (`magic_link` → `action_url`;
`guest_otp` → `otp`). **Saving a body that omits one is a 400.** Self-hosted means
no support desk: an admin who deletes `{{action_url}}` while tidying has locked
everyone out of a product with no recovery link. Same reasoning as invariant 8,
same enforcement point — the API, not the editor.

---

## 6. API

Routed under `api/admin/email/templates` — beside `api/admin/email/providers`,
rather than the top-level `api/admin/email-templates` first sketched here, so the
two halves of email administration sit together.

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/admin/email/templates` | list: key, name, locale, `source: built-in\|custom`, `isActive` |
| `GET` | `/api/admin/email/templates/{key}` | subject, body, `standalone`, variable contract, built-in subject+body for diff/reset |
| `PUT` | `/api/admin/email/templates/{key}` | upsert; validates required variables + sanitises |
| `DELETE` | `/api/admin/email/templates/{key}` | reset to built-in (deletes the row) |
| `POST` | `/api/admin/email/templates/{key}/preview` | render **the posted draft** (unsaved) with sample data → `{subject, html, text}` |
| `POST` | `/api/admin/email/templates/{key}/test` | render with sample data and actually send, via the workspace sender |

Preview renders **server-side** through the production renderer. A JavaScript
reimplementation in the SPA would be a second engine that drifts from the first,
and the preview would start lying exactly when it matters.

Test send reuses the production render path for the same reason. Note it proves
delivery like the § 2 test does, but it does **not** set
`email_configs.last_verified_at` — invariant 8's proof stays on one deliberate
endpoint.

---

## 7. Frontend

`frontend-angular/projects/admin/src/lib/` — new `email-templates.ts` (list) and
`email-template-form.ts` (editor), routed under `/admin/settings/email/templates`
with an entry point from the existing email settings screen.

- **List**: key + description, source badge, active toggle, per-row test-recipient
  input + **Test**, **Edit**, **Reset** (confirm — it discards their work).
- **Editor**: subject field, HTML `<textarea>` (monospace, no WYSIWYG — matching
  the screenshot and honest about what is being edited), **Standalone** toggle,
  **Active** toggle, Save / Cancel.
- **Variables panel**: the key's contract, click-to-insert at cursor.
- **Preview**: debounced POST → sandboxed `<iframe srcdoc>`, with a subject line
  above it and a plain-text tab.
- Four states each — loading, empty, error with retry, data.
- No interpolated Tailwind classes; source badges use a static lookup.
- i18n keys in both `en.json` and `hi.json`, parity checked.

---

## 8. Phases

Each is independently shippable and independently reviewable.

| # | Scope | Ships |
|---|---|---|
| 1 ✅ | `TemplateRenderer`, `EmailTemplateCatalog`, `EmailHtml` sanitiser, `EmailText`, schema + migration, `EmailBrandResolver`, `EmailTemplateService` | **done** — ticket, announcement and test mail are branded HTML on built-in defaults |
| 2 ✅ | The six endpoints in § 6, `EmailTemplateSamples`, `RenderDraftAsync` | **done** — API-complete, no UI |
| 3 ✅ | The two Angular screens, `admin-guide.md` § 9.1 | **done** — the feature |
| 4 ✅ | Route auth/guest/invite through `IWorkspaceEmailSender` + templates (§ 3.6) | **done** — sign-in mail actually uses the configured relay |
| 5 | `trackly-plan.md` § Email Architecture, `go-live.md` (`App:PublicBaseUrl`) | docs |

Phase 1 is the one with real risk (`ToPlainText`, and getting a table layout to
survive Outlook). Phases 2–3 are mechanical once it lands.

**Not a prerequisite, but adjacent:** porting `BrandingSettingsPage.tsx` to
Angular. Every phase here is correct against an empty branding row (§ 3.7), so
this work is not blocked. But until that screen is ported, an admin on Angular
cannot change what their emails look like — only what they say — and the branded
layout is demoable only against defaults. Worth scheduling near Phase 3; it is a
single settings screen against an API that is already complete.

---

## 9. What Phase 1 changed against the plan

Recorded here rather than silently, so § 3 stays trustworthy.

- **`App:ApiBaseUrl`, not a new `App:PublicBaseUrl`** — see § 5.
- **A new `EmailText` class rather than extending `RichText.ToPlainText`.** That
  method documents itself as handling only what the comment allowlist permits,
  and it is regex-based: pointed at a table layout it produced one run-on line,
  leaked `<style>` contents as visible text, and — the fatal one — dropped every
  `<a href>` URL, because it strips tags and keeps only the link text. The
  plain-text half of a magic-link email would have contained the word "Sign in"
  and no link. `EmailText` parses with AngleSharp and writes links as
  `Sign in <https://…>`.
- **`RichText.ToHtmlParagraphs` added** — the inverse direction. Plain-text
  comments and announcement bodies now go *into* HTML emails, and dropped in raw
  they would arrive as one paragraph with any typed `<` read as a tag.
- **Buttons are guarded with `{{#if ticket_url}}`.** A guest's ticket is
  reachable only through the private tokened link in their original confirmation
  email, and notifications do not reissue one — so `ticket_url` is genuinely null
  for guests, and an unguarded button would render with an empty `href`. The
  `ticket_reply_customer` template uses two independent conditions rather than
  an if/else for the same reason: repliable and linkable are not opposites.
- **Placeholders are lifted out of the HTML before sanitising and put back
  after.** `href="{{action_url}}"` is not a valid URL and the sanitiser
  validates URI-bearing attributes — a stripped href on the magic-link template
  is a sign-in email with no link in it, failing silently at save time.
- **The email test sends through the template pipeline.** It was a bare-text
  probe; it now renders `email_test` through the real layout, so the message that
  proves email works also shows what the workspace's email looks like.
- **Verified with a throwaway console harness** (no test project exists in this
  solution) covering escaping, conditionals, nesting, every built-in parsing and
  meeting its own `Required` contract, placeholder survival through the
  sanitiser, and link/code survival into plain text. Phase 2 added a second pass
  that runs the real service against the dev database: every key renders with no
  unresolved `{{`, no empty `href`, and a text alternative; a stored row wins; an
  inactive row falls back rather than suppressing; an unparseable stored body
  degrades to the built-in.

### Phase 2

- **Route is `api/admin/email/templates`** — see § 6.
- **`RenderDraftAsync` is the production renderer with one substitution**, not a
  preview renderer. Preview and test both go through it, so what the editor shows
  cannot drift from what sends.
- **The layout previews by framing sample content.** Rendering `_layout` as if it
  were a fragment and then wrapping it would nest the frame inside itself; it now
  puts the `email_test` body through the layout being edited, which is the only
  way to see what a layout edit does.
- **The body is validated twice — before and after sanitising.** Sanitising can
  take a placeholder out along with the tag it sat in, so checking only the
  submitted body would let a required variable vanish between the check and the
  write.
- **The per-template test deliberately does not set
  `email_configs.last_verified_at`.** That proof stays on the one endpoint whose
  purpose is to establish it (invariant 8); mailing yourself a draft is a weaker
  claim.
- **`admin-guide.md` is not updated yet** — there is no user-visible surface until
  Phase 3. It lands with the screens.

### Phase 3

Two screens, plus two server fixes the screens exposed.

- **An omitted draft now means "what is stored", not "the built-in".** Preview and
  test accepted a draft that *substituted* for the stored row, so the list — which
  has no body to post — was posting nothing and silently getting the built-in. An
  admin testing their own customisation would have been shown someone else's copy
  and told it passed. `Render` in the controller now routes a bodyless request
  through `RenderAsync`.
- **Preview reports an unparseable draft instead of degrading.**
  `EmailTemplateService` catches a render failure and falls back to the built-in,
  which is right for a sign-in email at 3am and wrong in an editor: an admin who
  had just broken a `{{#if}}` got a perfectly good preview of copy they did not
  write. `Preview` now runs `TemplateRenderer.Validate` first. **Parse errors
  only** — whether a required variable is still present is a save-time contract,
  and refusing to preview until it is satisfied would withhold the preview exactly
  while it was being fixed.
- **The active toggle moved from the list to the editor.** § 7 put it on each row.
  Toggling it there would have meant a `GET` to fetch the body before the `PUT`
  that saves it, because the endpoint validates the whole template — and the
  label was misleading anyway. `is_active` does not stop an email being sent
  (§ 3.1, invariant 8); it chooses between your version and the built-in. It is
  now **"Use this version"**, in the editor, where the subject and body it applies
  to are already in hand. The list shows a `Switched off` badge instead.
- **One test-recipient field, not one per row.** The screenshot has an input on
  every row; with fourteen templates that is fourteen boxes for a value that is
  the same address every time. One field at the top, a `Test` button per row.
- **The layout gets its own card above the messages.** It is not one of them —
  editing it changes all thirteen at once — and filing it in the same list invites
  someone to reword it the way they'd reword a message.
- **Names and descriptions are English from the server's catalogue**, not
  translation keys, exactly as provider `displayName` already is. Everything the
  *screens* say is translated in both `en.json` and `hi.json`.
- **`{{…}}` never appears literally in a translation value** — Transloco
  interpolates with the same delimiters, so a literal placeholder in a hint string
  would be substituted away to nothing. Variable names reach the UI as parameters
  or as data, never baked into copy.
- **The preview iframe is `sandbox=""` with `bypassSecurityTrustHtml`.** Angular's
  sanitiser would strip the inline styles an HTML email is made of and show a
  preview that does not match what is sent, which is worse than none. The body was
  already sanitised server-side on save; no scripts and no same-origin is what
  contains anything that survived.
- **Hydration must not read the signals it writes.** The effect that fills the
  form from the resource would otherwise take a dependency on every keystroke and
  put the stored text back as fast as it could be typed over.
- **`logo_url` is withheld unless a logo actually exists.** `EmailBrandResolver`
  built the URL from `App:ApiBaseUrl` alone, without checking
  `WorkspaceBranding.LogoStorageKey`. The public logo endpoint 404s for a
  workspace with no logo, so `{{#if logo_url}}` took the image branch and every
  email led with a broken image instead of the text fallback the layout was
  written to provide — on a fresh install, which has no branding row at all, that
  is every email Trackly sends. `GetPublic` already made the same check before
  handing a `logoUrl` to the sign-in page; the two now agree.

### Phase 4

- **One collaborator, not three copies.** `TransactionalMailer` (`Modules/Email`)
  renders a key, resolves the workspace's sender and From identity, and sends.
  Inlining that three times would have re-created the § 1 complaint — eight files
  each writing their own version of the same email — in the change that was
  supposed to end it. It is deliberately *not* `NotificationService`: that one is
  about a ticket, reads notification toggles, computes a threading `Reply-To` and
  stamps a `Message-ID`, and none of that belongs on an invitation. A sign-in
  email must not invite a reply.
- **`IEmailSender` is now injected only inside Infrastructure**, as the
  shared-relay fallback behind `WorkspaceEmailSender`. No module can bypass the
  workspace sender any more, which is what makes § 3.6 stay fixed.
- **Sends throw here, unlike ticket notifications.** The difference is what the
  caller has already promised: a ticket write happened either way, but "check
  your email" is a promise *about the email*, and reporting success for a code no
  relay accepted leaves someone waiting on a message that is not coming.
- **The one exception is the guest confirmation**, which is caught and logged.
  The ticket is already committed and the response carries the tracking token, so
  a relay refusing the confirmation must not turn a submitted ticket into an
  error page — the customer would submit again and raise it twice. This is a new
  failure mode created *by* this phase: before it, that send went to the dev
  logger and could not fail; now it can hit an expired OAuth token.
- **Four catalogue entries were dead until now.** `magic_link`, `guest_otp`,
  `invitation` and `ticket_received` shipped in Phase 1 and nothing rendered
  them — Phase 4 is what connects them.
- **Expiry values come from the constants, not the copy.** `expiry_minutes` and
  `expiry_days` are computed from `TokenLifetime` / `OtpLifetime` /
  `InviteLifetime`, so changing a lifetime can no longer leave an email confidently
  stating the old one.
- **`WorkspaceEmailSender`'s catch comment said "log and swallow" above a
  `throw`.** Corrected — whether a send throws is exactly the fact this phase's
  correctness rests on.
- **The dev logger now reports whether an HTML part exists.** It predates HTML
  mail and printed only the text body, so "why does my email look plain" had no
  signal at all in the log. Counted, not dumped: a branded email is ~2–4 kB of
  table markup that would bury every other line.

---

## 10. Open question — admin-defined variables

**Raised 2026-08-09, to discuss when the phases land.** Not scheduled.

Today the variable list is fixed in code: a developer declares a name in
`EmailTemplateCatalog`, supplies it at the send site, and it appears as a chip in
the editor. An admin can *use* the offered names and nothing else — an
unrecognised one renders empty.

That boundary is load-bearing, not incidental. The fixed dictionary is what makes
invariant 5 structural (§ 3.3): no expression an admin writes can reach an
internal comment, because internal comments are not in the dictionary. Any
"define your own variable" feature has to be backed by *something* — a field
path, a query, an expression — and the moment it is an expression over an object
graph it is the server-side template injection this design rejected.

**The version that keeps the invariant** is workspace-level custom values: an
admin defines key/value pairs in settings, and `EmailBrandResolver` folds them
into the dictionary under a reserved prefix (`custom_*`, so they can never shadow
a built-in name). Still a fixed dictionary at render time, still no expressions —
the list is just data instead of code.

Open sub-questions if it is taken up: does a **ticket** custom field feed in too
(the tempting one, and the one that touches invariant 5, because ticket data is
customer-visible in some templates and not others); who may define them; and
whether the editor distinguishes them from built-ins. Scope is a settings screen,
a table and a migration — a real feature, not a tweak.

---

## 11. Explicitly out of scope

- **WhatsApp / SMS channels.** The screenshots show them; Trackly has no such
  connector. No `channel` column until omnichannel (plan Phase 7) needs one.
- **Provider template sync** (the screenshot's "Sync from MSG91"). N/A.
- **A visual/drag-drop email builder.** Raw HTML + live preview first.
- **Per-recipient locale selection.** See § 4.
- **Attachments or uploaded images in templates.** The branding logo only.
