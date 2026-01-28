import { redirect } from "next/navigation"
import { getStoreSession } from "@/lib/auth"
import { getCustomersByStoreId } from "@/lib/db"
import { StoreSidebar } from "@/components/store-sidebar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Phone, User, Calendar } from "lucide-react"

export default async function StoreCustomersPage() {
  const session = await getStoreSession()

  if (!session?.isAuthenticated) {
    redirect("/")
  }

  const customers = await getCustomersByStoreId(session.storeId)

  return (
    <div className="min-h-screen bg-slate-50">
      <StoreSidebar />

      <div className="lg:ml-64">
        <div className="p-6 lg:p-8">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Customer Directory</h1>
            <p className="text-slate-600">Manage your customer information and contacts</p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <Card className="border-0 shadow-sm bg-gradient-to-br from-blue-50 to-cyan-50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">Total Customers</CardTitle>
                <User className="h-4 w-4 text-blue-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-slate-900">{customers.length}</div>
                <p className="text-xs text-slate-500 mt-1">Registered customers</p>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm bg-gradient-to-br from-green-50 to-emerald-50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">Active This Month</CardTitle>
                <Calendar className="h-4 w-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-slate-900">{customers.length}</div>
                <p className="text-xs text-slate-500 mt-1">Recent activity</p>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm bg-gradient-to-br from-purple-50 to-pink-50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">Contact Rate</CardTitle>
                <Phone className="h-4 w-4 text-purple-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-slate-900">100%</div>
                <p className="text-xs text-slate-500 mt-1">Customers with phone numbers</p>
              </CardContent>
            </Card>
          </div>

          {/* Customers List */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-xl font-bold text-slate-900">Customer List</CardTitle>
              <CardDescription>View and manage your customer database</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {customers.map((customer) => (
                  <div
                    key={customer.id}
                    className="flex items-center gap-4 p-4 rounded-xl border border-slate-200 hover:border-slate-300 hover:shadow-sm transition-all duration-200"
                  >
                    <Avatar className="h-12 w-12 bg-gradient-to-br from-blue-500 to-cyan-500">
                      <AvatarFallback className="text-white font-medium">
                        {customer.name
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                          .toUpperCase()}
                      </AvatarFallback>
                    </Avatar>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <h3 className="font-semibold text-slate-900 truncate">{customer.name}</h3>
                        <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-full">
                          ID: {customer.id}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-600">
                        <Phone className="h-4 w-4" />
                        <span className="text-sm">{customer.phone}</span>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-sm font-medium text-slate-900">Customer</div>
                      <div className="text-xs text-slate-500">Active</div>
                    </div>
                  </div>
                ))}

                {customers.length === 0 && (
                  <div className="text-center py-12">
                    <User className="h-12 w-12 text-slate-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-slate-900 mb-2">No customers yet</h3>
                    <p className="text-slate-500">Customer information will appear here when purchases are made.</p>
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
