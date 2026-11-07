ALTER TABLE app_user ADD COLUMN email_verified_at timestamptz;
CREATE TABLE account_token (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
 purpose text NOT NULL CHECK(purpose IN ('VERIFY_EMAIL','RESET_PASSWORD')),
 token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, used_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_token_user ON account_token(user_id,purpose);
CREATE TABLE account_mfa (
 user_id uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
 secret_ciphertext text, pending_ciphertext text, pending_expires_at timestamptz,
 enabled_at timestamptz, last_step bigint NOT NULL DEFAULT -1
);
CREATE TABLE mfa_recovery_code (
 user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
 code_hash text NOT NULL, used_at timestamptz, PRIMARY KEY(user_id,code_hash)
);
CREATE TABLE mfa_challenge (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE notification_message (
 id uuid PRIMARY KEY, dedupe_key text UNIQUE NOT NULL, store_id uuid REFERENCES store(id),
 user_id uuid REFERENCES app_user(id), recipient text NOT NULL, kind text NOT NULL,
 subject text NOT NULL, body_ciphertext text NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSING','RETRY','SENT','FAILED','CAPTURED')),
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
 claimed_at timestamptz, claim_token uuid, sent_at timestamptz, last_error text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_pending ON notification_message(available_at) WHERE status IN ('PENDING','RETRY','PROCESSING');
CREATE TABLE notification_event (
 event_id uuid PRIMARY KEY REFERENCES event_delivery(event_id) ON DELETE CASCADE,
 processed_at timestamptz NOT NULL DEFAULT now()
);
