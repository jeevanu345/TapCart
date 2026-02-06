"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { AdminSidebar } from "@/components/admin-sidebar"
import { ApprovalActions } from "@/components/approval-actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import Link from "next/link"
import { Clock, Users, Store, AlertTriangle, RefreshCw } from "lucide-react"
import { PageShell } from "@/components/layout/page-shell"
import { PageHeader } from "@/components/layout/page-header"
import { StatCard } from "@/components/layout/stat-card"
import { SectionCard } from "@/components/layout/section-card"
import { ThemeToggle } from "@/components/ui/theme-toggle"

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

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch("/admin/session")
        if (!res.ok) {
          window.location.href = "/"
          return
        }
        setIsCheckingAuth(false)
      } catch (e) {
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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Checking authentication...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <AdminSidebar />

      <div className="lg:ml-64">
        <PageShell className="bg-transparent min-h-0">
          <PageHeader
            title="Admin Dashboard"
            description="Manage store registrations and user approvals"
            actions={
              <>
                <Link href="/">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.preventDefault()
                      window.location.href = "/"
                    }}
                  >
                    Back to Home
                  </Button>
                </Link>
                <Button onClick={handleRefresh} disabled={isRefreshing} variant="outline" size="sm">
                  <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
                <ThemeToggle />
              </>
            }
          />

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <StatCard
              title="Pending Approvals"
              value={counts.pending}
              helper="Awaiting review"
              icon={<Clock className="h-5 w-5" />}
              accent="warning"
            />
            <StatCard
              title="Active Stores"
              value={counts.approved}
              helper="Approved and active"
              icon={<Store className="h-5 w-5" />}
              accent="success"
            />
            <StatCard
              title="Total Users"
              value={counts.total}
              helper="All registered stores"
              icon={<Users className="h-5 w-5" />}
              accent="primary"
            />
          </div>

          <SectionCard
            className="mt-6"
            title="Pending Store Approvals"
            description="Review and approve new store registrations"
          >
            <div className="space-y-4">
              {visible.map((store) => (
                <div
                  key={store.id}
                  className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 transition hover:border-primary/30 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-semibold text-foreground">{store.storeId}</h3>
                      <Badge variant="warning">Pending</Badge>
                    </div>
                    <div className="text-sm text-muted-foreground mb-1">{store.email}</div>
                    <div className="text-xs text-muted-foreground">
                      Submitted: {new Date(store.createdAt).toLocaleDateString()}
                    </div>
                  </div>

                  <ApprovalActions storeId={store.storeId} email={store.email} onStatusChange={handleRefresh} />
                </div>
              ))}

              {visible.length === 0 && (
                <div className="text-center py-12">
                  <AlertTriangle className="h-12 w-12 text-success mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-foreground mb-2">All caught up!</h3>
                  <p className="text-muted-foreground">No pending store approvals at the moment.</p>
                </div>
              )}
            </div>
          </SectionCard>

          <SectionCard
            className="mt-6"
            title="Active Stores"
            description="Revoke access for previously approved stores"
          >
            <div className="space-y-4">
              {activeStores.map((store) => (
                <div
                  key={store.id}
                  className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 transition hover:border-primary/30 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="font-semibold text-foreground">{store.storeId}</h3>
                      <Badge variant="success">Approved</Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">{store.email}</div>
                  </div>
                  <Button variant="destructive" size="sm" onClick={() => revokeAccess(store.storeId, store.email)}>
                    Revoke Access
                  </Button>
                </div>
              ))}
              {activeStores.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">No active stores.</div>
              )}
            </div>
          </SectionCard>
        </PageShell>
      </div>
    </div>
  )
}
