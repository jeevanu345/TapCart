import { redirect } from "next/navigation"
import { getAdminSession } from "@/lib/auth"
import { getAllStores } from "@/lib/db"
import { AdminSidebar } from "@/components/admin-sidebar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Store } from "lucide-react"
import { AdminUsersClient } from "@/components/admin-users-client"

export default async function AdminUsersPage() {
  const session = await getAdminSession()

  if (!session?.isAuthenticated) {
    redirect("/")
  }

  const stores = await getAllStores()

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminSidebar />

      <div className="lg:ml-64">
        <div className="p-6 lg:p-8">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Store Users</h1>
            <p className="text-slate-600">Manage all registered store accounts and their status</p>
          </div>
          <AdminUsersClient stores={stores} />
        </div>
      </div>
    </div>
  )
}
