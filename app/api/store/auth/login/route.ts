import { type NextRequest, NextResponse } from "next/server"
import { verifyStoreCredentials } from "@/lib/db"
import { setStoreSession } from "@/lib/auth"
import { enforceSameOrigin } from "@/lib/security"

export async function POST(request: NextRequest) {
  try {
    const csrf = enforceSameOrigin(request)
    if (!csrf.ok) {
      return NextResponse.json({ error: csrf.reason }, { status: 403 })
    }

    const { storeId, password } = await request.json()

    if (!storeId || !password) {
      return NextResponse.json({ error: "Store ID and password are required" }, { status: 400 })
    }

    const result = await verifyStoreCredentials(storeId, password)

    if (!result.isValid) {
      let errorMessage = "Invalid credentials"
      
      if (result.reason === "not_found") {
        errorMessage = "Store ID not found"
      } else if (result.reason === "not_approved") {
        errorMessage = "Your account is pending approval. Please wait for admin approval."
      } else if (result.reason === "wrong_password") {
        errorMessage = "Incorrect password"
      }
      
      return NextResponse.json({ error: errorMessage }, { status: 401 })
    }

    const sessionCookie = setStoreSession(storeId.trim())
    const response = NextResponse.json({ success: true })

    response.cookies.set(sessionCookie)

    return response
  } catch (error) {
    console.error("Login error:", error)
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json(
      { error: "Internal server error", details: errorMessage },
      { status: 500 }
    )
  }
}
