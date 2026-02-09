-- Update admin user credentials
-- Email: jeevanu345@gmail.com
-- Password: Jeevan%0000

-- First, ensure the admin_users table exists
CREATE TABLE IF NOT EXISTS admin_users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert or update the admin user
INSERT INTO admin_users (email, password_hash) 
VALUES ('jeevanu345@gmail.com', '-1796128564')
ON CONFLICT (email) 
DO UPDATE SET password_hash = EXCLUDED.password_hash;

-- Remove old default admin users
DELETE FROM admin_users
WHERE email IN ('nfctapcart@gmail.com', 'sahanapradeep2207@gmail.com');

-- Verify the admin user was created/updated
SELECT email, password_hash, created_at FROM admin_users WHERE email = 'jeevanu345@gmail.com';
