"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { StoreSidebar } from "@/components/store-sidebar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ShoppingCart, CheckCircle, Clock, X, Download } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface Order {
  order_id: string
  customer_phone: string
  total_amount: number
  discount_amount: number
  final_amount: number
  payment_method: string
  payment_status: string
  order_status: string
  created_at: string
  paid_at: string | null
  approved_at: string | null
  items: OrderItem[]
}

interface OrderItem {
  product_name: string
  quantity: number
  unit_price: number
  total_price: number
}

export default function StoreOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const { toast } = useToast()
  const router = useRouter()

  useEffect(() => {
    fetchOrders()
  }, [])

  const fetchOrders = async () => {
    try {
      const response = await fetch("/api/store/orders")
      if (response.ok) {
        const data = await response.json()
        setOrders(data.orders || [])
      } else {
        if (response.status === 401) {
          // Redirect to home page instead of login after logout
          window.location.href = "/"
        }
      }
    } catch (error) {
      console.error("Error fetching orders:", error)
    } finally {
      setLoading(false)
    }
  }

  const approveOrder = async (orderId: string) => {
    try {
      const response = await fetch("/api/store/orders/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      })

      const data = await response.json()

      if (response.ok) {
        toast({
          title: "Order approved",
          description: "Payment has been confirmed and customer has been notified.",
        })
        fetchOrders()
      } else {
        toast({
          title: "Error",
          description: data.error || "Could not approve order.",
          variant: "destructive",
        })
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Could not approve order. Please try again.",
        variant: "destructive",
      })
    }
  }

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      confirmed: "default",
      pending: "secondary",
      cancelled: "destructive",
    }

    return (
      <Badge variant={variants[status] || "outline"} className="capitalize">
        {status}
      </Badge>
    )
  }

  const getPaymentStatusBadge = (status: string) => {
    if (status === "completed") {
      return (
        <Badge className="bg-green-500 hover:bg-green-600">
          <CheckCircle className="w-3 h-3 mr-1" />
          Paid
        </Badge>
      )
    }
    return (
      <Badge variant="secondary" className="bg-yellow-500 hover:bg-yellow-600">
        <Clock className="w-3 h-3 mr-1" />
        Pending
      </Badge>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <StoreSidebar />
        <div className="lg:ml-64 p-8">
          <div className="text-center">Loading orders...</div>
        </div>
      </div>
    )
  }

  const pendingOrders = orders.filter(
    (order) => order.payment_method === "pay_at_desk" && order.payment_status === "pending"
  )
  const completedOrders = orders.filter((order) => order.payment_status === "completed")

  return (
    <div className="min-h-screen bg-slate-50">
      <StoreSidebar />
      <div className="lg:ml-64">
        <div className="p-6 lg:p-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Orders</h1>
            <p className="text-slate-600">Manage customer orders and payments</p>
          </div>

          {/* Pending Pay at Desk Orders */}
          {pendingOrders.length > 0 && (
            <div className="mb-8">
              <h2 className="text-xl font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Clock className="w-5 h-5 text-yellow-600" />
                Pending Payments ({pendingOrders.length})
              </h2>
              <div className="space-y-4">
                {pendingOrders.map((order) => (
                  <Card key={order.order_id} className="border-yellow-200 bg-yellow-50/50">
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-lg">Order {order.order_id}</CardTitle>
                          <CardDescription className="mt-1">
                            Phone: {order.customer_phone} |{" "}
                            {new Date(order.created_at).toLocaleString()}
                          </CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                          {getPaymentStatusBadge(order.payment_status)}
                          {getStatusBadge(order.order_status)}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="mb-4">
                        <h4 className="font-semibold text-slate-900 mb-2">Items:</h4>
                        <div className="space-y-1">
                          {order.items?.map((item, idx) => (
                            <div key={idx} className="flex justify-between text-sm text-slate-600">
                              <span>
                                {item.product_name} x {item.quantity}
                              </span>
                              <span>₹{item.total_price.toFixed(2)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-4 border-t">
                        <div>
                          <p className="text-sm text-slate-600">Total Amount</p>
                          <p className="text-2xl font-bold text-slate-900">
                            ₹{order.final_amount.toFixed(2)}
                          </p>
                        </div>
                        <Button
                          onClick={() => approveOrder(order.order_id)}
                          className="bg-green-600 hover:bg-green-700"
                        >
                          <CheckCircle className="w-4 h-4 mr-2" />
                          Approve Payment
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Completed Orders */}
          <div>
            <h2 className="text-xl font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-green-600" />
              All Orders ({orders.length})
            </h2>
            <div className="space-y-4">
              {orders.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <ShoppingCart className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                    <p className="text-slate-600">No orders yet</p>
                  </CardContent>
                </Card>
              ) : (
                orders.map((order) => (
                  <Card key={order.order_id}>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-lg">Order {order.order_id}</CardTitle>
                          <CardDescription className="mt-1">
                            Phone: {order.customer_phone} |{" "}
                            {new Date(order.created_at).toLocaleString()}
                          </CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                          {getPaymentStatusBadge(order.payment_status)}
                          {getStatusBadge(order.order_status)}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="mb-4">
                        <h4 className="font-semibold text-slate-900 mb-2">Items:</h4>
                        <div className="space-y-1">
                          {order.items?.map((item, idx) => (
                            <div key={idx} className="flex justify-between text-sm text-slate-600">
                              <span>
                                {item.product_name} x {item.quantity}
                              </span>
                              <span>₹{item.total_price.toFixed(2)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-4 border-t">
                        <div>
                          <p className="text-sm text-slate-600">Total Amount</p>
                          <p className="text-2xl font-bold text-slate-900">
                            ₹{order.final_amount.toFixed(2)}
                          </p>
                          <p className="text-xs text-slate-500 mt-1">
                            Payment: {order.payment_method.replace(/_/g, " ").toUpperCase()}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          onClick={() => window.open(`/api/customer/bill/${order.order_id}`, "_blank")}
                          className="bg-blue-600 text-white border-blue-600 hover:bg-blue-700 hover:text-white"
                        >
                          <Download className="w-4 h-4 mr-2" />
                          View Bill
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

