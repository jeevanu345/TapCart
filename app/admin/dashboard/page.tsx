"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { AdminSidebar } from "@/components/admin-sidebar"
import { ApprovalActions } from "@/components/approval-actions"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Clock, Users, Store, AlertTriangle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import Link from "next/link"

interface StoreItem {
  id: string
  storeId: string
  email: string
  status: string
  createdAt: string
}

function calcCounts(items: StoreItem[]) {
  const pending = items.filter((s) => s.status === "pending").length
  const approved = items.filter((s) => s.status === "approved").length
  const total = items.length
  return { pending, approved, total }
}

export default function AdminDashboardPage() {
  const [stores, setStores] = useState<StoreItem[]>([])
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)
  const { toast } = useToast()
  const router = useRouter()

  const loadStores = useCallback(async () => {
    setIsRefreshing(true)
    try {
      const res = await fetch("/api/store/auth/signup", { method: "GET" })
      if (!res.ok) {
        throw new Error(`Failed to load stores: ${res.statusText}`)
      }
      const data = await res.json()
      const list: StoreItem[] = (data?.stores || []).map((s: any, i: number) => ({
        id: String(i) + ":" + (s.store_id ?? s.storeId),
        storeId: s.store_id ?? s.storeId,
        email: s.email,
        status: s.status,
        createdAt: s.created_at ?? s.createdAt,
      }))
      setStores(list)
    } catch (e) {
      console.error("Error loading stores:", e)
      toast({
        title: "Error loading stores",
        description: e instanceof Error ? e.message : "Failed to load stores. Please check if database is initialized.",
        variant: "destructive",
      })
    } finally {
      setIsRefreshing(false)
    }
  }, [toast])

  // Check authentication on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch("/admin/session")
        if (!res.ok) {
          // Redirect to home page instead of login page after logout
          window.location.href = "/"
          return
        }
        setIsCheckingAuth(false)
      } catch (e) {
        // Redirect to home page on error
        window.location.href = "/"
      }
    }
    checkAuth()
  }, [router])

  useEffect(() => {
    if (!isCheckingAuth) {
      loadStores()
    }
  }, [isCheckingAuth, loadStores])

  const counts = calcCounts(stores)
  const visible = stores.filter((s) => s.status === "pending")
  const activeStores = stores.filter((s) => s.status === "approved")

  const handleRefresh = async () => {
    await loadStores()
  }

  const handleResolved = (resolvedStoreId: string, action: "approve" | "deny") => {
    setStores((prev) =>
      prev.map((s) => (s.storeId === resolvedStoreId ? { ...s, status: action === "approve" ? "approved" : "denied" } : s))
    )
  }

  const revokeAccess = async (storeId: string, email: string) => {
    if (!confirm(`Revoke access for ${storeId}?`)) return
    try {
      const res = await fetch("/api/admin/approve-store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, email, action: "deny", reason: "Access revoked by admin" }),
      })
      const data = await res.json()
      if (res.ok) {
        toast({ title: "Access revoked", description: `${storeId} has been set to denied` })
        setStores((prev) => prev.map((s) => (s.storeId === storeId ? { ...s, status: "denied" } : s)))
      } else {
        toast({ title: "Error", description: data.error || "Failed to revoke access", variant: "destructive" })
      }
    } catch (e) {
      toast({ title: "Network error", description: "Please try again.", variant: "destructive" })
    }
  }

  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin text-slate-600 mx-auto mb-4" />
          <p className="text-slate-600">Checking authentication...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminSidebar />

      <div className="lg:ml-64">
        <div className="p-6 lg:p-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 mb-2">Admin Dashboard</h1>
              <p className="text-slate-600">Manage store registrations and user approvals</p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/">
                <Button variant="outline" size="sm" onClick={(e) => { e.preventDefault(); window.location.href = "/" }}>Back to Home</Button>
              </Link>
              <Button onClick={handleRefresh} disabled={isRefreshing} variant="outline" size="sm">
                <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <Card className="border-0 shadow-sm bg-gradient-to-br from-orange-50 to-red-50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">Pending Approvals</CardTitle>
                <Clock className="h-4 w-4 text-orange-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-slate-900">{counts.pending}</div>
                <p className="text-xs text-slate-500 mt-1">Awaiting review</p>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm bg-gradient-to-br from-green-50 to-emerald-50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">Active Stores</CardTitle>
                <Store className="h-4 w-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-slate-900">{counts.approved}</div>
                <p className="text-xs text-slate-500 mt-1">Approved and active</p>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm bg-gradient-to-br from-blue-50 to-cyan-50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">Total Users</CardTitle>
                <Users className="h-4 w-4 text-blue-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-slate-900">{counts.total}</div>
                <p className="text-xs text-slate-500 mt-1">All registered stores</p>
              </CardContent>
            </Card>
          </div>

          {/* Pending Approvals */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-orange-600" />
                Pending Store Approvals
              </CardTitle>
              <CardDescription>Review and approve new store registrations</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {visible.map((store) => (
                  <div
                    key={store.id}
                    className="flex items-center justify-between p-4 rounded-xl border border-slate-200 hover:border-slate-300 hover:shadow-sm transition-all duration-200"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="font-semibold text-slate-900">{store.storeId}</h3>
                        <Badge variant="secondary" className="bg-orange-100 text-orange-700">
                          Pending
                        </Badge>
                      </div>
                      <div className="text-sm text-slate-600 mb-1">{store.email}</div>
                      <div className="text-xs text-slate-500">
                        Submitted: {new Date(store.createdAt).toLocaleDateString()}
                      </div>
                    </div>

                    <ApprovalActions
                      storeId={store.storeId}
                      email={store.email}
                      onStatusChange={handleRefresh}
                    />
                  </div>
                ))}

                {visible.length === 0 && (
                  <div className="text-center py-12">
                    <AlertTriangle className="h-12 w-12 text-green-500 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-slate-900 mb-2">All caught up!</h3>
                    <p className="text-slate-500">No pending store approvals at the moment.</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Active Stores - Revoke Access */}
          <Card className="border-0 shadow-sm mt-8">
            <CardHeader>
              <CardTitle className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <Store className="h-5 w-5 text-green-600" />
                Active Stores
              </CardTitle>
              <CardDescription>Revoke access for previously approved stores</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {activeStores.map((store) => (
                  <div
                    key={store.id}
                    className="flex items-center justify-between p-4 rounded-xl border border-slate-200 hover:border-slate-300 hover:shadow-sm transition-all duration-200"
                  >
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <h3 className="font-semibold text-slate-900">{store.storeId}</h3>
                        <Badge className="bg-green-100 text-green-700">Approved</Badge>
                      </div>
                      <div className="text-sm text-slate-600">{store.email}</div>
                    </div>
                    <Button variant="destructive" size="sm" onClick={() => revokeAccess(store.storeId, store.email)}>
                      Revoke Access
                    </Button>
                  </div>
                ))}
                {activeStores.length === 0 && (
                  <div className="text-center py-12 text-slate-500">No active stores.</div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
