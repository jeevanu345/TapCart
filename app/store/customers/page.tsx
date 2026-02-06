import { redirect } from "next/navigation"
import { getStoreSession } from "@/lib/auth"
import { getCustomersByStoreId } from "@/lib/db"
import { StoreSidebar } from "@/components/store-sidebar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Phone, User, Calendar } from "lucide-react"
import { PageShell } from "@/components/layout/page-shell"
import { PageHeader } from "@/components/layout/page-header"
import { StatCard } from "@/components/layout/stat-card"

export default async function StoreCustomersPage() {
  const session = await getStoreSession()

  if (!session?.isAuthenticated) {
    redirect("/")
  }

  const customers = await getCustomersByStoreId(session.storeId)

  return (
    <div className="min-h-screen bg-background">
      <StoreSidebar />

      <div className="lg:ml-64">
        <PageShell className="bg-transparent min-h-0">
          <PageHeader
            title="Customer Directory"
            description="Manage your customer information and contacts"
          />

          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard
              title="Total Customers"
              value={customers.length}
              helper="Registered customers"
              icon={<User className="h-5 w-5" />}
              accent="primary"
            />
            <StatCard
              title="Active This Month"
              value={customers.length}
              helper="Recent activity"
              icon={<Calendar className="h-5 w-5" />}
              accent="success"
            />
            <StatCard
              title="Contact Rate"
              value="100%"
              helper="Customers with phone numbers"
              icon={<Phone className="h-5 w-5" />}
              accent="primary"
            />
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Customer List</CardTitle>
              <CardDescription>View and manage your customer database</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {customers.map((customer) => (
                  <div
                    key={customer.id}
                    className="flex items-center gap-4 p-4 rounded-xl border border-border hover:border-primary/30 transition-all"
                  >
                    <Avatar className="h-12 w-12 bg-primary/10 text-primary">
                      <AvatarFallback className="font-medium">
                        {customer.name
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                          .toUpperCase()}
                      </AvatarFallback>
                    </Avatar>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <h3 className="font-semibold text-foreground truncate">{customer.name}</h3>
                        <span className="text-xs text-muted-foreground bg-surface-muted px-2 py-1 rounded-full">
                          ID: {customer.id}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Phone className="h-4 w-4" />
                        <span className="text-sm">{customer.phone}</span>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-sm font-medium text-foreground">Customer</div>
                      <div className="text-xs text-muted-foreground">Active</div>
                    </div>
                  </div>
                ))}

                {customers.length === 0 && (
                  <div className="text-center py-12">
                    <User className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-foreground mb-2">No customers yet</h3>
                    <p className="text-muted-foreground">Customer information will appear here when purchases are made.</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </PageShell>
      </div>
    </div>
  )
}
