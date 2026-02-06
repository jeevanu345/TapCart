import { redirect } from "next/navigation"
import { getAdminSession } from "@/lib/auth"
import { getAllStores } from "@/lib/db"
import { AdminSidebar } from "@/components/admin-sidebar"
import { AdminUsersClient } from "@/components/admin-users-client"
import { PageShell } from "@/components/layout/page-shell"
import { PageHeader } from "@/components/layout/page-header"

export default async function AdminUsersPage() {
  const session = await getAdminSession()

  if (!session?.isAuthenticated) {
    redirect("/")
  }

  const stores = await getAllStores()

  return (
    <div className="min-h-screen bg-background">
      <AdminSidebar />

      <div className="lg:ml-64">
        <PageShell className="bg-transparent min-h-0">
          <PageHeader
            title="Store Users"
            description="Manage all registered store accounts and their status"
          />
          <div className="mt-6">
            <AdminUsersClient stores={stores} />
          </div>
        </PageShell>
      </div>
    </div>
  )
}
