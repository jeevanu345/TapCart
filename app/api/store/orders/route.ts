import { type NextRequest, NextResponse } from "next/server"
import { getStoreSession } from "@/lib/auth"
import { neon } from "@neondatabase/serverless"

export const dynamic = "force-dynamic"

function getSql() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set")
  return neon(url)
}

async function ensureOrdersTables(sql: any) {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(50) UNIQUE NOT NULL,
        store_id VARCHAR(50),
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
    await sql`
      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(50),
        product_id INTEGER,
        product_name VARCHAR(255) NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price DECIMAL(10,2) NOT NULL,
        total_price DECIMAL(10,2) NOT NULL
      )
    `
  } catch (tableError) {
    console.log("Table creation check:", tableError)
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getStoreSession()
    if (!session?.isAuthenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const sql = getSql()
    
    // Ensure orders tables exist
    await ensureOrdersTables(sql)

    // Get all orders for this store
    const ordersResult = await sql`
      select * from orders
      where store_id = ${session.storeId}
      order by created_at desc
    `

    const orders = ordersResult as any[]

    // Get order items for each order
    const ordersWithItems = await Promise.all(
      orders.map(async (order) => {
        const itemsResult = await sql`
          select * from order_items
          where order_id = ${order.order_id}
        `
        return {
          ...order,
          items: itemsResult,
        }
      })
    )

    return NextResponse.json({ orders: ordersWithItems })
  } catch (error) {
    console.error("Orders GET error:", error)
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json(
      { error: "Internal server error", details: errorMessage },
      { status: 500 }
    )
  }
}

