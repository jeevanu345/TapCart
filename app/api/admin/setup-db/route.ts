import { type NextRequest, NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { hashPassword } from "@/lib/db"

function getSql() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set")
  return neon(url)
}

function ensureSetupAllowed(request: NextRequest): NextResponse | null {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_ADMIN_SETUP !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const token = process.env.ADMIN_SETUP_TOKEN
  if (!token) {
    return NextResponse.json({ error: "ADMIN_SETUP_TOKEN is not set" }, { status: 500 })
  }

  const provided = request.headers.get("x-setup-token")
  if (!provided || provided !== token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  return null
}

export async function POST(request: NextRequest) {
  const gate = ensureSetupAllowed(request)
  if (gate) return gate

  try {
    const sql = getSql()
    const body = await request.json().catch(() => ({} as any))
    const adminEmail: unknown = body?.adminEmail
    const adminPassword: unknown = body?.adminPassword

    // Create all tables
    // NOTE: keep minimal logging to avoid leaking operational details.

    // Stores table
    await sql`
      CREATE TABLE IF NOT EXISTS stores (
        id SERIAL PRIMARY KEY,
        store_id VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        approved_at TIMESTAMP NULL,
        approved_by VARCHAR(255) NULL
      )
    `

    // Admin users table
    await sql`
      CREATE TABLE IF NOT EXISTS admin_users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `

    // Products table
    await sql`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        store_id VARCHAR(50) REFERENCES stores(store_id),
        name VARCHAR(255) NOT NULL,
        stock INTEGER DEFAULT 0,
        price DECIMAL(10,2) DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `

    // Customers table
    await sql`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        store_id VARCHAR(50) REFERENCES stores(store_id),
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `

    // Purchases table
    await sql`
      CREATE TABLE IF NOT EXISTS purchases (
        id SERIAL PRIMARY KEY,
        store_id VARCHAR(50) REFERENCES stores(store_id),
        customer_id INTEGER REFERENCES customers(id),
        product_id INTEGER REFERENCES products(id),
        quantity INTEGER NOT NULL,
        total_amount DECIMAL(10,2) NOT NULL,
        purchase_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `

    // Cart items table
    await sql`
      CREATE TABLE IF NOT EXISTS cart_items (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255) NOT NULL,
        store_id VARCHAR(50) REFERENCES stores(store_id),
        product_id INTEGER REFERENCES products(id),
        quantity INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(session_id, product_id)
      )
    `

    // Orders table
    await sql`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(50) UNIQUE NOT NULL,
        store_id VARCHAR(50) REFERENCES stores(store_id),
        customer_phone VARCHAR(20) NOT NULL,
        customer_name VARCHAR(255),
        total_amount DECIMAL(10,2) NOT NULL,
        discount_amount DECIMAL(10,2) DEFAULT 0.00,
        final_amount DECIMAL(10,2) NOT NULL,
        coupon_code VARCHAR(50),
        payment_method VARCHAR(20) NOT NULL,
        payment_status VARCHAR(20) DEFAULT 'pending',
        order_status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        paid_at TIMESTAMP NULL,
        approved_at TIMESTAMP NULL
      )
    `

    // Order items table
    await sql`
      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(50) REFERENCES orders(order_id),
        product_id INTEGER REFERENCES products(id),
        product_name VARCHAR(255) NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price DECIMAL(10,2) NOT NULL,
        total_price DECIMAL(10,2) NOT NULL
      )
    `

    // Coupons table
    await sql`
      CREATE TABLE IF NOT EXISTS coupons (
        id SERIAL PRIMARY KEY,
        store_id VARCHAR(50) REFERENCES stores(store_id),
        code VARCHAR(50) UNIQUE NOT NULL,
        discount_type VARCHAR(20) NOT NULL,
        discount_value DECIMAL(10,2) NOT NULL,
        min_purchase_amount DECIMAL(10,2) DEFAULT 0.00,
        max_discount_amount DECIMAL(10,2),
        usage_limit INTEGER,
        used_count INTEGER DEFAULT 0,
        valid_from TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        valid_until TIMESTAMP,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `

    // OTP verifications table
    await sql`
      CREATE TABLE IF NOT EXISTS otp_verifications (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(20) NOT NULL,
        otp_code VARCHAR(6) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        verified BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `

    // Create indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_stores_store_id ON stores(store_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_products_store_id ON products(store_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_customers_store_id ON customers(store_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_purchases_store_id ON purchases(store_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_cart_items_session ON cart_items(session_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_orders_store_id ON orders(store_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_orders_customer_phone ON orders(customer_phone)`
    await sql`CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_coupons_store_id ON coupons(store_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code)`
    await sql`CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_verifications(phone)`

    // Create default admin user
    if (typeof adminEmail === "string" && typeof adminPassword === "string" && adminEmail && adminPassword) {
      const hashedPassword = hashPassword(adminPassword)
      await sql`
        INSERT INTO admin_users (email, password_hash) 
        VALUES (${adminEmail}, ${hashedPassword})
        ON CONFLICT (email) 
        DO UPDATE SET password_hash = EXCLUDED.password_hash
      `
    }

    return NextResponse.json({
      success: true,
      message: "Database initialized successfully!",
      tables: [
        "stores",
        "admin_users",
        "products",
        "customers",
        "purchases",
        "cart_items",
        "orders",
        "order_items",
        "coupons",
        "otp_verifications",
      ],
    })
  } catch (error) {
    console.error("Database setup error:", error)
    return NextResponse.json(
      {
        error: "Failed to setup database",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}

