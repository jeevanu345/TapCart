import { redirect } from "next/navigation"
import { getStoreSession } from "@/lib/auth"
import { getPurchasesByStoreId } from "@/lib/db"
import { StoreSidebar } from "@/components/store-sidebar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ShoppingCart, DollarSign, TrendingUp, Calendar } from "lucide-react"

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
    <div className="min-h-screen bg-slate-50">
      <StoreSidebar />

      <div className="lg:ml-64">
        <div className="p-6 lg:p-8">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Purchase History</h1>
            <p className="text-slate-600">Track customer purchases and revenue analytics</p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <Card className="border-0 shadow-sm bg-gradient-to-br from-green-50 to-emerald-50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">Total Revenue</CardTitle>
                <DollarSign className="h-4 w-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-slate-900">${totalRevenue.toFixed(2)}</div>
                <p className="text-xs text-slate-500 mt-1">All-time sales</p>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm bg-gradient-to-br from-blue-50 to-cyan-50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">Total Orders</CardTitle>
                <ShoppingCart className="h-4 w-4 text-blue-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-slate-900">{totalOrders}</div>
                <p className="text-xs text-slate-500 mt-1">Completed purchases</p>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm bg-gradient-to-br from-purple-50 to-pink-50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">Average Order</CardTitle>
                <TrendingUp className="h-4 w-4 text-purple-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-slate-900">${averageOrderValue.toFixed(2)}</div>
                <p className="text-xs text-slate-500 mt-1">Per transaction</p>
              </CardContent>
            </Card>
          </div>

          {/* Purchases Table */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-xl font-bold text-slate-900">Recent Purchases</CardTitle>
              <CardDescription>View all customer transactions and order details</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-3 px-4 font-medium text-slate-600">Order ID</th>
                      <th className="text-left py-3 px-4 font-medium text-slate-600">Customer</th>
                      <th className="text-left py-3 px-4 font-medium text-slate-600">Product</th>
                      <th className="text-left py-3 px-4 font-medium text-slate-600">Quantity</th>
                      <th className="text-left py-3 px-4 font-medium text-slate-600">Amount</th>
                      <th className="text-left py-3 px-4 font-medium text-slate-600">Date</th>
                      <th className="text-left py-3 px-4 font-medium text-slate-600">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchases.map((purchase) => (
                      <tr key={purchase.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-4 px-4">
                          <span className="font-mono text-sm text-slate-600">
                            #{purchase.id.toString().padStart(4, "0")}
                          </span>
                        </td>
                        <td className="py-4 px-4">
                          <div className="font-medium text-slate-900">{purchase.customer_name}</div>
                        </td>
                        <td className="py-4 px-4">
                          <span className="text-slate-700">{purchase.product_name}</span>
                        </td>
                        <td className="py-4 px-4">
                          <span className="text-slate-700">{purchase.quantity}x</span>
                        </td>
                        <td className="py-4 px-4">
                          <span className="font-semibold text-slate-900">${purchase.total_amount.toFixed(2)}</span>
                        </td>
                        <td className="py-4 px-4">
                          <div className="flex items-center gap-2 text-slate-600">
                            <Calendar className="h-4 w-4" />
                            <span className="text-sm">{new Date(purchase.purchase_date).toLocaleDateString()}</span>
                          </div>
                        </td>
                        <td className="py-4 px-4">
                          <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Completed</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {purchases.length === 0 && (
                  <div className="text-center py-12">
                    <ShoppingCart className="h-12 w-12 text-slate-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-slate-900 mb-2">No purchases yet</h3>
                    <p className="text-slate-500">Customer purchases will appear here once orders are placed.</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
