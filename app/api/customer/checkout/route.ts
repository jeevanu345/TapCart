import { type NextRequest, NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { sendOrderConfirmationSMS } from "@/lib/sms"
import { mintBillToken } from "@/lib/auth"

function getSql() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set")
  return neon(url)
}

// Generate unique order ID
function generateOrderId(): string {
  return `ORD${Date.now()}${Math.floor(Math.random() * 1000)}`
}

export async function POST(request: NextRequest) {
  try {
    const { phone, cart, storeId, paymentMethod, couponCode, discount, totalAmount } =
      await request.json()

    if (!phone || !cart || !storeId || !paymentMethod || totalAmount === undefined) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const sql = getSql()

    // Ensure tables exist
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

    // Verify OTP was verified
    const otpCheck = await sql`
      select verified from otp_verifications
      where phone = ${phone} and verified = true
      order by created_at desc
      limit 1
    `

    if (!otpCheck || otpCheck.length === 0) {
      return NextResponse.json(
        { error: "Please verify your phone number with OTP first" },
        { status: 401 }
      )
    }

    // Ensure products table exists
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS products (
          id SERIAL PRIMARY KEY,
          store_id VARCHAR(50),
          name VARCHAR(255) NOT NULL,
          stock INTEGER DEFAULT 0,
          price DECIMAL(10,2) DEFAULT 0.00,
          category VARCHAR(100) DEFAULT 'General',
          custom_id VARCHAR(50),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `
    } catch (tableError) {
      console.log("Products table check:", tableError)
    }

    // Get products and verify stock
    const productIds = cart.map((item: any) => item.product_id)
    const products = await sql`
      select id, name, price, stock from products
      where id = ANY(${productIds}::int[]) and store_id = ${storeId}
    `

    if (products.length !== cart.length) {
      return NextResponse.json({ error: "Some products are not available" }, { status: 400 })
    }

    // Check stock availability
    for (const item of cart) {
      const product = products.find((p: any) => p.id === item.product_id)
      if (!product || product.stock < item.quantity) {
        return NextResponse.json(
          { error: `Insufficient stock for ${product?.name || "product"}` },
          { status: 400 }
        )
      }
    }

    // Generate order ID
    const orderId = generateOrderId()

    // Calculate amounts
    const subtotal = products.reduce((sum: number, product: any) => {
      const cartItem = cart.find((item: any) => item.product_id === product.id)
      return sum + parseFloat(product.price) * cartItem.quantity
    }, 0)

    const discountAmount = discount || 0
    const finalAmount = subtotal - discountAmount

    // Create order
    await sql`
      insert into orders (
        order_id, store_id, customer_phone, total_amount, discount_amount,
        final_amount, coupon_code, payment_method, payment_status, order_status
      )
      values (
        ${orderId}, ${storeId}, ${phone}, ${subtotal}, ${discountAmount},
        ${finalAmount}, ${couponCode || null}, ${paymentMethod},
        ${paymentMethod === "pay_at_desk" ? "pending" : "completed"},
        ${paymentMethod === "pay_at_desk" ? "pending" : "confirmed"}
      )
    `

    // Create order items
    for (const item of cart) {
      const product = products.find((p: any) => p.id === item.product_id)
      if (product) {
        await sql`
          insert into order_items (order_id, product_id, product_name, quantity, unit_price, total_price)
          values (
            ${orderId}, ${product.id}, ${product.name}, ${item.quantity},
            ${product.price}, ${parseFloat(product.price) * item.quantity}
          )
        `
      }
    }

    // Update payment status and paid_at for card/UPI
    if (paymentMethod !== "pay_at_desk") {
      await sql`
        update orders
        set payment_status = 'completed', paid_at = now(), order_status = 'confirmed'
        where order_id = ${orderId}
      `
      
      // Update inventory (reduce stock) only after payment is confirmed
      for (const item of cart) {
        await sql`
          update products
          set stock = stock - ${item.quantity}
          where id = ${item.product_id} and store_id = ${storeId}
        `
      }

      // Update coupon usage if coupon was used
      if (couponCode) {
        await sql`
          update coupons
          set used_count = used_count + 1
          where code = ${couponCode} and store_id = ${storeId}
        `
      }
    } else {
      // For pay_at_desk, inventory will be updated when payment is approved
      // Update coupon usage if coupon was used (will be applied when payment is confirmed)
      if (couponCode) {
        // Note: Coupon usage will be updated when payment is confirmed
      }
    }

    // Store bill data in order (we'll generate it on-demand via API route)
    const billUrl = `/api/customer/bill/${orderId}?t=${encodeURIComponent(mintBillToken(orderId))}`

    // Send SMS with bill link
    try {
      await sendOrderConfirmationSMS(phone, orderId, billUrl, paymentMethod)
      console.log(`Order confirmation SMS sent to ${phone}`)
    } catch (error) {
      console.error("Error sending order confirmation SMS:", error)
      // Don't fail the request if SMS fails - order is still created
    }

    return NextResponse.json({
      success: true,
      orderId,
      billUrl,
      message: "Order placed successfully",
    })
  } catch (error) {
    console.error("Checkout error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

