import { type NextRequest, NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { sendOTPSMS } from "@/lib/sms"

function getSql() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set")
  return neon(url)
}

// Generate 6-digit OTP
function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export async function POST(request: NextRequest) {
  try {
    const { phone } = await request.json()

    if (!phone || phone.length < 10) {
      return NextResponse.json({ error: "Valid phone number is required" }, { status: 400 })
    }

    const sql = getSql()

    // Ensure OTP table exists
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

    // Generate OTP
    const otpCode = generateOTP()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

    // Delete old OTPs for this phone
    await sql`delete from otp_verifications where phone = ${phone}`

    // Insert new OTP
    await sql`
      insert into otp_verifications (phone, otp_code, expires_at)
      values (${phone}, ${otpCode}, ${expiresAt.toISOString()})
    `

    // Send OTP via SMS
    try {
      await sendOTPSMS(phone, otpCode)
      return NextResponse.json({ success: true, message: "OTP sent successfully" })
    } catch (error: any) {
      console.error("Error sending OTP SMS:", error)
      // Return error details to help with debugging
      return NextResponse.json(
        { 
          success: false, 
          error: "Failed to send OTP via SMS",
          details: error.message || "Unknown error",
          // Include OTP in response only when explicitly enabled (never by default)
          otp: process.env.OTP_DEBUG === "true" && process.env.NODE_ENV !== "production" ? otpCode : undefined
        },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error("OTP send error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

