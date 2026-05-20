# Plan: Gmail SMTP Email Provider

> Branch: `feat/gmail-smtp-provider`
> Approved: Pat, 2026-05-20

## Why

ConstructPM's email pipeline currently supports SendGrid (HTTP API) and AWS SES (SendRawEmail). Both require an owned domain to pass DMARC alignment when the recipient is on Gmail or Yahoo — those providers reject third-party-sent mail with a `From: *@gmail.com` since Feb 2024.

Pat does not yet own a domain but wants the email pipeline live end-to-end so the Quick-Project quote flow can be verified with real delivery. Gmail SMTP via app password sidesteps DMARC because Google IS the sender — the `From:` header is Pat's own Gmail (`pegan604@gmail.com`), which is DKIM-signed by Google and fully aligned.

Once Pat acquires a branded domain, this stays as a fallback and the production `.env` flips `EMAIL_PROVIDER` back to `sendgrid` (or `resend`) — no code change required.

## Scope

In:
- Add `nodemailer` dependency to `project/package.json`.
- Add a `gmail` branch to the three `NotificationService` methods that switch on `EMAIL_PROVIDER`: `_deliverEmail`, `sendEmail`, `sendEmailWithAttachment`.
- Extract a single private helper `_getGmailTransport()` that lazy-loads `nodemailer` and returns a configured transport, so the three branches don't duplicate setup.
- New env keys: `GMAIL_USER`, `GMAIL_APP_PASSWORD`. Existing `EMAIL_FROM` honored if set; otherwise falls back to `GMAIL_USER`.
- Update `project/.env.example` with documented new keys.

Out:
- No changes to the SendGrid or SES branches.
- No retry/backoff, no queueing — SMTP send is fire-and-forward, same model as the existing branches.
- No UI changes. Quick-Project response already exposes `quote_email: { delivered, provider, reason }` — `provider` will read `"gmail"` once active.
- No swap to a different SMTP library. `nodemailer` is the de-facto standard for Node SMTP.

## Files

| File | Change |
|---|---|
| `project/package.json` | add `"nodemailer": "^6.x"` to `dependencies` |
| `project/src/services/NotificationService.js` | add `_getGmailTransport()` + gmail-send helpers; add `provider === 'gmail'` branch in 3 methods |
| `project/.env.example` | document `EMAIL_PROVIDER=gmail`, `GMAIL_USER`, `GMAIL_APP_PASSWORD` |
| `project/.env` (gitignored) | Pat fills `EMAIL_PROVIDER=gmail`, `GMAIL_USER=pegan604@gmail.com`, `GMAIL_APP_PASSWORD=<16-char>`, `EMAIL_FROM=pegan604@gmail.com` |

## Risks

- **App password leaks**: `.env` is already gitignored. If exposed, revoke at https://myaccount.google.com/apppasswords and regenerate. App passwords are scoped — losing one does not expose the main Gmail account password.
- **Gmail send limit**: 500 recipients/day for free Gmail (2000/day for Workspace). ConstructPM email volume well under this; not a near-term issue.
- **2FA dependency**: app passwords require 2-Step Verification stays enabled on the Google account. If Pat disables 2FA, the password silently invalidates and sends start returning auth errors.
- **Sender identity**: emails will arrive from `pegan604@gmail.com`, not a branded `quotes@…`. Accepted by Pat as a temporary state until the domain is acquired.
- **Nodemailer install size**: ~600 KB, no native deps. Negligible.

## Verification

After scaffolding the code, before merging:

1. Pat drops the four env values into `Project_Management_Software_gmail-smtp/project/.env`.
2. From `Project_Management_Software_gmail-smtp/project/`: `docker compose up -d --build api`.
3. `docker logs constructpm_api --tail 25` — expect `[SERVER] Running on http://localhost:3000` with no nodemailer init errors.
4. Dev login at `http://localhost:3000` (`admin@company.com` / `ChangeMe123!`).
5. Trigger `/bids/:id/quick-project` on a bid that has a PM with an email assigned. Inspect the JSON response:
   - Expect `quote_email.delivered === true`, `quote_email.provider === "gmail"`.
6. Confirm the email lands in the recipient's Gmail inbox with the `.docx` quote attached and openable in Word.
7. Negative path: temporarily rotate `GMAIL_APP_PASSWORD` in `.env` to a wrong value, restart api, re-trigger Quick-Project — expect `delivered:false, provider:'gmail', reason:'<auth error string>'`. Restore the real password and restart.

## Merge

After Pat confirms steps 6 and 7 work, push branch, open PR, merge to main. Then update memory file `email_provider_status.md` to reflect: pipeline is now live via Gmail SMTP, awaiting domain swap.
