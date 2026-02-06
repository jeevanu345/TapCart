"use client"

import { useEffect, useState } from "react"
import { StoreSidebar } from "@/components/store-sidebar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Download, Link, Search, Filter, CheckSquare, Square } from "lucide-react"
import { PageShell } from "@/components/layout/page-shell"
import { PageHeader } from "@/components/layout/page-header"

interface ProductItem {
  id: number
  custom_id?: string
  name: string
  category: string
  price: number
  stock: number
}

interface CategoryCount { category: string; count: number }

export const dynamic = "force-dynamic"

export default function StoreExportPage() {
  const [items, setItems] = useState<ProductItem[]>([])
  const [categoryCounts, setCategoryCounts] = useState<CategoryCount[]>([])
  const [loading, setLoading] = useState(false)
  const [storeName, setStoreName] = useState("")

  // Search and filter states
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<string>("all")
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set())
  const [selectAll, setSelectAll] = useState(false)

  const load = async () => {
    setLoading(true)
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
      setCategoryCounts(data.categoryCounts || [])
      
      // Get store name from session
      try {
        const sessionRes = await fetch("/api/store/auth/session")
        if (sessionRes.ok) {
          const sessionData = await sessionRes.json()
          setStoreName(sessionData.storeId || "")
        } else if (sessionRes.status === 401) {
          // Redirect to home page if session check fails
          window.location.href = "/"
          return
        }
      } catch (error) {
        console.error("Failed to load store session:", error)
      }
    } catch (error) {
      console.error("Error loading products:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  // Filter and search logic - exclude sold products (stock = 0) from export
  const filteredItems = items.filter(item => {
    // Exclude products with stock = 0 from export
    if (item.stock === 0) return false
    
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         item.custom_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         item.category.toLowerCase().includes(searchTerm.toLowerCase())
    
    const matchesCategory = selectedCategory === "all" || item.category === selectedCategory
    
    return matchesSearch && matchesCategory
  })

  // Handle select all
  const handleSelectAll = (checked: boolean) => {
    setSelectAll(checked)
    if (checked) {
      setSelectedItems(new Set(filteredItems.map(item => item.id)))
    } else {
      setSelectedItems(new Set())
    }
  }

  // Handle individual item selection
  const handleItemSelect = (itemId: number, checked: boolean) => {
    const newSelected = new Set(selectedItems)
    if (checked) {
      newSelected.add(itemId)
    } else {
      newSelected.delete(itemId)
    }
    setSelectedItems(newSelected)
    
    // Update select all state
    setSelectAll(newSelected.size === filteredItems.length && filteredItems.length > 0)
  }

  // Generate export links - only for in-stock products
  const generateLinks = () => {
    const selectedProducts = items.filter(item => selectedItems.has(item.id) && item.stock > 0)
    const links = selectedProducts.map(product => {
      const productId = product.custom_id || product.id.toString()
      return `https://tapcart-fr.onrender.com/customer?storeId=${storeName}&productId=${productId}`
    })
    
    return links.join('\n')
  }

  // Export to CSV - only in-stock products
  const exportToCSV = (exportAll = false) => {
    const allInStockItems = items.filter(item => item.stock > 0)
    const productsToExport = exportAll ? allInStockItems : allInStockItems.filter(item => selectedItems.has(item.id))
    
    if (productsToExport.length === 0) {
      alert('No products selected for export')
      return
    }

    const csvContent = [
      ['Product Name', 'Product ID', 'Category', 'Price', 'Stock', 'Link'],
      ...productsToExport.map(product => [
        product.name,
        product.custom_id || product.id.toString(),
        product.category,
        product.price.toString(),
        product.stock.toString(),
        `https://tapcart-fr.onrender.com/customer?storeId=${storeName}&productId=${product.custom_id || product.id}`
      ])
    ].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', `product-links-${exportAll ? 'all' : 'selected'}-${new Date().toISOString().split('T')[0]}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Export only links to CSV - only in-stock products
  const exportLinksOnlyCSV = (exportAll = false) => {
    const allInStockItems = items.filter(item => item.stock > 0)
    const productsToExport = exportAll ? allInStockItems : allInStockItems.filter(item => selectedItems.has(item.id))
    
    if (productsToExport.length === 0) {
      alert('No products selected for export')
      return
    }

    const links = productsToExport.map(product => 
      `https://tapcart-fr.onrender.com/customer?storeId=${storeName}&productId=${product.custom_id || product.id}`
    )

    // Create CSV content with proper CSV formatting
    const csvContent = links.map(link => `"${link}"`).join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', `product-links-only-${exportAll ? 'all' : 'selected'}-${new Date().toISOString().split('T')[0]}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Copy links to clipboard
  const copyLinks = async () => {
    const links = generateLinks()
    try {
      await navigator.clipboard.writeText(links)
      alert('Links copied to clipboard!')
    } catch (error) {
      console.error('Failed to copy links:', error)
      alert('Failed to copy links to clipboard')
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <StoreSidebar />

      <div className="lg:ml-64">
        <PageShell className="bg-transparent min-h-0">
          <PageHeader
            title="Export Product Links"
            description="Select products and export their purchase links"
          />

          {/* Search and Filter */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Search & Filter</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-5 h-5" />
                  <Input
                    placeholder="Search products, IDs, or categories..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 h-11"
                  />
                </div>
                <div>
                  <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                    <SelectTrigger className="h-11">
                      <Filter className="w-4 h-4 mr-2 text-muted-foreground" />
                      <SelectValue placeholder="Filter by category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      {categoryCounts.map((category) => (
                        <SelectItem key={category.category} value={category.category}>
                          {category.category} ({category.count})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs font-semibold px-3 py-1.5">
                    {selectedItems.size} of {filteredItems.length} selected
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Export Actions */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Export Actions</CardTitle>
              <CardDescription className="text-muted-foreground">Export product links and data</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex flex-wrap gap-3">
                  <Button
                    onClick={() => exportToCSV(true)}
                    disabled={!storeName || filteredItems.length === 0}
                    className="gap-2"
                  >
                    <Download className="h-4 w-4" />
                    Download All CSV ({filteredItems.length} items)
                  </Button>
                  <Button
                    onClick={() => exportToCSV(false)}
                    disabled={selectedItems.size === 0 || !storeName}
                    variant="outline"
                    className="gap-2"
                  >
                    <Download className="h-4 w-4" />
                    Download Selected CSV ({selectedItems.size} items)
                  </Button>
                  <Button
                    onClick={() => exportLinksOnlyCSV(false)}
                    disabled={selectedItems.size === 0 || !storeName}
                    variant="secondary"
                    className="gap-2"
                  >
                    <Download className="h-4 w-4" />
                    Download Links Only ({selectedItems.size})
                  </Button>
                  <Button
                    variant="outline"
                    onClick={copyLinks}
                    disabled={selectedItems.size === 0 || !storeName}
                    className="gap-2"
                  >
                    <Link className="h-4 w-4" />
                    Copy Links ({selectedItems.size})
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setSelectedItems(new Set())
                      setSelectAll(false)
                    }}
                    disabled={selectedItems.size === 0}
                    className="gap-2"
                  >
                    Clear Selection
                  </Button>
                </div>
                {storeName && (
                  <div className="text-sm text-muted-foreground font-medium pt-2 border-t border-border">
                    Links will be formatted as: <code className="bg-surface-muted px-3 py-1.5 rounded-lg border border-border text-muted-foreground font-mono text-xs ml-2">https://tapcart-fr.onrender.com/customer?storeId={storeName}&productId=product-id</code>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Products List */}
          <Card className="border border-border shadow-md bg-surface">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl font-bold text-foreground">Select Products</CardTitle>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="selectAll"
                    checked={selectAll}
                    onCheckedChange={handleSelectAll}
                  />
                  <Label htmlFor="selectAll" className="text-sm font-semibold text-muted-foreground">
                    Select All ({filteredItems.length})
                  </Label>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {filteredItems.map((item) => (
                  <label
                    key={item.id}
                    htmlFor={`item-${item.id}`}
                    className="flex items-center gap-4 p-5 border-2 border-border rounded-xl hover:border-blue-300 hover:bg-blue-50/50 cursor-pointer transition-all shadow-sm bg-surface"
                  >
                    <Checkbox
                      id={`item-${item.id}`}
                      checked={selectedItems.has(item.id)}
                      onCheckedChange={(checked) => handleItemSelect(item.id, checked as boolean)}
                    />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold text-foreground text-lg">{item.name}</h3>
                          <p className="text-sm text-muted-foreground font-medium">#{item.custom_id || 'No ID'}</p>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-foreground text-lg">₹{item.price.toFixed(2)}</div>
                          <Badge variant="outline" className="text-xs mt-2 px-3 py-1 bg-blue-100 text-blue-700 border-blue-300 font-semibold">
                            {item.category}
                          </Badge>
                        </div>
                      </div>
                      <div className="mt-3">
                        <code className="text-xs bg-surface-muted px-3 py-2 rounded-lg border border-border text-muted-foreground font-mono">
                          https://tapcart-fr.onrender.com/customer?storeId={storeName}&productId={item.custom_id || item.id}
                        </code>
                      </div>
                    </div>
                  </label>
                ))}
                
                {filteredItems.length === 0 && (
                  <div className="text-center py-10">
                    <Link className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium text-foreground mb-2">No products found</h3>
                    <p className="text-muted-foreground">
                      {items.filter(item => item.stock > 0).length === 0 
                        ? items.length === 0
                          ? "No products available to export."
                          : "No in-stock products available. Only products with stock > 0 can be exported."
                        : "Try adjusting your search or filter criteria."
                      }
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </PageShell>
      </div>
    </div>
  )
}
