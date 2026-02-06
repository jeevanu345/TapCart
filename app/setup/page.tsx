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
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <Card className="w-full max-w-2xl border-border/60 bg-surface shadow-md">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Database className="h-6 w-6" />
            </div>
            <div>
              <CardTitle className="text-2xl font-semibold">Database Setup</CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                Initialize your database tables and create default admin user
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-lg border border-border bg-surface-muted p-4">
            <h3 className="font-semibold text-foreground mb-2">Before you start:</h3>
            <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
              <li>Make sure your DATABASE_URL environment variable is set in your .env file</li>
              <li>Ensure your NeonDB project is active and accessible</li>
              <li>This will create all required tables and a default admin user</li>
            </ul>
          </div>

          {result && (
            <Alert variant={result.success ? "success" : "destructive"}>
              <div className="flex items-start gap-2">
                {result.success ? (
                  <CheckCircle className="w-5 h-5 text-success mt-0.5" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-danger mt-0.5" />
                )}
                <div className="flex-1">
                  <AlertDescription>
                    <div className="font-semibold mb-1 text-current">{result.message}</div>
                    {result.details && typeof result.details === "object" && (
                      <div className="text-sm mt-2 text-foreground/80">
                        {result.details.adminCredentials && (
                          <div className="bg-surface p-2 rounded mt-2 border border-border">
                            <p className="font-semibold">Admin Credentials:</p>
                            <p>Email: {result.details.adminCredentials.email}</p>
                            <p>Password: {result.details.adminCredentials.password}</p>
                          </div>
                        )}
                        {result.details.tables && (
                          <div className="mt-2">
                            <p className="font-semibold">Created Tables:</p>
                            <p className="text-xs text-muted-foreground">{result.details.tables.join(", ")}</p>
                          </div>
                        )}
                      </div>
                    )}
                    {typeof result.details === "string" && (
                      <div className="text-xs mt-2 font-mono bg-surface-muted p-2 rounded border border-border">
                        {result.details}
                      </div>
                    )}
                  </AlertDescription>
                </div>
              </div>
            </Alert>
          )}

          <Button onClick={initializeDatabase} disabled={isLoading} className="w-full h-11" size="lg">
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
            <div className="flex flex-col gap-2 sm:flex-row">
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
