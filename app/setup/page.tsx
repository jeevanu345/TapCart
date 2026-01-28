"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Loader2, Database, CheckCircle, AlertCircle } from "lucide-react"
import Link from "next/link"

export default function SetupPage() {
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string; details?: any } | null>(null)

  const initializeDatabase = async () => {
    setIsLoading(true)
    setResult(null)

    try {
      const response = await fetch("/api/admin/setup-db", {
        method: "POST",
      })

      const data = await response.json()

      if (response.ok) {
        setResult({
          success: true,
          message: data.message || "Database initialized successfully!",
          details: data,
        })
      } else {
        setResult({
          success: false,
          message: data.error || "Failed to initialize database",
          details: data.details,
        })
      }
    } catch (error) {
      setResult({
        success: false,
        message: "Network error. Please check your DATABASE_URL environment variable.",
        details: error instanceof Error ? error.message : "Unknown error",
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl bg-white/95 backdrop-blur-sm border-0 shadow-2xl">
        <CardHeader>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-cyan-600 rounded-xl flex items-center justify-center">
              <Database className="w-6 h-6 text-white" />
            </div>
            <div>
              <CardTitle className="text-2xl font-bold text-slate-900">Database Setup</CardTitle>
              <CardDescription className="text-slate-600">
                Initialize your database tables and create default admin user
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-slate-50 p-4 rounded-lg">
            <h3 className="font-semibold text-slate-900 mb-2">Before you start:</h3>
            <ul className="text-sm text-slate-600 space-y-1 list-disc list-inside">
              <li>Make sure your DATABASE_URL environment variable is set in your .env file</li>
              <li>Ensure your NeonDB project is active and accessible</li>
              <li>This will create all required tables and a default admin user</li>
            </ul>
          </div>

          {result && (
            <Alert className={result.success ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}>
              <div className="flex items-start gap-2">
                {result.success ? (
                  <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
                )}
                <div className="flex-1">
                  <AlertDescription className={result.success ? "text-green-700" : "text-red-700"}>
                    <div className="font-semibold mb-1">{result.message}</div>
                    {result.details && typeof result.details === "object" && (
                      <div className="text-sm mt-2">
                        {result.details.adminCredentials && (
                          <div className="bg-white/50 p-2 rounded mt-2">
                            <p className="font-semibold">Admin Credentials:</p>
                            <p>Email: {result.details.adminCredentials.email}</p>
                            <p>Password: {result.details.adminCredentials.password}</p>
                          </div>
                        )}
                        {result.details.tables && (
                          <div className="mt-2">
                            <p className="font-semibold">Created Tables:</p>
                            <p className="text-xs">{result.details.tables.join(", ")}</p>
                          </div>
                        )}
                      </div>
                    )}
                    {typeof result.details === "string" && (
                      <div className="text-xs mt-2 font-mono bg-white/50 p-2 rounded">{result.details}</div>
                    )}
                  </AlertDescription>
                </div>
              </div>
            </Alert>
          )}

          <Button
            onClick={initializeDatabase}
            disabled={isLoading}
            className="w-full h-12 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white font-medium"
            size="lg"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Initializing Database...
              </>
            ) : (
              <>
                <Database className="mr-2 h-5 w-5" />
                Initialize Database
              </>
            )}
          </Button>

          {result?.success && (
            <div className="flex gap-2">
              <Link href="/admin/login" className="flex-1">
                <Button variant="outline" className="w-full">
                  Go to Admin Login
                </Button>
              </Link>
              <Link href="/" className="flex-1">
                <Button variant="outline" className="w-full">
                  Back to Home
                </Button>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

