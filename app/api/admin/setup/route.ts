import { type NextRequest, NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { hashPassword } from "@/lib/db"

function getSql() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set")
  return neon(url)
}

function ensureSetupAllowed(request: NextRequest): NextResponse | null {
  // Never allow in production unless explicitly enabled.
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_ADMIN_SETUP !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const token = process.env.ADMIN_SETUP_TOKEN
  if (!token) {
    return NextResponse.json({ error: "ADMIN_SETUP_TOKEN is not set" }, { status: 500 })
  }

  const provided = request.headers.get("x-setup-token")
  if (!provided || provided !== token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  return null
}

export async function POST(request: NextRequest) {
  const gate = ensureSetupAllowed(request)
  if (gate) return gate

  try {
    const sql = getSql()
    const body = await request.json().catch(() => ({} as any))
    const email: unknown = body?.email
    const password: unknown = body?.password
    
    // Ensure admin_users table exists
    await sql`
      CREATE TABLE IF NOT EXISTS admin_users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `

    if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
      return NextResponse.json(
        { error: "Missing required fields: email, password" },
        { status: 400 }
      )
    }

    const hashedPassword = hashPassword(password)

    // Insert or update admin user (no credential disclosure)
    await sql`
      INSERT INTO admin_users (email, password_hash) 
      VALUES (${email}, ${hashedPassword})
      ON CONFLICT (email) 
      DO UPDATE SET password_hash = EXCLUDED.password_hash
    `

    return NextResponse.json({
      success: true,
      message: "Admin user setup completed successfully",
    })
  } catch (error) {
    console.error('Error setting up admin user:', error)
    return NextResponse.json({ 
      error: 'Failed to setup admin user',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
