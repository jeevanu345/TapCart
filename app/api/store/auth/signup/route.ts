import { type NextRequest, NextResponse } from "next/server"
import { createPendingStore, hashPassword, listStores } from "@/lib/db"

export async function POST(request: NextRequest) {
  try {
    const { storeId, password, email } = await request.json()

    if (!storeId || !password || !email) {
      return NextResponse.json({ error: "All fields are required" }, { status: 400 })
    }

    // Server-side password validation
    if (password.length < 6 || !/[A-Z]/.test(password)) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters and include one uppercase letter" },
        { status: 400 }
      )
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 })
    }

    // Validate store ID format (alphanumeric, no spaces)
    if (!/^[a-zA-Z0-9]+$/.test(storeId)) {
      return NextResponse.json(
        { error: "Store ID must contain only letters and numbers" },
        { status: 400 }
      )
    }

    const passwordHash = hashPassword(password)

    await createPendingStore(storeId.trim(), email.trim(), passwordHash)

    return NextResponse.json({
      success: true,
      message: "Registration submitted for approval",
    })
  } catch (error) {
    console.error("Signup error:", error)
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    
    // Check if it's a database connection error
    if (errorMessage.includes("DATABASE_URL") || errorMessage.includes("connection")) {
      return NextResponse.json(
        { error: "Database connection error. Please check your database configuration." },
        { status: 500 }
      )
    }
    
    // Check if it's a table doesn't exist error
    if (errorMessage.includes("does not exist") || errorMessage.includes("relation")) {
      return NextResponse.json(
        { error: "Database tables not initialized. Please run the database setup first at /setup" },
        { status: 500 }
      )
    }
    
    // Check if it's a duplicate key error
    if (errorMessage.includes("duplicate") || errorMessage.includes("unique")) {
      return NextResponse.json(
        { error: "Store ID already exists. Please choose a different Store ID." },
        { status: 400 }
      )
    }
    
    return NextResponse.json(
      { error: "Internal server error", details: errorMessage },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    const stores = await listStores()
    return NextResponse.json({ stores })
  } catch (error) {
    console.error("List stores error:", error)
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    
    // If table doesn't exist, return empty array
    if (errorMessage.includes("does not exist") || errorMessage.includes("relation")) {
      return NextResponse.json({ stores: [] })
    }
    
    return NextResponse.json(
      { error: "Failed to load stores", details: errorMessage },
      { status: 500 }
    )
  }
}
