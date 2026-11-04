-- SaaS workspace: subscription plan (limits, not billing), settings, team seats and invitations.
ALTER TABLE store
  ADD COLUMN plan text NOT NULL DEFAULT 'STARTER' CHECK (plan IN ('STARTER','GROWTH','SCALE')),
  ADD COLUMN plan_requested text CHECK (plan_requested IN ('STARTER','GROWTH','SCALE')),
  ADD COLUMN phone text NOT NULL DEFAULT '',
  ADD COLUMN support_email text NOT NULL DEFAULT '',
  ADD COLUMN low_stock_threshold integer NOT NULL DEFAULT 5 CHECK (low_stock_threshold BETWEEN 0 AND 1000);
CREATE TABLE store_member (
 user_id uuid PRIMARY KEY REFERENCES app_user(id), store_id uuid NOT NULL REFERENCES store(id),
 role text NOT NULL CHECK (role IN ('MANAGER','STAFF')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX store_member_store ON store_member(store_id);
CREATE TABLE store_invite (
 id uuid PRIMARY KEY, store_id uuid NOT NULL REFERENCES store(id), token_hash text UNIQUE NOT NULL,
 role text NOT NULL CHECK (role IN ('MANAGER','STAFF')), email text NOT NULL DEFAULT '', created_by uuid NOT NULL REFERENCES app_user(id),
 expires_at timestamptz NOT NULL, accepted_at timestamptz, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX store_invite_store ON store_invite(store_id) WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX outbox_aggregate ON outbox(aggregate_id, created_at DESC);
