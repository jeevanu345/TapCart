import { type NextRequest } from "next/server"

function normalizeOrigin(origin: string): string {
  try {
    const u = new URL(origin)
    // origin is scheme+host(+port)
    return u.origin
  } catch {
    return origin
  }
}

function getAllowedOrigins(): string[] {
  const env = process.env.ALLOWED_ORIGINS
  if (env) {
    return env
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(normalizeOrigin)
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL
  if (baseUrl) {
    return [normalizeOrigin(baseUrl)]
  }

  // No configured origin; caller can decide how strict to be.
  return []
}

/**
 * Basic CSRF mitigation for cookie-authenticated mutation endpoints.
 * - For same-site requests, browsers usually omit Origin; we allow missing origin.
 * - For cross-site requests, Origin is typically present; we require it to be allowed.
 */
export function enforceSameOrigin(request: NextRequest): { ok: true } | { ok: false; reason: string } {
  const origin = request.headers.get("origin")
  if (!origin) return { ok: true }

  const allowed = getAllowedOrigins()
  if (allowed.length === 0) {
    return { ok: false, reason: "Origin not allowed (no ALLOWED_ORIGINS configured)" }
  }

  const normalized = normalizeOrigin(origin)
  if (!allowed.includes(normalized)) {
    return { ok: false, reason: "Origin not allowed" }
  }

  return { ok: true }
}

