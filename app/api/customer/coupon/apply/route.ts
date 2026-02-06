import { type NextRequest, NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"

function getSql() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set")
  return neon(url)
}

export async function POST(request: NextRequest) {
  try {
    const { code, storeId, amount } = await request.json()

    if (!code || !storeId || !amount) {
      return NextResponse.json(
        { error: "Coupon code, store ID, and amount are required" },
        { status: 400 }
      )
    }

    const sql = getSql()

    // Ensure coupons table exists
    await sql`
      CREATE TABLE IF NOT EXISTS coupons (
        id SERIAL PRIMARY KEY,
        store_id VARCHAR(50),
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

    // Get coupon
    const couponResult = await sql`
      select * from coupons
      where code = ${code} and store_id = ${storeId} and is_active = true
      limit 1
    `

    if (!couponResult || couponResult.length === 0) {
      return NextResponse.json({ error: "Invalid or expired coupon code" }, { status: 404 })
    }

    const coupon = couponResult[0] as {
      code: string
      discount_type: string
      discount_value: number
      min_purchase_amount: number
      max_discount_amount: number | null
      usage_limit: number | null
      used_count: number
      valid_until: Date | null
    }

    // Check if coupon is expired
    if (coupon.valid_until && new Date(coupon.valid_until) < new Date()) {
      return NextResponse.json({ error: "Coupon has expired" }, { status: 400 })
    }

    // Check minimum purchase amount
    if (amount < coupon.min_purchase_amount) {
      return NextResponse.json(
        { error: `Minimum purchase amount of ₹${coupon.min_purchase_amount} required` },
        { status: 400 }
      )
    }

    // Check usage limit
    if (coupon.usage_limit && coupon.used_count >= coupon.usage_limit) {
      return NextResponse.json({ error: "Coupon usage limit reached" }, { status: 400 })
    }

    // Calculate discount
    let discount = 0
    if (coupon.discount_type === "percentage") {
      discount = (amount * coupon.discount_value) / 100
      if (coupon.max_discount_amount && discount > coupon.max_discount_amount) {
        discount = coupon.max_discount_amount
      }
    } else if (coupon.discount_type === "fixed") {
      discount = coupon.discount_value
      if (discount > amount) {
        discount = amount
      }
    }

    return NextResponse.json({
      success: true,
      discount: Math.round(discount * 100) / 100,
      coupon: {
        code: coupon.code,
        discount_type: coupon.discount_type,
        discount_value: coupon.discount_value,
      },
    })
  } catch (error) {
    console.error("Coupon apply error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

