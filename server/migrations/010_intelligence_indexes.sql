ALTER TABLE product ADD CONSTRAINT product_supplier_store FOREIGN KEY(supplier_id,store_id) REFERENCES supplier(id,store_id);
CREATE INDEX inventory_product_status ON inventory_unit(product_id,status);
CREATE INDEX order_store_created ON customer_order(store_id,created_at DESC);
CREATE INDEX sale_sold_at ON unit_sale(sold_at) WHERE returned_at IS NULL;
CREATE INDEX purchase_line_product ON purchase_order_line(product_id,order_id);
CREATE INDEX outbox_type_created ON outbox(event_type,created_at DESC);
