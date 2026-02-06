import { type NextRequest, NextResponse } from "next/server"
import { getStoreSession } from "@/lib/auth"
import { neon } from "@neondatabase/serverless"
import { sendOrderConfirmationSMS } from "@/lib/sms"
import { mintBillToken } from "@/lib/auth"
import { enforceSameOrigin } from "@/lib/security"

function getSql() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set")
  return neon(url)
}

export async function POST(request: NextRequest) {
  try {
    const csrf = enforceSameOrigin(request)
    if (!csrf.ok) {
      return NextResponse.json({ error: csrf.reason }, { status: 403 })
    }

    const session = await getStoreSession()
    if (!session?.isAuthenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { orderId } = await request.json()

    if (!orderId) {
      return NextResponse.json({ error: "Order ID is required" }, { status: 400 })
    }

    const sql = getSql()

    // Get order and verify it belongs to this store
    const orderResult = await sql`
      select * from orders
      where order_id = ${orderId} and store_id = ${session.storeId}
      limit 1
    `

    if (!orderResult || orderResult.length === 0) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 })
    }

    const order = orderResult[0] as any

    if (order.payment_method !== "pay_at_desk") {
      return NextResponse.json(
        { error: "This order is not a pay-at-desk order" },
        { status: 400 }
      )
    }

    if (order.payment_status === "completed") {
      return NextResponse.json({ error: "Order already paid" }, { status: 400 })
    }

    // Get order items to update inventory
    const orderItems = await sql`
      select product_id, quantity from order_items
      where order_id = ${orderId}
    `

    // Update order status
    await sql`
      update orders
      set payment_status = 'completed',
          order_status = 'confirmed',
          paid_at = now(),
          approved_at = now()
      where order_id = ${orderId} and store_id = ${session.storeId}
    `

    // Update inventory (reduce stock) after payment is confirmed
    for (const item of orderItems) {
      await sql`
        update products
        set stock = stock - ${item.quantity}
        where id = ${item.product_id} and store_id = ${session.storeId}
      `
    }

    // Update coupon usage if coupon was used
    if (order.coupon_code) {
      await sql`
        update coupons
        set used_count = used_count + 1
        where code = ${order.coupon_code} and store_id = ${session.storeId}
      `
    }

    // Send SMS to customer
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://tapcart-fr.onrender.com"
    const billUrl = `/api/customer/bill/${orderId}?t=${encodeURIComponent(mintBillToken(orderId))}`
    
    try {
      await sendOrderConfirmationSMS(order.customer_phone, orderId, billUrl, "pay_at_desk")
      console.log(`Payment confirmation SMS sent to ${order.customer_phone}`)
    } catch (error) {
      console.error("Error sending payment confirmation SMS:", error)
      // Don't fail the request if SMS fails - payment is still approved
    }

    return NextResponse.json({
      success: true,
      message: "Order payment approved successfully",
    })
  } catch (error) {
    console.error("Order approval error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

