import { type NextRequest, NextResponse } from "next/server"
import { verifyAdminCredentials } from "@/lib/db"
import { setAdminSession } from "@/lib/auth"
import { enforceSameOrigin } from "@/lib/security"

export async function POST(request: NextRequest) {
  try {
    const csrf = enforceSameOrigin(request)
    if (!csrf.ok) {
      return NextResponse.json({ error: csrf.reason }, { status: 403 })
    }

    const { email, password } = await request.json()

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 })
    }

    const isValid = await verifyAdminCredentials(email, password)

    if (!isValid) {
      return NextResponse.json({ error: "Invalid admin credentials" }, { status: 401 })
    }

    const sessionCookie = setAdminSession(email)
    const response = NextResponse.json({ success: true })

    response.cookies.set(sessionCookie)

    return response
  } catch (error) {
    console.error("Admin login error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
