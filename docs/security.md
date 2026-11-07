# Account recovery, MFA and email delivery

Run `npm run db:migrate` before starting the API. Migration 006 adds account verification, recovery, MFA, delivery leases and notification state. Existing accounts remain usable; email verification is requested separately, and MFA is opt-in for ADMIN, STORE and CUSTOMER accounts.

## Configuration

Production requires `SECURITY_ENCRYPTION_KEY`: generate 32 random bytes with `openssl rand -hex 32` and keep the resulting 64 hex characters in the server secret manager. This key encrypts authenticator secrets and all queued email bodies with AES-256-GCM. Losing it makes pending mail and enrolled MFA secrets unreadable. Keep it consistent across worker processes and restarts. Key rotation requires decrypting and re-encrypting existing ciphertext before removing the previous key; automatic rotation is not implemented.

Development without a key uses a documented local-only fallback so captured mail survives restarts. Never copy a development database into production. Production startup refuses a missing or malformed key and refuses capture mode.

Set `EMAIL_MODE` to one of:

- `smtp`: real delivery using Nodemailer. Set `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_FROM`, and, where required, `SMTP_USER` and `SMTP_PASSWORD`. Port 465 uses implicit TLS; production requires TLS for other ports. TLS certificate verification stays enabled.
- `capture`: development only, default outside production. Messages are durably marked `CAPTURED`, never `SENT`. Signed-in users can inspect their own queued message bodies at `GET /api/auth/security/captured-email`; this route does not exist in production. A logged-out account's reset email can be inspected directly in the local database by a development operator who has the encryption key.
- `disabled`: production default. Messages remain in the durable retry workflow and eventually fail; nothing is represented as sent. Configure SMTP before relying on recovery or invitations.

`APP_ORIGIN` is the configured server origin used in all email links; user-controlled Host headers never determine recovery links. Use HTTPS in production. SMTP credentials, authenticator secrets and raw tokens must stay out of logs.

## Account flows

Registration and invited teammate registration queue an email verification link. The security page can resend one. Verification links expire in 24 hours; reset links expire in 30 minutes. At most one new token per purpose is issued per account per minute. New tokens invalidate previous tokens for that purpose. Token tables store SHA-256 hashes; the email body stores the raw link only as authenticated ciphertext. Consumption checks expiry and atomically claims the token. Verification confirms ownership of the registered email.

Forgot-password responses have the same status and message for known and unknown accounts, with password-hashing work in both paths; routes and per-account issuance are limited. Resetting a password expires all sessions and pending MFA login challenges. MFA remains enabled after password reset, so mailbox access alone cannot bypass the second factor. There is no unauthenticated MFA removal endpoint.

Enrollment requires the current password, a setup secret valid for ten minutes, and a correct authenticator code before activation. The implementation uses otplib 13's RFC 6238 authenticator, a 30-second step, six digits and a one-step clock tolerance. Successful codes record their time step under a row lock and cannot be replayed. Activation expires existing sessions and displays ten random recovery codes once. Each recovery code has 80 bits of entropy, is stored as a hash and can be redeemed once. Save them before leaving the page, then sign in with a recovery code or the next authenticator code. Disabling MFA requires both the current password and an unused authenticator/recovery code, then expires all sessions.

Password login for every role returns an opaque MFA challenge instead of establishing a session when MFA is enabled. Only its SHA-256 hash is stored. Challenges expire after five minutes, allow at most five attempts, and are single-use. Starting another password login invalidates older pending challenges. Completing MFA creates the session in the same locked transaction, preventing concurrent password reset or MFA changes from granting a stale session. Registration accepts only new unique emails and never overwrites an existing account or its MFA enrollment.

If all recovery codes and the authenticator are lost, there is intentionally no email-only MFA bypass. Account recovery requires an operator's independently verified recovery process; no operator reset API is shipped.

## Durable delivery

An email queue insertion occurs in the same transaction as issuing a recovery token or creating an addressed team invitation. The outbox consumer reads the durable `event_delivery` journal and materializes receipts (`InventorySold`), refund confirmations (`RefundConfirmed`) low-stock owner alerts and newly detected/reopened operational anomaly owner alerts (`OperationalAnomalyDetected`). Customer/owner transactional email requires verified email. Stable event and notification keys prevent re-materializing the same message. Low-stock alerts use the store's configured threshold and current available inventory. Existing historical journal events are considered on the first worker run; there is no rollout cursor that silently drops them.

Workers claim only the next message to send, so waiting messages do not age under a locally held batch lease. Shutdown stops new claims and waits for the current delivery acknowledgement before closing the database. Workers claim messages with `FOR UPDATE SKIP LOCKED`, lease ownership and guarded acknowledgements. Provider failure leads to `RETRY`, exponential delay starting at 60 seconds, and a maximum of six attempts. A five-minute expired lease can be reclaimed; a final expired lease becomes `FAILED`. Provider errors are stored as a safe category without copying possibly sensitive provider responses. `SENT` means SMTP accepted the recipient, not proof of inbox delivery. Provider rejection never produces `SENT`. Local capture never produces a sent timestamp.

Sending and acknowledging are necessarily at least once: a worker can crash after SMTP acceptance and before database acknowledgement. A stable Message-ID helps provider-side deduplication but cannot guarantee it. SMTP bounce/webhook processing and delivery/read tracking are not implemented. Admins can inspect delivery status globally; store owners and managers see only their own store's messages, without email bodies or recipient addresses. Staff and customers cannot access that view.

## API and checks

All mutations use the existing origin and CSRF protection, including anonymous forgot/reset/MFA completion. Key routes are `/api/auth/password/forgot`, `/api/auth/password/reset`, `/api/auth/email/verification`, `/api/auth/email/verify`, `/api/auth/security`, `/api/auth/mfa/enroll`, `/api/auth/mfa/confirm`, `/api/auth/mfa/login`, `/api/auth/mfa/disable`, and `/api/notifications/delivery`.

Run `npm test -- server/tests/security.test.ts`. Tests require `TEST_DATABASE_URL` whose database name includes `test`. They create a randomly named schema, migrate into it, and drop only their own schema. Coverage includes token races, replay/expiry, password reset session revocation, all-role MFA login, setup proof, code reuse, challenge attempt caps, CSRF, enumeration-resistant response shapes, queue claim concurrency, provider failures, local capture, outbox deduplication and verified transactional mail. A disposable SMTP server binds only to 127.0.0.1 and verifies actual Nodemailer envelope/body delivery, transient SMTP 451 retries and final SMTP 550 failure; no external email is sent.

References: [OWASP password recovery guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), [otplib documentation](https://otplib.yeojz.dev/guide/getting-started), [Nodemailer SMTP transport](https://nodemailer.com/smtp).
