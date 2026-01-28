# TapCart – Store Management System

[![Next.js](https://img.shields.io/badge/Next.js-14+-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5+-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-336791?style=flat-square&logo=postgresql)](https://neon.tech/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-CSS-38B2AC?style=flat-square&logo=tailwind-css)](https://tailwindcss.com/)

Modern store/admin dashboard + customer checkout flow built with **Next.js (App Router)**, **PostgreSQL (Neon)**, and **Twilio** for OTP/SMS verification.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Requirements](#requirements)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Database Setup](#database-setup)
- [Running the Application](#running-the-application)
- [API Routes](#api-routes)
- [Security Model](#security-model)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Features

### Store Portal
- Store signup/login with approval workflow
- Complete product CRUD operations
- Bulk product upload via CSV
- Order management and viewing
- Pay-at-desk approval system

### Admin Portal
- Secure admin authentication
- Store approval/denial management
- System-wide oversight

### Customer Flow
- Product lookup and browsing
- OTP verification via SMS
- Seamless checkout process
- HTML bill/invoice generation

---

## Tech Stack

| Technology | Purpose |
|------------|---------|
| **Next.js (App Router)** | Full-stack framework with API routes |
| **TypeScript** | Type-safe development |
| **PostgreSQL** | Database (via Neon serverless) |
| **TailwindCSS** | Utility-first styling |
| **shadcn/ui** | Pre-built UI components |
| **Twilio** | SMS/OTP verification |

---

## Project Structure

```
tapcart/
├── app/
│   ├── admin/              # Admin UI pages
│   ├── store/              # Store UI pages
│   ├── customer/           # Customer UI pages
│   └── api/                # API Route Handlers
│       ├── admin/
│       ├── store/
│       └── customer/
├── components/             # Shared UI components
├── lib/
│   ├── auth.ts            # Session management & signed tokens
│   ├── db.ts              # Database utilities & password hashing
│   ├── security.ts        # CSRF mitigation & origin checks
│   └── sms.ts             # Twilio SMS utilities
├── scripts/               # SQL schema & seed scripts
│   ├── 01-create-tables.sql
│   ├── 02-seed-data.sql
│   ├── 03-customer-tables.sql
│   └── 04-update-admin.sql
├── .env.local             # Environment variables (not committed)
└── package.json
```

---

## Requirements

- **Node.js** 18+ (recommended)
- **PostgreSQL** database (Neon recommended)
- **Twilio** account (for SMS/OTP features)

---

## Installation

### 1. Clone the repository

```bash
git clone <repository-url>
cd tapcart
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

Create a `.env.local` file in the project root:

```bash
cp .env.example .env.local
```

See [Environment Variables](#-environment-variables) section for details.

### 4. Set up the database

See [Database Setup](#-database-setup) section for instructions.

### 5. Run the development server

```bash
npm run dev
```

Visit the application:
- **Store Portal**: http://localhost:3000/store
- **Admin Portal**: http://localhost:3000/admin/login
- **Customer Portal**: http://localhost:3000/customer

---

## Environment Variables

Create a `.env.local` file with the following variables. **Never commit this file to version control.**

### Required Variables

```env
# Database
DATABASE_URL=postgresql://user:password@host/database?sslmode=require

# Session Security (generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
SESSION_SECRET=your-random-32-byte-hex-string

# Twilio (for SMS/OTP)
TWILIO_ACCOUNT_SID=your-twilio-account-sid
TWILIO_AUTH_TOKEN=your-twilio-auth-token
TWILIO_PHONE_NUMBER=+1234567890
```

### Recommended (Security)

```env
# Password Security
PASSWORD_PEPPER=your-optional-server-side-pepper

# CSRF Protection (comma-separated list)
ALLOWED_ORIGINS=https://your-domain.com,https://www.your-domain.com

# Public URL (for SMS links)
NEXT_PUBLIC_BASE_URL=https://your-domain.com
```

### Optional Debug Flags (Development Only)

```env
# ⚠️ NEVER enable these in production
OTP_DEBUG=true              # Returns OTP in API response
SMS_DEBUG=true              # Enables masked SMS debug logging
ALLOW_DEBUG_ROUTES=true     # Enables debug API routes
```

### Admin Setup Gating (Use Once)

```env
# ⚠️ Disable after initial setup
ADMIN_SETUP_TOKEN=your-secure-setup-token
ALLOW_ADMIN_SETUP=true      # Allow setup endpoints in production
```

---

## Database Setup

Choose **one** of the following methods:

### Option A: Manual SQL Scripts (Recommended)

Using your preferred PostgreSQL client (e.g., pgAdmin, DBeaver, or `psql`):

1. **Create tables**:
   ```bash
   psql $DATABASE_URL -f scripts/01-create-tables.sql
   psql $DATABASE_URL -f scripts/03-customer-tables.sql
   ```

2. **Seed data** (optional):
   ```bash
   psql $DATABASE_URL -f scripts/02-seed-data.sql
   ```

3. **Create admin user** (optional):
   ```bash
   psql $DATABASE_URL -f scripts/04-update-admin.sql
   ```

### Option B: Setup Endpoints (Use with Caution)

⚠️ **Security Warning**: Only use in controlled environments. Disable immediately after setup.

#### Prerequisites

Set in `.env.local`:
```env
ADMIN_SETUP_TOKEN=your-secret-token
ALLOW_ADMIN_SETUP=true
```

#### Initialize Database Schema

```bash
curl -X POST http://localhost:3000/api/admin/setup-db \
  -H "x-setup-token: your-secret-token" \
  -H "Content-Type: application/json" \
  -d '{
    "adminEmail": "admin@example.com",
    "adminPassword": "StrongPassword123!"
  }'
```

#### Create/Update Admin User

```bash
curl -X POST http://localhost:3000/api/admin/setup \
  -H "x-setup-token: your-secret-token" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "StrongPassword123!"
  }'
```

**After setup, immediately:**
1. Remove or set `ALLOW_ADMIN_SETUP=false`
2. Remove `ADMIN_SETUP_TOKEN` from `.env.local`

---

## Running the Application

### Development Mode

```bash
npm run dev
```

### Production Build

```bash
npm run lint          # Lint the codebase
npm run build         # Build for production
npm run start         # Start production server
```

### Access Points

| Portal | URL |
|--------|-----|
| Store Portal | `http://localhost:3000/store` |
| Admin Portal | `http://localhost:3000/admin/login` |
| Customer Portal | `http://localhost:3000/customer` |

---

## API Routes

### Store Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/store/auth/signup` | Register new store (pending approval) |
| `POST` | `/api/store/auth/login` | Store login |
| `POST` | `/api/store/auth/logout` | Store logout |
| `GET` | `/api/store/auth/session` | Check store session status |

### Admin Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/admin/auth/login` | Admin login |
| `POST` | `/api/admin/auth/logout` | Admin logout |
| `GET` | `/api/admin/session` | Check admin session status |

### Admin Actions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/admin/approve-store` | Approve or deny store registration |

### Store Products & Orders

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/store/products` | List all products |
| `POST` | `/api/store/products` | Create new product |
| `PATCH` | `/api/store/products` | Update existing product |
| `DELETE` | `/api/store/products` | Delete product |
| `POST` | `/api/store/products/bulk-upload` | Bulk upload products via CSV |
| `GET` | `/api/store/orders` | List all orders |
| `POST` | `/api/store/orders/approve` | Approve pay-at-desk order |

### Customer Flow

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/customer/otp/send` | Send OTP to phone number |
| `POST` | `/api/customer/otp/verify` | Verify OTP code |
| `POST` | `/api/customer/checkout` | Complete checkout process |
| `POST` | `/api/customer/coupon/apply` | Apply discount coupon |
| `GET` | `/api/customer/product` | Get product details |
| `GET` | `/api/customer/bill/:orderId` | Retrieve bill/invoice |

---

## Security Model

### Session Management

**Store & Admin Sessions**
- Stored in **HTTP-only cookies**: `store-session`, `admin-session`
- Cookies contain **cryptographically signed tokens** (not raw JSON)
- Automatic expiration handling
- Sessions invalidated if `SESSION_SECRET` changes (expected behavior)

### Password Security

- **Hashing Algorithm**: scrypt with per-user salt
- **Optional Pepper**: Server-side `PASSWORD_PEPPER` for additional security
- **Automatic Upgrades**: Legacy password hashes upgraded on successful login
- **Important**: Changing `PASSWORD_PEPPER` invalidates existing passwords

### Bill Access Control

Bills are accessible via:
```
GET /api/customer/bill/:orderId?t=<signed-token>
```

Access granted if **either**:
- Valid **signed bill token** (`t` parameter) is provided, OR
- Authenticated **store session** owns the order

### CSRF Mitigation

Cookie-authenticated mutation routes (POST/PATCH/DELETE) enforce **Origin allowlist**:

1. Configure `ALLOWED_ORIGINS` in `.env.local`
2. Requests must include matching `Origin` header
3. Requests without valid origin are rejected with `403`

Example:
```env
ALLOWED_ORIGINS=https://tapcart.com,https://www.tapcart.com
```

---

## Troubleshooting

### Common Issues

#### 401 Unauthorized on Bill Access

**Problem**: Cannot access bill via `/api/customer/bill/:orderId`

**Solution**: Bill endpoint requires either:
- Valid `t=` token parameter (from SMS link), OR
- Authenticated store session that owns the order

---

#### Setup Endpoints Return 404/401

**Problem**: Cannot access `/api/admin/setup` or `/api/admin/setup-db`

**Solutions**:
1. Ensure `ADMIN_SETUP_TOKEN` is set in `.env.local`
2. Include `x-setup-token` header in requests
3. In production, set `ALLOW_ADMIN_SETUP=true` (disable after use)

---

#### CSRF 403 Forbidden Errors

**Problem**: POST/PATCH/DELETE requests fail with 403

**Solutions**:
1. Set `ALLOWED_ORIGINS` to match your site origin(s)
2. Ensure requests include correct `Origin` header
3. For development, add `http://localhost:3000` to allowed origins

---

#### Session Lost After Restart

**Problem**: Users logged out after server restart

**Solution**: This is expected if `SESSION_SECRET` changed. Sessions are signed, not stored server-side.

---

#### SMS/OTP Not Working

**Problem**: OTP codes not being sent

**Checklist**:
1. Verify Twilio credentials are correct
2. Check `TWILIO_PHONE_NUMBER` is in E.164 format (`+1234567890`)
3. Ensure Twilio account has sufficient credits
4. Check phone number is verified (if using trial account)
5. Review Twilio dashboard for error logs

---

## Operational Notes

### Production Deployment

- **Database Migrations**: Prefer SQL migrations over runtime `CREATE TABLE IF NOT EXISTS`
- **Remove DDL**: Remove table creation logic from request handlers in production
- **SMS Links**: Ensure `NEXT_PUBLIC_BASE_URL` is set to your production domain
- **Security Headers**: Configure appropriate security headers (CSP, HSTS, etc.)
- **Rate Limiting**: Implement rate limiting on authentication endpoints
- **Monitoring**: Set up logging and monitoring for production environment

### Performance Considerations

- Use connection pooling for database access
- Implement caching strategies for frequently accessed data
- Optimize image assets and enable compression
- Use CDN for static assets in production

---

## License

Proprietary / Internal Use

---

## Contributing

This is a proprietary project. For internal contributors:

1. Create a feature branch
2. Make your changes
3. Submit a pull request
4. Await code review

---

## Support

For issues or questions, contact the development team.

---

**Built with Next.js and modern web technologies**