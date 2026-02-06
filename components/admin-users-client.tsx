"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Store, Calendar, Mail, CheckCircle, Clock, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StatCard } from "@/components/layout/stat-card"
import { SectionCard } from "@/components/layout/section-card"

interface StoreUser {
  id: number
  store_id: string
  email: string
  status: "pending" | "approved" | "denied"
  created_at: string
}

export function AdminUsersClient({ stores }: { stores: StoreUser[] }) {
  const [allStores, setAllStores] = useState<StoreUser[]>(stores)

  const approvedStores = allStores.filter((s) => s.status === "approved")
  const pendingStores = allStores.filter((s) => s.status === "pending")
  const deniedStores = allStores.filter((s) => s.status === "denied")

  const revoke = async (store: StoreUser) => {
    const res = await fetch("/api/admin/approve-store", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId: store.store_id, email: store.email, action: "deny", reason: "Access revoked by admin" }),
    })
    if (res.ok) {
      setAllStores((prev) => prev.map((s) => (s.id === store.id ? { ...s, status: "denied" } : s)))
    }
  }

  return (
    <>
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          title="Total Stores"
          value={allStores.length}
          helper="All registrations"
          icon={<Store className="h-5 w-5" />}
          accent="primary"
        />
        <StatCard
          title="Approved"
          value={approvedStores.length}
          helper="Active stores"
          icon={<CheckCircle className="h-5 w-5" />}
          accent="success"
        />
        <StatCard
          title="Pending"
          value={pendingStores.length}
          helper="Awaiting approval"
          icon={<Clock className="h-5 w-5" />}
          accent="warning"
        />
        <StatCard
          title="Denied"
          value={deniedStores.length}
          helper="Rejected applications"
          icon={<XCircle className="h-5 w-5" />}
          accent="danger"
        />
      </div>

      <SectionCard
        className="mt-6"
        title="All Store Users"
        description="Complete list of registered stores and their approval status"
      >
        <div className="space-y-4">
          {allStores.map((store) => (
            <div
              key={store.id}
              className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 transition hover:border-primary/30 md:flex-row md:items-center"
            >
              <Avatar className="h-12 w-12 bg-primary/10 text-primary">
                <AvatarFallback className="font-medium">
                  {store.store_id.substring(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="font-semibold text-foreground">{store.store_id}</h3>
                  <Badge
                    variant={
                      store.status === "approved"
                        ? "success"
                        : store.status === "pending"
                          ? "warning"
                          : "destructive"
                    }
                  >
                    {store.status.charAt(0).toUpperCase() + store.status.slice(1)}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground mb-1 text-sm">
                  <Mail className="h-4 w-4" />
                  <span>{store.email}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                  <Calendar className="h-4 w-4" />
                  <span>Registered: {new Date(store.created_at).toLocaleDateString()}</span>
                </div>
              </div>

              <div className="text-right">
                <div className="text-sm font-medium text-foreground">Store ID</div>
                <div className="text-xs text-muted-foreground font-mono">{store.store_id}</div>
                {store.status === "approved" && (
                  <Button variant="destructive" size="sm" className="mt-2" onClick={() => revoke(store)}>
                    Revoke Access
                  </Button>
                )}
              </div>
            </div>
          ))}

          {allStores.length === 0 && (
            <div className="text-center py-12">
              <Store className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">No stores registered</h3>
              <p className="text-muted-foreground">Store registrations will appear here when users sign up.</p>
            </div>
          )}
        </div>
      </SectionCard>
    </>
  )
}
