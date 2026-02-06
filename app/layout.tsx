import type React from "react"
import type { Metadata } from "next"
import { Manrope, Space_Grotesk } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { Toaster } from "@/components/ui/toaster"
import { Suspense } from "react"
import { ThemeProvider } from "@/components/theme-provider"
import "./globals.css"

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
})

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
})

export const metadata: Metadata = {
  title: "TapCart",
  description: "TapCart: NFC-Based Smart Retail System. Designed an IoT-integrated retail platform enabling tap-to-shop purchases and real-time inventory sync across devices. Tech Stack: NFC, IoT, React Native, Node.js, Express.js, Cloud APIs.",
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
  ; (globalThis as any).NEXT_DYNAMIC_FLAG = true
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`font-sans ${manrope.variable} ${spaceGrotesk.variable} antialiased min-h-screen bg-background text-foreground`}
      >
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
          <Suspense fallback={null}>
            {children}
            <Toaster />
            <Analytics />
          </Suspense>
        </ThemeProvider>
      </body>
    </html>
  )
}
