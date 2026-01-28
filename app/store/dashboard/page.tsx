import { redirect } from "next/navigation"
import { getStoreSession } from "@/lib/auth"
import { getProductsByStoreId } from "@/lib/db"
import { StoreSidebar } from "@/components/store-sidebar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Package, TrendingUp, AlertTriangle, DollarSign } from "lucide-react"

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
    <div className="min-h-screen bg-slate-50">
      <StoreSidebar />

      <div className="lg:ml-64">
        <div className="p-6 lg:p-8">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Welcome back, {session.storeId}</h1>
            <p className="text-slate-600">Here&apos;s an overview of your store performance</p>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <Card className="border-0 shadow-sm bg-gradient-to-br from-blue-50 to-cyan-50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">Total Products</CardTitle>
                <Package className="h-4 w-4 text-blue-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-slate-900">{totalProducts}</div>
                <p className="text-xs text-slate-500 mt-1">Active products in inventory</p>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm bg-gradient-to-br from-green-50 to-emerald-50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">Total Stock</CardTitle>
                <TrendingUp className="h-4 w-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-slate-900">{totalStock}</div>
                <p className="text-xs text-slate-500 mt-1">Items in stock</p>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm bg-gradient-to-br from-orange-50 to-red-50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">Low Stock Alert</CardTitle>
                <AlertTriangle className="h-4 w-4 text-orange-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-slate-900">{lowStockProducts.length}</div>
                <p className="text-xs text-slate-500 mt-1">Products below 10 units</p>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm bg-gradient-to-br from-purple-50 to-pink-50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">Inventory Value</CardTitle>
                <DollarSign className="h-4 w-4 text-purple-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-slate-900">${totalValue.toFixed(2)}</div>
                <p className="text-xs text-slate-500 mt-1">Total inventory worth</p>
              </CardContent>
            </Card>
          </div>

          {/* Products Table */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-xl font-bold text-slate-900">Product Inventory</CardTitle>
              <CardDescription>Manage your product stock and pricing</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-3 px-4 font-medium text-slate-600">Product</th>
                      <th className="text-left py-3 px-4 font-medium text-slate-600">Stock</th>
                      <th className="text-left py-3 px-4 font-medium text-slate-600">Price</th>
                      <th className="text-left py-3 px-4 font-medium text-slate-600">Value</th>
                      <th className="text-left py-3 px-4 font-medium text-slate-600">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((product) => (
                      <tr key={product.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-4 px-4">
                          <div className="font-medium text-slate-900">{product.name}</div>
                        </td>
                        <td className="py-4 px-4">
                          <span className="text-slate-700">{product.stock} units</span>
                        </td>
                        <td className="py-4 px-4">
                          <span className="text-slate-700">${product.price.toFixed(2)}</span>
                        </td>
                        <td className="py-4 px-4">
                          <span className="font-medium text-slate-900">
                            ${(product.stock * product.price).toFixed(2)}
                          </span>
                        </td>
                        <td className="py-4 px-4">
                          <Badge
                            variant={product.stock < 10 ? "destructive" : product.stock < 25 ? "secondary" : "default"}
                            className={
                              product.stock < 10
                                ? "bg-red-100 text-red-700 hover:bg-red-100"
                                : product.stock < 25
                                  ? "bg-orange-100 text-orange-700 hover:bg-orange-100"
                                  : "bg-green-100 text-green-700 hover:bg-green-100"
                            }
                          >
                            {product.stock < 10 ? "Low Stock" : product.stock < 25 ? "Medium" : "In Stock"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
