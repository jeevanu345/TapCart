import type React from "react"
import type { Metadata } from "next"
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import { Analytics } from "@vercel/analytics/next"
import { Toaster } from "@/components/ui/toaster"
import { Suspense } from "react"
import "./globals.css"

export const metadata: Metadata = {
  title: "Store Management System",
  description: "Modern store management platform for inventory, customers, and sales tracking",
  generator: "v0.app",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // Prevent static optimization issues when child routes use server data
  // by opting the app into dynamic rendering.
  // This is safe here because we rely on authenticated, per-user data.
  // If you later add fully static pages, you can override with export const dynamic = "force-static" in those pages.
  ;(globalThis as any).NEXT_DYNAMIC_FLAG = true
  return (
    <html lang="en">
      <body className={`font-sans ${GeistSans.variable} ${GeistMono.variable} antialiased`}>
        <Suspense fallback={null}>
          {children}
          <Toaster />
          <Analytics />
        </Suspense>
      </body>
    </html>
  )
}
