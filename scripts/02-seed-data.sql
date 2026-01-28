-- Insert default admin user (password: Sm2226#)
-- Note: This uses a simple hash for demo purposes. In production, use proper password hashing.
INSERT INTO admin_users (email, password_hash) 
VALUES ('sahanapradeep2207@gmail.com', '1073741824') -- Simple hash of 'Sm2226#'
ON CONFLICT (email) DO NOTHING;

-- Insert sample products for demo (will be associated with stores later)
INSERT INTO products (store_id, name, stock, price) VALUES
('DEMO001', 'Wireless Headphones', 25, 99.99),
('DEMO001', 'Smartphone Case', 50, 19.99),
('DEMO001', 'Bluetooth Speaker', 15, 79.99),
('DEMO001', 'USB Cable', 100, 9.99),
('DEMO001', 'Power Bank', 30, 49.99)
ON CONFLICT DO NOTHING;

-- Insert sample customers for demo
INSERT INTO customers (store_id, name, phone) VALUES
('DEMO001', 'John Smith', '+1-555-0123'),
('DEMO001', 'Sarah Johnson', '+1-555-0456'),
('DEMO001', 'Mike Davis', '+1-555-0789')
ON CONFLICT DO NOTHING;

-- Insert sample purchases for demo
INSERT INTO purchases (store_id, customer_id, product_id, quantity, total_amount) VALUES
('DEMO001', 1, 1, 2, 199.98),
('DEMO001', 2, 3, 1, 79.99),
('DEMO001', 3, 2, 3, 59.97),
('DEMO001', 1, 5, 1, 49.99)
ON CONFLICT DO NOTHING;
