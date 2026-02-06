import { type NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/auth"
import { approveOrDenyStore } from "@/lib/db"
import { enforceSameOrigin } from "@/lib/security"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  try {
    const csrf = enforceSameOrigin(request)
    if (!csrf.ok) {
      return NextResponse.json({ error: csrf.reason }, { status: 403 })
    }

    const session = await getAdminSession()

    if (!session?.isAuthenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { storeId, email, action, reason } = await request.json()

    if (!storeId || !email || !action) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    if (action !== "approve" && action !== "deny") {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 })
    }

    await approveOrDenyStore(storeId, action)

    return NextResponse.json({
      success: true,
      message: `Store ${action}d successfully`,
      emailSent: false,
    })
  } catch (error) {
    console.error("Store approval error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
