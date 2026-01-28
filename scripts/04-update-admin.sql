-- Update admin user credentials
-- Email: nfctapcart@gmail.com
-- Password: nfc12345

-- First, ensure the admin_users table exists
CREATE TABLE IF NOT EXISTS admin_users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert or update the admin user
INSERT INTO admin_users (email, password_hash) 
VALUES ('nfctapcart@gmail.com', '1647749480')
ON CONFLICT (email) 
DO UPDATE SET password_hash = EXCLUDED.password_hash;

-- Verify the admin user was created/updated
SELECT email, password_hash, created_at FROM admin_users WHERE email = 'nfctapcart@gmail.com';

