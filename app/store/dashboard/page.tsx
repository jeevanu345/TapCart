import { redirect } from "next/navigation"
import { getStoreSession } from "@/lib/auth"
import { getProductsByStoreId } from "@/lib/db"
import { StoreSidebar } from "@/components/store-sidebar"
import { Badge } from "@/components/ui/badge"
import { Package, TrendingUp, AlertTriangle, DollarSign } from "lucide-react"
import { PageShell } from "@/components/layout/page-shell"
import { PageHeader } from "@/components/layout/page-header"
import { StatCard } from "@/components/layout/stat-card"
import { SectionCard } from "@/components/layout/section-card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ThemeToggle } from "@/components/ui/theme-toggle"

export default async function StoreDashboardPage() {
  const session = await getStoreSession()

  if (!session?.isAuthenticated) {
    redirect("/")
  }

  const products = await getProductsByStoreId(session.storeId)
  const totalProducts = products.length
  const totalStock = products.reduce((sum, product) => sum + product.stock, 0)
  const lowStockProducts = products.filter((product) => product.stock < 10)
  const totalValue = products.reduce((sum, product) => sum + product.stock * product.price, 0)

  return (
    <div className="min-h-screen bg-background">
      <StoreSidebar />

      <div className="lg:ml-64">
        <PageShell className="bg-transparent min-h-0">
          <PageHeader
            title={`Welcome back, ${session.storeId}`}
            description="Here’s an overview of your store performance"
            actions={<ThemeToggle />}
          />

          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Total Products"
              value={totalProducts}
              helper="Active products in inventory"
              icon={<Package className="h-5 w-5" />}
              accent="primary"
            />
            <StatCard
              title="Total Stock"
              value={totalStock}
              helper="Items in stock"
              icon={<TrendingUp className="h-5 w-5" />}
              accent="success"
            />
            <StatCard
              title="Low Stock Alert"
              value={lowStockProducts.length}
              helper="Products below 10 units"
              icon={<AlertTriangle className="h-5 w-5" />}
              accent="warning"
            />
            <StatCard
              title="Inventory Value"
              value={`$${totalValue.toFixed(2)}`}
              helper="Total inventory worth"
              icon={<DollarSign className="h-5 w-5" />}
              accent="primary"
            />
          </div>

          <SectionCard className="mt-6" title="Product Inventory" description="Manage your product stock and pricing">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell>
                      <div className="font-medium text-foreground">{product.name}</div>
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground">{product.stock} units</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground">${product.price.toFixed(2)}</span>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium text-foreground">
                        ${(product.stock * product.price).toFixed(2)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          product.stock < 10 ? "destructive" : product.stock < 25 ? "warning" : "success"
                        }
                      >
                        {product.stock < 10 ? "Low Stock" : product.stock < 25 ? "Medium" : "In Stock"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>
        </PageShell>
      </div>
    </div>
  )
}
