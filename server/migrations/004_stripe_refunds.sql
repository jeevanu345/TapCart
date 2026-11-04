CREATE TABLE stripe_refund_attempt (
 id uuid PRIMARY KEY,
 order_id uuid NOT NULL REFERENCES customer_order(id),
 amount_cents integer NOT NULL CHECK(amount_cents>0),
 base_refunded_cents integer NOT NULL CHECK(base_refunded_cents>=0),
 payment_intent_id text NOT NULL,
 idempotency_key text UNIQUE NOT NULL,
 provider_refund_id text UNIQUE,
 status text NOT NULL DEFAULT 'CREATING' CHECK(status IN ('CREATING','PENDING','SUCCEEDED','FAILED')),
 created_at timestamptz NOT NULL DEFAULT now(),
 checked_at timestamptz,
 UNIQUE(order_id,base_refunded_cents)
);
ALTER TABLE customer_order ADD CONSTRAINT refund_total_bound CHECK(refund_due_cents+refunded_cents<=total_cents);
