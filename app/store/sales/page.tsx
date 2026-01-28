"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { StoreSidebar } from "@/components/store-sidebar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Search, Download, TrendingUp, DollarSign, CreditCard, Smartphone, Receipt, Phone, Calendar, User } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

interface Sale {
  order_id: string
  customer_phone: string
  customer_name: string | null
  total_amount: number
  discount_amount: number
  final_amount: number
  coupon_code: string | null
  payment_method: string
  payment_status: string
  order_status: string
  created_at: string
  paid_at: string | null
  approved_at: string | null
  items: SaleItem[]
}

interface SaleItem {
  product_name: string
  quantity: number
  unit_price: number
  total_price: number
}

export default function StoreSalesPage() {
  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const router = useRouter()

  useEffect(() => {
    fetchSales()
  }, [])

  const fetchSales = async () => {
    try {
      const response = await fetch("/api/store/orders")
      if (response.ok) {
        const data = await response.json()
        // Filter only completed sales
        const completedSales = (data.orders || []).filter(
          (order: Sale) => order.payment_status === "completed"
        )
        setSales(completedSales)
      } else {
        if (response.status === 401) {
          // Redirect to home page instead of login after logout
          window.location.href = "/"
        }
      }
    } catch (error) {
      console.error("Error fetching sales:", error)
    } finally {
      setLoading(false)
    }
  }

  // Filter sales based on search term
  const filteredSales = sales.filter((sale) => {
    const searchLower = searchTerm.toLowerCase()
    return (
      sale.order_id.toLowerCase().includes(searchLower) ||
      sale.customer_phone.toLowerCase().includes(searchLower) ||
      (sale.customer_name && sale.customer_name.toLowerCase().includes(searchLower)) ||
      sale.payment_method.toLowerCase().includes(searchLower)
    )
  })

  // Calculate statistics
  const totalSales = sales.length
  const totalRevenue = sales.reduce((sum, sale) => sum + parseFloat(sale.final_amount.toString()), 0)
  const totalDiscounts = sales.reduce((sum, sale) => sum + parseFloat((sale.discount_amount || 0).toString()), 0)
  
  // Payment method breakdown
  const paymentMethods = sales.reduce((acc, sale) => {
    const method = sale.payment_method.replace(/_/g, " ").toUpperCase()
    acc[method] = (acc[method] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  const getPaymentMethodIcon = (method: string) => {
    if (method.includes("CARD")) return <CreditCard className="w-4 h-4" />
    if (method.includes("UPI")) return <Smartphone className="w-4 h-4" />
    return <Receipt className="w-4 h-4" />
  }

  const getPaymentMethodBadge = (method: string) => {
    const formattedMethod = method.replace(/_/g, " ").toUpperCase()
    const colors: Record<string, string> = {
      CARD: "bg-blue-100 text-blue-700 border-blue-200",
      UPI: "bg-purple-100 text-purple-700 border-purple-200",
      "PAY AT DESK": "bg-orange-100 text-orange-700 border-orange-200",
    }
    const colorClass = colors[formattedMethod] || "bg-slate-100 text-slate-700 border-slate-200"

    return (
      <Badge variant="outline" className={`${colorClass} flex items-center gap-1`}>
        {getPaymentMethodIcon(method)}
        <span>{formattedMethod}</span>
      </Badge>
    )
  }

  const exportToCSV = () => {
    const headers = [
      "Order ID",
      "Customer Phone",
      "Customer Name",
      "Payment Method",
      "Total Amount",
      "Discount",
      "Final Amount",
      "Coupon Code",
      "Date",
      "Items",
    ]

    const rows = filteredSales.map((sale) => [
      sale.order_id,
      sale.customer_phone,
      sale.customer_name || "N/A",
      sale.payment_method.replace(/_/g, " ").toUpperCase(),
      sale.total_amount.toString(),
      sale.discount_amount.toString(),
      sale.final_amount.toString(),
      sale.coupon_code || "N/A",
      new Date(sale.created_at).toLocaleString(),
      sale.items.map((item) => `${item.product_name} x${item.quantity}`).join("; "),
    ])

    const csvContent = [headers, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n")
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const link = document.createElement("a")
    const url = URL.createObjectURL(blob)
    link.setAttribute("href", url)
    link.setAttribute("download", `sales-report-${new Date().toISOString().split("T")[0]}.csv`)
    link.style.visibility = "hidden"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <StoreSidebar />
        <div className="lg:ml-64 p-8">
          <div className="text-center">Loading sales data...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
      <StoreSidebar />
      <div className="lg:ml-64">
        <div className="p-6 lg:p-8">
          {/* Header */}
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent mb-2">
                Sales
              </h1>
              <p className="text-slate-600 font-medium">View all completed sales and customer payment details</p>
            </div>
            <Button onClick={exportToCSV} className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 shadow-lg shadow-blue-500/30 font-semibold">
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
          </div>

          {/* Statistics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <Card className="border border-slate-200 shadow-md hover:shadow-lg transition-shadow bg-gradient-to-br from-blue-50 via-white to-blue-50/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-semibold text-slate-700">Total Sales</CardTitle>
                <div className="p-2 bg-blue-100 rounded-lg">
                  <TrendingUp className="h-4 w-4 text-blue-600" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-slate-900">{totalSales}</div>
                <p className="text-xs text-slate-600 mt-1 font-medium">Completed transactions</p>
              </CardContent>
            </Card>

            <Card className="border border-slate-200 shadow-md hover:shadow-lg transition-shadow bg-gradient-to-br from-green-50 via-white to-green-50/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-semibold text-slate-700">Total Revenue</CardTitle>
                <div className="p-2 bg-green-100 rounded-lg">
                  <DollarSign className="h-4 w-4 text-green-600" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-slate-900">₹{totalRevenue.toFixed(2)}</div>
                <p className="text-xs text-slate-600 mt-1 font-medium">Total earnings</p>
              </CardContent>
            </Card>

            <Card className="border border-slate-200 shadow-md hover:shadow-lg transition-shadow bg-gradient-to-br from-orange-50 via-white to-orange-50/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-semibold text-slate-700">Total Discounts</CardTitle>
                <div className="p-2 bg-orange-100 rounded-lg">
                  <Receipt className="h-4 w-4 text-orange-600" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-slate-900">₹{totalDiscounts.toFixed(2)}</div>
                <p className="text-xs text-slate-600 mt-1 font-medium">Discounts given</p>
              </CardContent>
            </Card>

            <Card className="border border-slate-200 shadow-md hover:shadow-lg transition-shadow bg-gradient-to-br from-purple-50 via-white to-purple-50/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-semibold text-slate-700">Average Order</CardTitle>
                <div className="p-2 bg-purple-100 rounded-lg">
                  <TrendingUp className="h-4 w-4 text-purple-600" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-slate-900">
                  ₹{totalSales > 0 ? (totalRevenue / totalSales).toFixed(2) : "0.00"}
                </div>
                <p className="text-xs text-slate-600 mt-1 font-medium">Per transaction</p>
              </CardContent>
            </Card>
          </div>

          {/* Payment Methods Breakdown */}
          <Card className="border border-slate-200 shadow-md mb-6 bg-white">
            <CardHeader>
              <CardTitle className="text-lg font-bold text-slate-900">Payment Methods</CardTitle>
              <CardDescription className="text-slate-600">Breakdown of payment methods used</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-4">
                {Object.entries(paymentMethods).map(([method, count]) => (
                  <div key={method} className="flex items-center gap-3 p-4 bg-gradient-to-br from-slate-50 to-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md transition-shadow">
                    <div className="p-2 bg-white rounded-lg">
                      {getPaymentMethodIcon(method.toLowerCase().replace(/\s/g, "_"))}
                    </div>
                    <span className="font-semibold text-slate-900 text-base">{method}</span>
                    <Badge variant="outline" className="ml-2 px-3 py-1 bg-blue-100 text-blue-700 border-blue-300 font-semibold">
                      {count} {count === 1 ? "sale" : "sales"}
                    </Badge>
                  </div>
                ))}
                {Object.keys(paymentMethods).length === 0 && (
                  <p className="text-slate-600 font-medium">No payment data available</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Search */}
          <Card className="border border-slate-200 shadow-md mb-6 bg-white">
            <CardHeader>
              <CardTitle className="text-lg font-bold text-slate-900">Sales Records</CardTitle>
              <CardDescription className="text-slate-600">Search and filter sales by order ID, customer phone, or payment method</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-500 w-5 h-5" />
                <Input
                  placeholder="Search by order ID, customer phone, name, or payment method..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 h-11 border-slate-300 focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
            </CardContent>
          </Card>

          {/* Sales Table */}
          <Card className="border border-slate-200 shadow-md bg-white">
            <CardHeader>
              <CardTitle className="text-xl font-bold text-slate-900">
                All Sales ({filteredSales.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {filteredSales.length === 0 ? (
                <div className="text-center py-12">
                  <TrendingUp className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-slate-900 mb-2">No sales found</h3>
                  <p className="text-slate-500">
                    {searchTerm ? "Try adjusting your search criteria." : "Sales will appear here once customers complete their purchases."}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50">
                        <TableHead className="text-slate-900 font-semibold">Order ID</TableHead>
                        <TableHead className="text-slate-900 font-semibold">Customer Details</TableHead>
                        <TableHead className="text-slate-900 font-semibold">Payment Method</TableHead>
                        <TableHead className="text-slate-900 font-semibold">Items</TableHead>
                        <TableHead className="text-slate-900 font-semibold">Amount</TableHead>
                        <TableHead className="text-slate-900 font-semibold">Discount</TableHead>
                        <TableHead className="text-slate-900 font-semibold">Final Amount</TableHead>
                        <TableHead className="text-slate-900 font-semibold">Date</TableHead>
                        <TableHead className="text-slate-900 font-semibold">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredSales.map((sale) => (
                        <TableRow key={sale.order_id} className="hover:bg-slate-50">
                          <TableCell className="font-medium text-slate-900">{sale.order_id}</TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <Phone className="w-3 h-3 text-slate-500" />
                                <span className="text-sm text-slate-900 font-medium">{sale.customer_phone}</span>
                              </div>
                              {sale.customer_name && (
                                <div className="flex items-center gap-2">
                                  <User className="w-3 h-3 text-slate-500" />
                                  <span className="text-sm text-slate-700">{sale.customer_name}</span>
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{getPaymentMethodBadge(sale.payment_method)}</TableCell>
                          <TableCell>
                            <div className="max-w-xs">
                              <div className="text-sm space-y-1">
                                {sale.items.map((item, idx) => (
                                  <div key={idx} className="text-slate-900">
                                    {item.product_name} × {item.quantity}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="font-medium text-slate-900">₹{parseFloat(sale.total_amount.toString()).toFixed(2)}</TableCell>
                          <TableCell>
                            {sale.discount_amount > 0 ? (
                              <span className="text-green-600 font-medium">
                                -₹{parseFloat(sale.discount_amount.toString()).toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                            {sale.coupon_code && (
                              <div className="text-xs text-slate-600 mt-1">({sale.coupon_code})</div>
                            )}
                          </TableCell>
                          <TableCell className="font-bold text-green-600">
                            ₹{parseFloat(sale.final_amount.toString()).toFixed(2)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2 text-sm text-slate-900">
                              <Calendar className="w-3 h-3 text-slate-600" />
                              <span>{new Date(sale.created_at).toLocaleDateString()}</span>
                            </div>
                            <div className="text-xs text-slate-600 mt-1">
                              {new Date(sale.created_at).toLocaleTimeString()}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => window.open(`/api/customer/bill/${sale.order_id}`, "_blank")}
                              className="bg-blue-600 text-white border-blue-600 hover:bg-blue-700 hover:text-white"
                            >
                              <Download className="w-3 h-3 mr-1" />
                              Bill
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

