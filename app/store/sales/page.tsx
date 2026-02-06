"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { StoreSidebar } from "@/components/store-sidebar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Search, Download, TrendingUp, DollarSign, CreditCard, Smartphone, Receipt, Phone, Calendar, User } from "lucide-react"
import { PageShell } from "@/components/layout/page-shell"
import { PageHeader } from "@/components/layout/page-header"
import { StatCard } from "@/components/layout/stat-card"
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
    const colorClass = colors[formattedMethod] || "bg-surface-muted text-muted-foreground border-border"

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
      <div className="min-h-screen bg-background">
        <StoreSidebar />
        <div className="lg:ml-64">
          <PageShell className="bg-transparent min-h-0">
            <div className="text-center text-muted-foreground">Loading sales data...</div>
          </PageShell>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <StoreSidebar />
      <div className="lg:ml-64">
        <PageShell className="bg-transparent min-h-0">
          <PageHeader
            title="Sales"
            description="View all completed sales and customer payment details"
            actions={(
              <Button onClick={exportToCSV} variant="outline" size="sm">
                <Download className="w-4 h-4 mr-2" />
                Export CSV
              </Button>
            )}
          />

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-4">
            <StatCard
              title="Total Sales"
              value={totalSales}
              helper="Completed transactions"
              icon={<TrendingUp className="h-5 w-5" />}
              accent="primary"
            />
            <StatCard
              title="Total Revenue"
              value={`₹${totalRevenue.toFixed(2)}`}
              helper="Total earnings"
              icon={<DollarSign className="h-5 w-5" />}
              accent="success"
            />
            <StatCard
              title="Total Discounts"
              value={`₹${totalDiscounts.toFixed(2)}`}
              helper="Discounts given"
              icon={<Receipt className="h-5 w-5" />}
              accent="warning"
            />
            <StatCard
              title="Average Order"
              value={`₹${totalSales > 0 ? (totalRevenue / totalSales).toFixed(2) : "0.00"}`}
              helper="Per transaction"
              icon={<TrendingUp className="h-5 w-5" />}
              accent="primary"
            />
          </div>

          {/* Payment Methods Breakdown */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-lg font-semibold text-foreground">Payment Methods</CardTitle>
              <CardDescription className="text-muted-foreground">Breakdown of payment methods used</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-4">
                {Object.entries(paymentMethods).map(([method, count]) => (
                  <div key={method} className="flex items-center gap-3 p-4 bg-surface-muted border border-border rounded-xl">
                    <div className="p-2 bg-surface rounded-lg">
                      {getPaymentMethodIcon(method.toLowerCase().replace(/\s/g, "_"))}
                    </div>
                    <span className="font-semibold text-foreground text-base">{method}</span>
                    <Badge variant="secondary" className="ml-2 px-3 py-1 font-semibold">
                      {count} {count === 1 ? "sale" : "sales"}
                    </Badge>
                  </div>
                ))}
                {Object.keys(paymentMethods).length === 0 && (
                  <p className="text-muted-foreground font-medium">No payment data available</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Search */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-lg font-semibold text-foreground">Sales Records</CardTitle>
              <CardDescription className="text-muted-foreground">Search and filter sales by order ID, customer phone, or payment method</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-5 h-5" />
                <Input
                  placeholder="Search by order ID, customer phone, name, or payment method..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 h-11"
                />
              </div>
            </CardContent>
          </Card>

          {/* Sales Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold text-foreground">
                All Sales ({filteredSales.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {filteredSales.length === 0 ? (
                <div className="text-center py-12">
                  <TrendingUp className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-foreground mb-2">No sales found</h3>
                  <p className="text-muted-foreground">
                    {searchTerm ? "Try adjusting your search criteria." : "Sales will appear here once customers complete their purchases."}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-surface-muted">
                        <TableHead className="text-foreground font-semibold">Order ID</TableHead>
                        <TableHead className="text-foreground font-semibold">Customer Details</TableHead>
                        <TableHead className="text-foreground font-semibold">Payment Method</TableHead>
                        <TableHead className="text-foreground font-semibold">Items</TableHead>
                        <TableHead className="text-foreground font-semibold">Amount</TableHead>
                        <TableHead className="text-foreground font-semibold">Discount</TableHead>
                        <TableHead className="text-foreground font-semibold">Final Amount</TableHead>
                        <TableHead className="text-foreground font-semibold">Date</TableHead>
                        <TableHead className="text-foreground font-semibold">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredSales.map((sale) => (
                        <TableRow key={sale.order_id} className="hover:bg-surface-muted">
                          <TableCell className="font-medium text-foreground">{sale.order_id}</TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <Phone className="w-3 h-3 text-muted-foreground" />
                                <span className="text-sm text-foreground font-medium">{sale.customer_phone}</span>
                              </div>
                              {sale.customer_name && (
                                <div className="flex items-center gap-2">
                                  <User className="w-3 h-3 text-muted-foreground" />
                                  <span className="text-sm text-muted-foreground">{sale.customer_name}</span>
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{getPaymentMethodBadge(sale.payment_method)}</TableCell>
                          <TableCell>
                            <div className="max-w-xs">
                              <div className="text-sm space-y-1">
                                {sale.items.map((item, idx) => (
                                  <div key={idx} className="text-foreground">
                                    {item.product_name} × {item.quantity}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="font-medium text-foreground">₹{parseFloat(sale.total_amount.toString()).toFixed(2)}</TableCell>
                          <TableCell>
                            {sale.discount_amount > 0 ? (
                              <span className="text-green-600 font-medium">
                                -₹{parseFloat(sale.discount_amount.toString()).toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                            {sale.coupon_code && (
                              <div className="text-xs text-muted-foreground mt-1">({sale.coupon_code})</div>
                            )}
                          </TableCell>
                          <TableCell className="font-bold text-success">
                            ₹{parseFloat(sale.final_amount.toString()).toFixed(2)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2 text-sm text-foreground">
                              <Calendar className="w-3 h-3 text-muted-foreground" />
                              <span>{new Date(sale.created_at).toLocaleDateString()}</span>
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              {new Date(sale.created_at).toLocaleTimeString()}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => window.open(`/api/customer/bill/${sale.order_id}`, "_blank")}
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
        </PageShell>
      </div>
    </div>
  )
}
