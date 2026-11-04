-- The default asynchronous outbox consumer is a durable local event journal.
-- An external consumer can resume from a journal event ID and deduplicate by event_id.
CREATE TABLE event_delivery (
 event_id uuid PRIMARY KEY REFERENCES outbox(id),
 event_type text NOT NULL,
 aggregate_id uuid NOT NULL,
 payload jsonb NOT NULL,
 delivered_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX event_delivery_cursor ON event_delivery(delivered_at,event_id);
