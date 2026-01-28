import { type NextRequest, NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { getStoreSession, verifyBillToken } from "@/lib/auth"

function getSql() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set")
  return neon(url)
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params
    const token = request.nextUrl.searchParams.get("t")
    const sql = getSql()

    // Get order details
    const orderResult = await sql`
      select * from orders where order_id = ${orderId} limit 1
    `

    if (!orderResult || orderResult.length === 0) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 })
    }

    const order = orderResult[0] as any

    // Authorization: allow via signed bill token (SMS link), or store session that owns the order.
    let authorized = false
    if (token && verifyBillToken(token, orderId)) {
      authorized = true
    } else {
      const session = await getStoreSession()
      if (session?.isAuthenticated && session.storeId && order.store_id === session.storeId) {
        authorized = true
      }
    }

    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Get order items
    const itemsResult = await sql`
      select * from order_items where order_id = ${orderId}
    `

    const items = itemsResult as any[]

    const escapeHtml = (value: unknown): string => {
      const s = String(value ?? "")
      return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
    }

    // Generate HTML bill
    const billHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Invoice - ${escapeHtml(orderId)}</title>
        <meta charset="UTF-8">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            padding: 40px 20px; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
          }
          .invoice-container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: hidden;
          }
          .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 40px;
            text-align: center;
          }
          .header h1 {
            font-size: 32px;
            margin-bottom: 10px;
            font-weight: 700;
          }
          .header p {
            font-size: 16px;
            opacity: 0.9;
          }
          .content {
            padding: 40px;
          }
          .details {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 2px solid #f0f0f0;
          }
          .detail-item {
            margin-bottom: 10px;
          }
          .detail-label {
            font-weight: 600;
            color: #666;
            font-size: 14px;
            margin-bottom: 5px;
          }
          .detail-value {
            color: #333;
            font-size: 16px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 30px;
          }
          thead {
            background: #f8f9fa;
          }
          th {
            padding: 15px;
            text-align: left;
            font-weight: 600;
            color: #333;
            border-bottom: 2px solid #e0e0e0;
          }
          td {
            padding: 15px;
            border-bottom: 1px solid #f0f0f0;
            color: #555;
          }
          tbody tr:hover {
            background: #f8f9fa;
          }
          .total-section {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            margin-top: 20px;
          }
          .total-row {
            display: flex;
            justify-content: space-between;
            padding: 10px 0;
            font-size: 16px;
          }
          .total-row.final {
            font-size: 24px;
            font-weight: 700;
            color: #667eea;
            border-top: 2px solid #e0e0e0;
            padding-top: 15px;
            margin-top: 10px;
          }
          .footer {
            background: #f8f9fa;
            padding: 30px 40px;
            text-align: center;
            color: #666;
            border-top: 2px solid #e0e0e0;
          }
          .status-badge {
            display: inline-block;
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
          }
          .status-confirmed {
            background: #d4edda;
            color: #155724;
          }
          .status-pending {
            background: #fff3cd;
            color: #856404;
          }
          @media print {
            body {
              background: white;
              padding: 0;
            }
            .invoice-container {
              box-shadow: none;
            }
          }
        </style>
      </head>
      <body>
        <div class="invoice-container">
          <div class="header">
            <h1>Invoice</h1>
            <p>Order ID: ${escapeHtml(orderId)}</p>
          </div>
          <div class="content">
            <div class="details">
              <div>
                <div class="detail-item">
                  <div class="detail-label">Store ID</div>
                  <div class="detail-value">${escapeHtml(order.store_id)}</div>
                </div>
                <div class="detail-item">
                  <div class="detail-label">Customer Phone</div>
                  <div class="detail-value">${escapeHtml(order.customer_phone)}</div>
                </div>
              </div>
              <div>
                <div class="detail-item">
                  <div class="detail-label">Order Date</div>
                  <div class="detail-value">${escapeHtml(new Date(order.created_at).toLocaleString())}</div>
                </div>
                <div class="detail-item">
                  <div class="detail-label">Payment Method</div>
                  <div class="detail-value">${escapeHtml(String(order.payment_method).replace(/_/g, " ").toUpperCase())}</div>
                </div>
                <div class="detail-item">
                  <div class="detail-label">Order Status</div>
                  <div class="detail-value">
                    <span class="status-badge ${
                      order.order_status === "confirmed" ? "status-confirmed" : "status-pending"
                    }">
                      ${escapeHtml(order.order_status)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Product Name</th>
                  <th>Quantity</th>
                  <th>Unit Price</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                ${items
                  .map(
                    (item) => `
                  <tr>
                    <td>${escapeHtml(item.product_name)}</td>
                    <td>${escapeHtml(item.quantity)}</td>
                    <td>₹${escapeHtml(parseFloat(item.unit_price).toFixed(2))}</td>
                    <td>₹${escapeHtml(parseFloat(item.total_price).toFixed(2))}</td>
                  </tr>
                `
                  )
                  .join("")}
              </tbody>
            </table>
            <div class="total-section">
              <div class="total-row">
                <span>Subtotal:</span>
                <span>₹${escapeHtml(parseFloat(order.total_amount).toFixed(2))}</span>
              </div>
              ${parseFloat(order.discount_amount) > 0
                ? `
              <div class="total-row">
                <span>Discount${order.coupon_code ? ` (${escapeHtml(order.coupon_code)})` : ""}:</span>
                <span style="color: #28a745;">-₹${escapeHtml(parseFloat(order.discount_amount).toFixed(2))}</span>
              </div>
              `
                : ""}
              <div class="total-row final">
                <span>Total Amount:</span>
                <span>₹${escapeHtml(parseFloat(order.final_amount).toFixed(2))}</span>
              </div>
            </div>
          </div>
          <div class="footer">
            <p>Thank you for your purchase!</p>
            <p style="margin-top: 10px; font-size: 12px;">
              This is an electronic invoice. No signature required.
            </p>
          </div>
        </div>
      </body>
      </html>
    `

    // Return HTML response
    return new NextResponse(billHtml, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    console.error("Bill generation error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

