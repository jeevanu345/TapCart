"use client"

import { useEffect, useMemo, useState } from "react"
import { StoreSidebar } from "@/components/store-sidebar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Package2, Search, Filter, IndianRupee, TrendingUp, BarChart3, CheckCircle2, XCircle } from "lucide-react"

interface ProductItem {
  id: number
  custom_id?: string
  name: string
  category: string
  price: number
  stock: number
}

export default function AllProductsPage() {
  const [items, setItems] = useState<ProductItem[]>([])
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState<string>("all")
  const [activeTab, setActiveTab] = useState<"in-stock" | "sold">("in-stock")

  const load = async () => {
    try {
      const res = await fetch("/api/store/products")
      if (!res.ok) {
        if (res.status === 401) {
          // Redirect to home page instead of login after logout
          window.location.href = "/"
          return
        }
        console.error("Failed to load products:", res.status)
        return
      }
      const data = await res.json()
      setItems(data.items || [])
    } catch (error) {
      console.error("Error loading products:", error)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const categories = useMemo(() => {
    const s = new Set(items.map((i) => i.category || "General"))
    return ["all", ...Array.from(s)]
  }, [items])

  const filtered = useMemo(() => {
    return items
      .filter((i) => (category === "all" ? true : i.category === category))
      .filter((i) => i.name.toLowerCase().includes(search.toLowerCase()) || String(i.id).includes(search) || (i.custom_id && i.custom_id.toLowerCase().includes(search.toLowerCase())))
  }, [items, search, category])

  // Separate in-stock and sold products
  const inStockProducts = useMemo(() => {
    return filtered.filter((i) => i.stock > 0)
  }, [filtered])

  const soldProducts = useMemo(() => {
    return filtered.filter((i) => i.stock === 0)
  }, [filtered])

  const categoryTotals = useMemo(() => {
    const map = new Map<string, { items: number; stock: number }>()
    for (const i of filtered) {
      const key = i.category || "General"
      const cur = map.get(key) || { items: 0, stock: 0 }
      cur.items += 1
      cur.stock += Number(i.stock || 0)
      map.set(key, cur)
    }
    return Array.from(map.entries()).map(([category, v]) => ({ category, ...v }))
  }, [filtered])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
      <StoreSidebar />
      <div className="lg:ml-64">
        <div className="p-6 lg:p-8">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent mb-2">
                  All Products
                </h1>
                <p className="text-slate-600 font-medium">Search, filter by category, and manage your product inventory</p>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="text-sm font-semibold px-3 py-1.5 bg-white border-slate-300 text-slate-700">
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
                  {inStockProducts.length} in stock
                </Badge>
                <Badge variant="outline" className="text-sm font-semibold px-3 py-1.5 bg-white border-slate-300 text-slate-700">
                  <XCircle className="w-3.5 h-3.5 mr-1.5 text-orange-600" />
                  {soldProducts.length} sold
                </Badge>
              </div>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <Card className="border border-slate-200 shadow-md hover:shadow-lg transition-shadow bg-gradient-to-br from-blue-50 via-white to-blue-50/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-semibold text-slate-700">Total Products</CardTitle>
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Package2 className="h-4 w-4 text-blue-600" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-slate-900">{items.length}</div>
                <p className="text-xs text-slate-600 mt-1 font-medium">All products</p>
              </CardContent>
            </Card>

            <Card className="border border-slate-200 shadow-md hover:shadow-lg transition-shadow bg-gradient-to-br from-emerald-50 via-white to-emerald-50/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-semibold text-slate-700">In Stock</CardTitle>
                <div className="p-2 bg-emerald-100 rounded-lg">
                  <TrendingUp className="h-4 w-4 text-emerald-600" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-slate-900">{inStockProducts.length}</div>
                <p className="text-xs text-slate-600 mt-1 font-medium">Available products</p>
              </CardContent>
            </Card>

            <Card className="border border-slate-200 shadow-md hover:shadow-lg transition-shadow bg-gradient-to-br from-orange-50 via-white to-orange-50/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-semibold text-slate-700">Sold</CardTitle>
                <div className="p-2 bg-orange-100 rounded-lg">
                  <Package2 className="h-4 w-4 text-orange-600" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-slate-900">{soldProducts.length}</div>
                <p className="text-xs text-slate-600 mt-1 font-medium">Sold out products</p>
              </CardContent>
            </Card>

            <Card className="border border-slate-200 shadow-md hover:shadow-lg transition-shadow bg-gradient-to-br from-purple-50 via-white to-purple-50/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-semibold text-slate-700">Total Value</CardTitle>
                <div className="p-2 bg-purple-100 rounded-lg">
                  <IndianRupee className="h-4 w-4 text-purple-600" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-slate-900">
                  ₹{inStockProducts.reduce((sum, item) => sum + (item.price * item.stock), 0).toFixed(2)}
                </div>
                <p className="text-xs text-slate-600 mt-1 font-medium">Inventory worth</p>
              </CardContent>
            </Card>
          </div>

          {/* Search and Filter */}
          <Card className="border border-slate-200 shadow-md mb-6 bg-white">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-bold text-slate-900">Search & Filter</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-500 w-5 h-5" />
                  <Input 
                    placeholder="Search by item name or ID" 
                    value={search} 
                    onChange={(e) => setSearch(e.target.value)} 
                    className="pl-10 h-11 border-slate-300 focus:border-blue-500 focus:ring-blue-500" 
                  />
                </div>
                <div>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger className="h-11 border-slate-300 focus:border-blue-500 focus:ring-blue-500">
                      <Filter className="w-4 h-4 mr-2 text-slate-500" />
                      <SelectValue placeholder="Filter by category" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c === "all" ? "All Categories" : c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs font-semibold px-3 py-1.5 bg-slate-100 border-slate-300 text-slate-700">
                    Showing {activeTab === "in-stock" ? inStockProducts.length : soldProducts.length} of {activeTab === "in-stock" ? inStockProducts.length : soldProducts.length} {activeTab === "in-stock" ? "in-stock" : "sold"} items
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Products Tabs */}
          <Card className="border border-slate-200 shadow-md bg-white">
            <CardHeader>
              <CardTitle className="text-xl font-bold text-slate-900">Product Catalog</CardTitle>
              <CardDescription>Switch between in-stock and sold products</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "in-stock" | "sold")}>
                <TabsList className="grid w-full max-w-md grid-cols-2 bg-slate-100 p-1.5 mb-6">
                  <TabsTrigger 
                    value="in-stock" 
                    className="data-[state=active]:bg-white data-[state=active]:text-black text-slate-600 hover:text-black data-[state=active]:shadow-sm font-semibold transition-colors"
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    In Stock ({inStockProducts.length})
                  </TabsTrigger>
                  <TabsTrigger 
                    value="sold"
                    className="data-[state=active]:bg-white data-[state=active]:text-black text-slate-600 hover:text-black data-[state=active]:shadow-sm font-semibold transition-colors"
                  >
                    <XCircle className="w-4 h-4 mr-2" />
                    Sold ({soldProducts.length})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="in-stock" className="mt-0">
                  <div className="space-y-3">
                    {inStockProducts.map((p) => (
                      <div key={p.id} className="flex items-center justify-between p-5 rounded-xl border-2 border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-all shadow-sm bg-white">
                        <div className="flex-1">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-500 rounded-xl flex items-center justify-center shadow-md">
                              <Package2 className="w-6 h-6 text-white" />
                            </div>
                            <div>
                              <h3 className="font-semibold text-slate-900 text-lg">{p.name}</h3>
                              <p className="text-sm text-slate-500 font-medium">#{p.custom_id || 'No ID'}</p>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-8">
                          <div className="text-center">
                            <Badge variant="secondary" className="text-xs mb-2 px-3 py-1 bg-blue-100 text-blue-700 border-blue-200 font-semibold">
                              {p.category}
                            </Badge>
                            <div className="text-xs text-slate-600 font-medium">Category</div>
                          </div>
                          <div className="text-center">
                            <div className="text-slate-900 font-bold text-lg">₹{p.price.toFixed(2)}</div>
                            <div className="text-xs text-slate-600 font-medium">Price</div>
                          </div>
                          <div className="text-center">
                            <div className="text-slate-900 font-bold text-lg">{p.stock}</div>
                            <div className="text-xs text-slate-600 font-medium">Stock</div>
                          </div>
                          <div className="text-center">
                            <div className="text-slate-900 font-bold text-lg">₹{(p.price * p.stock).toFixed(2)}</div>
                            <div className="text-xs text-slate-600 font-medium">Value</div>
                          </div>
                        </div>
                      </div>
                    ))}
                    {inStockProducts.length === 0 && (
                      <div className="text-center py-16 bg-slate-50 rounded-xl border-2 border-dashed border-slate-300">
                        <Package2 className="mx-auto h-16 w-16 text-slate-400 mb-4" />
                        <h3 className="text-xl font-semibold text-slate-900 mb-2">No in-stock products</h3>
                        <p className="text-slate-600">
                          {items.length === 0 
                            ? "No products available in your inventory."
                            : "All products have been sold."
                          }
                        </p>
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="sold" className="mt-0">
                  <div className="space-y-3">
                    {soldProducts.map((p) => (
                      <div key={p.id} className="flex items-center justify-between p-5 rounded-xl border-2 border-slate-200 bg-slate-50/80 hover:bg-slate-100/80 transition-all shadow-sm">
                        <div className="flex-1">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-gradient-to-br from-gray-400 to-gray-500 rounded-xl flex items-center justify-center shadow-md opacity-70">
                              <Package2 className="w-6 h-6 text-white" />
                            </div>
                            <div>
                              <h3 className="font-semibold text-slate-600 text-lg line-through">{p.name}</h3>
                              <p className="text-sm text-slate-500 font-medium">#{p.custom_id || 'No ID'}</p>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-8">
                          <div className="text-center">
                            <Badge variant="outline" className="text-xs mb-2 px-3 py-1 bg-slate-200 text-slate-700 border-slate-300 font-semibold">
                              {p.category}
                            </Badge>
                            <div className="text-xs text-slate-600 font-medium">Category</div>
                          </div>
                          <div className="text-center">
                            <div className="text-slate-600 font-bold text-lg">₹{p.price.toFixed(2)}</div>
                            <div className="text-xs text-slate-600 font-medium">Price</div>
                          </div>
                          <div className="text-center">
                            <Badge variant="destructive" className="text-xs px-3 py-1 font-semibold">
                              Sold Out
                            </Badge>
                            <div className="text-xs text-slate-600 font-medium mt-2">Stock: 0</div>
                          </div>
                          <div className="text-center">
                            <div className="text-slate-400 font-bold text-lg">—</div>
                            <div className="text-xs text-slate-600 font-medium">Value</div>
                          </div>
                        </div>
                      </div>
                    ))}
                    {soldProducts.length === 0 && (
                      <div className="text-center py-16 bg-slate-50 rounded-xl border-2 border-dashed border-slate-300">
                        <Package2 className="mx-auto h-16 w-16 text-slate-400 mb-4" />
                        <h3 className="text-xl font-semibold text-slate-900 mb-2">No sold products</h3>
                        <p className="text-slate-600">
                          All products are currently in stock.
                        </p>
                      </div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
