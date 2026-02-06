import { type NextRequest, NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"

function getSql() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set")
  return neon(url)
}

export async function POST(request: NextRequest) {
  try {
    const { phone, otp } = await request.json()

    if (!phone || !otp) {
      return NextResponse.json({ error: "Phone number and OTP are required" }, { status: 400 })
    }

    const sql = getSql()

    // Get the latest OTP for this phone
    const result = await sql`
      select otp_code, expires_at, verified
      from otp_verifications
      where phone = ${phone}
      order by created_at desc
      limit 1
    `

    if (!result || result.length === 0) {
      return NextResponse.json({ error: "OTP not found. Please request a new OTP." }, { status: 404 })
    }

    const otpRecord = result[0] as { otp_code: string; expires_at: Date; verified: boolean }

    // Check if already verified
    if (otpRecord.verified) {
      return NextResponse.json({ error: "OTP already used. Please request a new OTP." }, { status: 400 })
    }

    // Check if expired
    if (new Date(otpRecord.expires_at) < new Date()) {
      return NextResponse.json({ error: "OTP expired. Please request a new OTP." }, { status: 400 })
    }

    // Verify OTP
    if (otpRecord.otp_code !== otp) {
      return NextResponse.json({ error: "Invalid OTP code." }, { status: 401 })
    }

    // Mark as verified
    await sql`
      update otp_verifications
      set verified = true
      where phone = ${phone} and otp_code = ${otp}
    `

    return NextResponse.json({ success: true, message: "OTP verified successfully" })
  } catch (error) {
    console.error("OTP verify error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

