import { NextResponse } from "next/server"
import { clearSession } from "@/lib/auth"

export async function POST() {
  const sessionCookie = clearSession("store")
  const response = NextResponse.json({ success: true })

  response.cookies.set(sessionCookie)

  // Prevent back/forward cache reusing authenticated pages
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate")
  response.headers.set("Pragma", "no-cache")
  response.headers.set("Expires", "0")
  response.headers.set("X-Robots-Tag", "noindex, nofollow")

  return response
}
