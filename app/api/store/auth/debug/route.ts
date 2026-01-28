import { type NextRequest, NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { getAdminSession } from "@/lib/auth"
import { verifyPassword } from "@/lib/db"

function getSql() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set")
  return neon(url)
}

// Debug route to check store status and hash password
// This is for debugging only - remove or secure in production
export async function POST(request: NextRequest) {
  try {
    // Never expose in production unless explicitly enabled.
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEBUG_ROUTES !== "true") {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    // Require an authenticated admin session for use.
    const admin = await getAdminSession()
    if (!admin?.isAuthenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { storeId, password } = await request.json()

    if (!storeId) {
      return NextResponse.json({ error: "Store ID is required" }, { status: 400 })
    }

    const sql = getSql()
    
    // Get store info
    const result = await sql`
      select store_id, email, status, password_hash, created_at, approved_at
      from stores
      where store_id = ${storeId.trim()}
      limit 1
    `

    if (!result || result.length === 0) {
      return NextResponse.json({ error: "Store not found" }, { status: 404 })
    }

    const store = result[0] as any

    // If password provided, verify without leaking stored hash.
    let passwordInfo = null
    if (password) {
      const verify = verifyPassword(String(store.password_hash), String(password).trim())
      passwordInfo = {
        providedPassword: "***",
        matches: verify.ok,
        needsUpgrade: verify.needsUpgrade,
      }
    }

    return NextResponse.json({
      store: {
        store_id: store.store_id,
        email: store.email,
        status: store.status,
        created_at: store.created_at,
        approved_at: store.approved_at,
      },
      passwordInfo,
    })
  } catch (error) {
    console.error("Debug error:", error)
    return NextResponse.json(
      { error: "Internal server error", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}

