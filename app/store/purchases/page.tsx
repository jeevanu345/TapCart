import { redirect } from "next/navigation"
import { getStoreSession } from "@/lib/auth"
import { getPurchasesByStoreId } from "@/lib/db"
import { StoreSidebar } from "@/components/store-sidebar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ShoppingCart, DollarSign, TrendingUp, Calendar } from "lucide-react"
import { PageShell } from "@/components/layout/page-shell"
import { PageHeader } from "@/components/layout/page-header"
import { StatCard } from "@/components/layout/stat-card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export default async function StorePurchasesPage() {
  const session = await getStoreSession()

  if (!session?.isAuthenticated) {
    redirect("/")
  }

  const purchases = await getPurchasesByStoreId(session.storeId)
  const totalRevenue = purchases.reduce((sum, purchase) => sum + purchase.total_amount, 0)
  const totalOrders = purchases.length
  const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0

  return (
    <div className="min-h-screen bg-background">
      <StoreSidebar />

      <div className="lg:ml-64">
        <PageShell className="bg-transparent min-h-0">
          <PageHeader
            title="Purchase History"
            description="Track customer purchases and revenue analytics"
          />

          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard
              title="Total Revenue"
              value={`$${totalRevenue.toFixed(2)}`}
              helper="All-time sales"
              icon={<DollarSign className="h-5 w-5" />}
              accent="success"
            />
            <StatCard
              title="Total Orders"
              value={totalOrders}
              helper="Completed purchases"
              icon={<ShoppingCart className="h-5 w-5" />}
              accent="primary"
            />
            <StatCard
              title="Average Order"
              value={`$${averageOrderValue.toFixed(2)}`}
              helper="Per transaction"
              icon={<TrendingUp className="h-5 w-5" />}
              accent="primary"
            />
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Recent Purchases</CardTitle>
              <CardDescription>View all customer transactions and order details</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Quantity</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchases.map((purchase) => (
                    <TableRow key={purchase.id}>
                      <TableCell>
                        <span className="font-mono text-sm text-muted-foreground">
                          #{purchase.id.toString().padStart(4, "0")}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-foreground">{purchase.customer_name}</div>
                      </TableCell>
                      <TableCell>
                        <span className="text-muted-foreground">{purchase.product_name}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-muted-foreground">{purchase.quantity}x</span>
                      </TableCell>
                      <TableCell>
                        <span className="font-semibold text-foreground">${purchase.total_amount.toFixed(2)}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Calendar className="h-4 w-4" />
                          <span className="text-sm">{new Date(purchase.purchase_date).toLocaleDateString()}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="success">Completed</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {purchases.length === 0 && (
                <div className="text-center py-12">
                  <ShoppingCart className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-foreground mb-2">No purchases yet</h3>
                  <p className="text-muted-foreground">Customer purchases will appear here once orders are placed.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </PageShell>
      </div>
    </div>
  )
}
