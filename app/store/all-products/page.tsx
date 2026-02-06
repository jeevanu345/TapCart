"use client"

import { useEffect, useMemo, useState } from "react"
import { StoreSidebar } from "@/components/store-sidebar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Package2, Search, Filter, IndianRupee, TrendingUp, BarChart3, CheckCircle2, XCircle } from "lucide-react"
import { PageShell } from "@/components/layout/page-shell"
import { PageHeader } from "@/components/layout/page-header"
import { StatCard } from "@/components/layout/stat-card"

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
    <div className="min-h-screen bg-background">
      <StoreSidebar />
      <div className="lg:ml-64">
        <PageShell className="bg-transparent min-h-0">
          <PageHeader
            title="All Products"
            description="Search, filter by category, and manage your product inventory"
            actions={(
              <div className="flex items-center gap-2">
                <Badge variant="success" className="text-xs">
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                  {inStockProducts.length} in stock
                </Badge>
                <Badge variant="warning" className="text-xs">
                  <XCircle className="w-3.5 h-3.5 mr-1.5" />
                  {soldProducts.length} sold
                </Badge>
              </div>
            )}
          />

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-4">
            <StatCard
              title="Total Products"
              value={items.length}
              helper="All products"
              icon={<Package2 className="h-5 w-5" />}
              accent="primary"
            />
            <StatCard
              title="In Stock"
              value={inStockProducts.length}
              helper="Available products"
              icon={<TrendingUp className="h-5 w-5" />}
              accent="success"
            />
            <StatCard
              title="Sold"
              value={soldProducts.length}
              helper="Sold out products"
              icon={<Package2 className="h-5 w-5" />}
              accent="warning"
            />
            <StatCard
              title="Total Value"
              value={`₹${inStockProducts.reduce((sum, item) => sum + (item.price * item.stock), 0).toFixed(2)}`}
              helper="Inventory worth"
              icon={<IndianRupee className="h-5 w-5" />}
              accent="primary"
            />
          </div>

          {/* Search and Filter */}
          <Card className="mb-6">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-semibold">Search & Filter</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-5 h-5" />
                  <Input 
                    placeholder="Search by item name or ID" 
                    value={search} 
                    onChange={(e) => setSearch(e.target.value)} 
                    className="pl-10 h-11" 
                  />
                </div>
                <div>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger className="h-11">
                      <Filter className="w-4 h-4 mr-2 text-muted-foreground" />
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
                  <Badge variant="outline" className="text-xs font-semibold px-3 py-1.5">
                    Showing {activeTab === "in-stock" ? inStockProducts.length : soldProducts.length} of {activeTab === "in-stock" ? inStockProducts.length : soldProducts.length} {activeTab === "in-stock" ? "in-stock" : "sold"} items
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Products Tabs */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Product Catalog</CardTitle>
              <CardDescription>Switch between in-stock and sold products</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "in-stock" | "sold")}>
                <TabsList className="w-full max-w-md grid grid-cols-2 mb-6">
                  <TabsTrigger value="in-stock">
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    In Stock ({inStockProducts.length})
                  </TabsTrigger>
                  <TabsTrigger value="sold">
                    <XCircle className="w-4 h-4 mr-2" />
                    Sold ({soldProducts.length})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="in-stock" className="mt-0">
                  <div className="space-y-3">
                    {inStockProducts.map((p) => (
                      <div key={p.id} className="flex items-center justify-between p-5 rounded-xl border border-border hover:border-primary/30 hover:bg-surface-muted/40 transition-all bg-surface">
                        <div className="flex-1">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-primary/10 text-primary">
                              <Package2 className="w-6 h-6" />
                            </div>
                            <div>
                              <h3 className="font-semibold text-foreground text-lg">{p.name}</h3>
                              <p className="text-sm text-muted-foreground font-medium">#{p.custom_id || 'No ID'}</p>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-8">
                          <div className="text-center">
                            <Badge variant="secondary" className="text-xs mb-2 px-3 py-1 font-semibold">
                              {p.category}
                            </Badge>
                            <div className="text-xs text-muted-foreground font-medium">Category</div>
                          </div>
                          <div className="text-center">
                            <div className="text-foreground font-bold text-lg">₹{p.price.toFixed(2)}</div>
                            <div className="text-xs text-muted-foreground font-medium">Price</div>
                          </div>
                          <div className="text-center">
                            <div className="text-foreground font-bold text-lg">{p.stock}</div>
                            <div className="text-xs text-muted-foreground font-medium">Stock</div>
                          </div>
                          <div className="text-center">
                            <div className="text-foreground font-bold text-lg">₹{(p.price * p.stock).toFixed(2)}</div>
                            <div className="text-xs text-muted-foreground font-medium">Value</div>
                          </div>
                        </div>
                      </div>
                    ))}
                    {inStockProducts.length === 0 && (
                      <div className="text-center py-16 bg-surface-muted rounded-xl border-2 border-dashed border-border">
                        <Package2 className="mx-auto h-16 w-16 text-muted-foreground mb-4" />
                        <h3 className="text-xl font-semibold text-foreground mb-2">No in-stock products</h3>
                        <p className="text-muted-foreground">
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
                      <div key={p.id} className="flex items-center justify-between p-5 rounded-xl border border-border bg-surface-muted/80 hover:bg-surface-muted transition-all">
                        <div className="flex-1">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-surface-muted text-muted-foreground">
                              <Package2 className="w-6 h-6" />
                            </div>
                            <div>
                              <h3 className="font-semibold text-muted-foreground text-lg line-through">{p.name}</h3>
                              <p className="text-sm text-muted-foreground font-medium">#{p.custom_id || 'No ID'}</p>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-8">
                          <div className="text-center">
                            <Badge variant="outline" className="text-xs mb-2 px-3 py-1 font-semibold">
                              {p.category}
                            </Badge>
                            <div className="text-xs text-muted-foreground font-medium">Category</div>
                          </div>
                          <div className="text-center">
                            <div className="text-muted-foreground font-bold text-lg">₹{p.price.toFixed(2)}</div>
                            <div className="text-xs text-muted-foreground font-medium">Price</div>
                          </div>
                          <div className="text-center">
                            <Badge variant="destructive" className="text-xs px-3 py-1 font-semibold">
                              Sold Out
                            </Badge>
                            <div className="text-xs text-muted-foreground font-medium mt-2">Stock: 0</div>
                          </div>
                          <div className="text-center">
                            <div className="text-muted-foreground font-bold text-lg">—</div>
                            <div className="text-xs text-muted-foreground font-medium">Value</div>
                          </div>
                        </div>
                      </div>
                    ))}
                    {soldProducts.length === 0 && (
                      <div className="text-center py-16 bg-surface-muted rounded-xl border-2 border-dashed border-border">
                        <Package2 className="mx-auto h-16 w-16 text-muted-foreground mb-4" />
                        <h3 className="text-xl font-semibold text-foreground mb-2">No sold products</h3>
                        <p className="text-muted-foreground">
                          All products are currently in stock.
                        </p>
                      </div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </PageShell>
      </div>
    </div>
  )
}
