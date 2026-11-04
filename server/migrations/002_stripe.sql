CREATE TABLE stripe_payment_attempt (
 order_id uuid PRIMARY KEY REFERENCES customer_order(id),
 attempt_id uuid UNIQUE NOT NULL,
 idempotency_key text UNIQUE NOT NULL,
 request_body jsonb NOT NULL,
 stripe_session_id text UNIQUE,
 stripe_payment_intent_id text UNIQUE,
 provider_status text NOT NULL DEFAULT 'CREATING',
 created_at timestamptz NOT NULL DEFAULT now(),
 checked_at timestamptz,
 CHECK (stripe_payment_intent_id IS NULL OR stripe_session_id IS NOT NULL)
);
