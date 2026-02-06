"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ShoppingCart,
  Trash2,
  Check as Checkout,
  Radio,
  CheckCircle,
  X,
  Download,
  Package,
  IndianRupee,
  CreditCard,
  Smartphone,
  Store,
  Tag,
  Phone,
  Lock,
  Gift,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useRouter } from "next/navigation"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ThemeToggle } from "@/components/ui/theme-toggle"

interface CartItem {
  id: number
  product_id: number
  product_name: string
  store_id: string
  price: number
  quantity: number
}

export default function CustomerPage() {
  // --- state (unchanged logic) ---
  const [cart, setCart] = useState<CartItem[]>([])
  const [isNfcSupported, setIsNfcSupported] = useState(false)
  const [isNfcReading, setIsNfcReading] = useState(false)
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false)
  const [phone, setPhone] = useState("")
  const [otp, setOtp] = useState("")
  const [otpSent, setOtpSent] = useState(false)
  const [otpVerified, setOtpVerified] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState("")
  const [couponCode, setCouponCode] = useState("")
  const [discount, setDiscount] = useState(0)
  const [isMounted, setIsMounted] = useState(false)
  const [paymentConfirmed, setPaymentConfirmed] = useState(false)
  const [confirmedOrderId, setConfirmedOrderId] = useState<string | null>(null)
  const [confirmedBillUrl, setConfirmedBillUrl] = useState<string | null>(null)
  const { toast } = useToast()
  const router = useRouter()
  const [hasProcessedUrlParams, setHasProcessedUrlParams] = useState(false)
  const [isCartLoaded, setIsCartLoaded] = useState(false)

  // --- payment-confirmation from URL (kept) ---
  useEffect(() => {
    if (typeof window === "undefined") return

    try {
      const urlParams = new URLSearchParams(window.location.search)
      const orderId = urlParams.get("orderId")
      const paymentStatus = urlParams.get("paymentStatus")
      const billUrl = urlParams.get("billUrl")

      if (orderId && paymentStatus === "confirmed") {
        setPaymentConfirmed(true)
        setConfirmedOrderId(orderId)
        if (billUrl) {
          setConfirmedBillUrl(decodeURIComponent(billUrl))
        }

        const newUrl = window.location.pathname
        window.history.replaceState({}, "", newUrl)

        toast({
          title: "Payment Confirmed",
          description: `Your order ${orderId} has been confirmed successfully!`,
        })
      }
    } catch (error) {
      console.error("Error checking payment confirmation:", error)
    }
  }, [toast])

  // --- mount guard to avoid hydration mismatch ---
  useEffect(() => setIsMounted(true), [])

  useEffect(() => {
    if (typeof window === "undefined") return

    try {
      if ("NDEFReader" in window) setIsNfcSupported(true)

      const savedCart = localStorage.getItem("customer_cart")
      if (savedCart) {
        const parsedCart = JSON.parse(savedCart)
        if (Array.isArray(parsedCart)) setCart(parsedCart)
      }
    } catch (error) {
      console.error("Error initializing customer page:", error)
    } finally {
      setIsCartLoaded(true)
    }
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      localStorage.setItem("customer_cart", JSON.stringify(cart))
    } catch (error) {
      console.error("Error saving cart to localStorage:", error)
    }
  }, [cart])

  // --- add product from a URL (kept but tidy) ---
  const handleAddProductFromUrl = useCallback(async (productId: string, storeId: string) => {
    if (typeof window === "undefined") return

    try {
      const apiUrl = `/api/customer/product?productId=${encodeURIComponent(productId)}&storeId=${encodeURIComponent(storeId)}`
      const response = await fetch(apiUrl)

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        toast({
          title: "Product not found",
          description: data.error || `Product ${productId} is not available in store ${storeId}.`,
          variant: "destructive",
        })
        window.history.replaceState({}, "", window.location.pathname)
        return
      }

      const data = await response.json()
      const product = data.product

      if (!product) {
        toast({
          title: "Product not found",
          description: "This product is not available in the store inventory.",
          variant: "destructive",
        })
        window.history.replaceState({}, "", window.location.pathname)
        return
      }

      // read from localStorage to avoid race conditions
      let currentCart: CartItem[] = []
      try {
        const savedCart = localStorage.getItem("customer_cart")
        if (savedCart) {
          currentCart = JSON.parse(savedCart)
          if (!Array.isArray(currentCart)) currentCart = []
        }
      } catch (e) {
        currentCart = []
      }

      if (currentCart.find((it) => it.product_id === product.id)) {
        toast({ title: "Product already in cart", description: "This product is already in your cart." })
        window.history.replaceState({}, "", window.location.pathname)
        return
      }

      if (currentCart.length > 0 && currentCart[0].store_id !== storeId) {
        toast({ title: "Different store", description: "You can only add products from the same store.", variant: "destructive" })
        window.history.replaceState({}, "", window.location.pathname)
        return
      }

      const newItem: CartItem = {
        id: Date.now(),
        product_id: product.id,
        product_name: product.name,
        store_id: storeId,
        price: Number.parseFloat(product.price),
        quantity: 1,
      }

      const updatedCart = [...currentCart, newItem]
      setCart(updatedCart)
      try {
        localStorage.setItem("customer_cart", JSON.stringify(updatedCart))
      } catch (e) {}

      toast({ title: "Product added", description: `${product.name} has been added to your cart.` })

      window.history.replaceState({}, "", window.location.pathname)
    } catch (error) {
      console.error("Error adding product from URL:", error)
      toast({ title: "Error", description: "Could not add product to cart.", variant: "destructive" })
      window.history.replaceState({}, "", window.location.pathname)
    }
  }, [toast])

  useEffect(() => {
    if (typeof window === "undefined" || !isMounted || hasProcessedUrlParams || !isCartLoaded) return

    try {
      const urlParams = new URLSearchParams(window.location.search)
      const storeId = urlParams.get("storeId")
      const productId = urlParams.get("productId")

      if (storeId && productId) {
        setHasProcessedUrlParams(true)
        handleAddProductFromUrl(productId, storeId).catch((e) => {
          console.error(e)
          setHasProcessedUrlParams(true)
        })
      } else {
        setHasProcessedUrlParams(true)
      }
    } catch (error) {
      console.error("Error processing URL params:", error)
      setHasProcessedUrlParams(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMounted, isCartLoaded])

  // --- NFC reading (kept as-is) ---
  const handleNfcRead = async () => {
    if (!isNfcSupported) {
      toast({ title: "NFC not supported", description: "Your device doesn't support NFC reading.", variant: "destructive" })
      return
    }

    setIsNfcReading(true)
    try {
      const reader = new (window as any).NDEFReader()
      await reader.scan()

      reader.addEventListener("reading", async (event: any) => {
        try {
          const record = event.message.records[0]
          const url = new TextDecoder().decode(record.data)

          let productId: string | null = null
          let storeId: string | null = null

          try {
            const urlObj = new URL(url)
            const params = new URLSearchParams(urlObj.search)
            productId = params.get("productId")
            storeId = params.get("storeId")
          } catch (e) {
            const urlParts = url.split("/")
            if (urlParts.length >= 2) {
              productId = urlParts[0]
              storeId = urlParts[1]
            }
          }

          if (productId && storeId) await addProductToCart(productId, storeId)
          else toast({ title: "Invalid NFC tag", description: "Invalid tag format.", variant: "destructive" })
        } catch (error) {
          console.error("Error reading NFC:", error)
          toast({ title: "Error reading NFC", description: "Could not read the NFC tag.", variant: "destructive" })
        } finally {
          setIsNfcReading(false)
        }
      })

      reader.addEventListener("readingerror", () => {
        setIsNfcReading(false)
        toast({ title: "NFC read error", description: "Could not read the NFC tag.", variant: "destructive" })
      })
    } catch (error) {
      setIsNfcReading(false)
      toast({ title: "NFC error", description: "Could not start NFC reader.", variant: "destructive" })
    }
  }

  const addProductToCart = async (productId: string, storeId: string) => {
    try {
      const apiUrl = `/api/customer/product?productId=${encodeURIComponent(productId)}&storeId=${encodeURIComponent(storeId)}`
      const response = await fetch(apiUrl)

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        toast({ title: "Product not found", description: data.error || `Product ${productId} is not available.` , variant: "destructive" })
        return
      }

      const data = await response.json()
      const product = data.product

      if (cart.find((item) => item.product_id === product.id)) {
        toast({ title: "Product already in cart", description: "This product is already in your cart." })
        return
      }

      if (cart.length > 0 && cart[0].store_id !== storeId) {
        toast({ title: "Different store", description: "You can only add products from the same store.", variant: "destructive" })
        return
      }

      const newItem: CartItem = {
        id: Date.now(),
        product_id: product.id,
        product_name: product.name,
        store_id: storeId,
        price: Number.parseFloat(product.price),
        quantity: 1,
      }

      setCart([...cart, newItem])
      toast({ title: "Product added", description: `${product.name} has been added to your cart.` })
    } catch (error) {
      toast({ title: "Error", description: "Could not add product to cart.", variant: "destructive" })
    }
  }

  const removeFromCart = (itemId: number) => {
    setCart(cart.filter((item) => item.id !== itemId))
    toast({ title: "Removed", description: "Product removed from cart." })
  }

  const calculateTotal = () => {
    const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0)
    return { subtotal, discount, total: Math.max(0, subtotal - discount) }
  }

  const handleCheckout = () => {
    if (cart.length === 0) {
      toast({ title: "Cart is empty", description: "Please add products to your cart first.", variant: "destructive" })
      return
    }
    setIsCheckoutOpen(true)
  }

  // --- OTP, coupon, payment (kept logic) ---
  const sendOTP = async () => {
    if (!phone || phone.length < 10) {
      toast({ title: "Invalid phone number", description: "Please enter a valid phone number.", variant: "destructive" })
      return
    }

    try {
      const response = await fetch("/api/customer/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      })

      const data = await response.json()

      if (response.ok && data.success) {
        setOtpSent(true)
        toast({ title: "OTP sent", description: "Please check your phone for the OTP code." })
        if (data.otp && process.env.NODE_ENV === "development") console.log(`[DEV] OTP for ${phone}: ${data.otp}`)
      } else {
        const errorMsg = data.details || data.error || "Could not send OTP."
        toast({ title: "Error sending OTP", description: errorMsg, variant: "destructive" })
        console.error("OTP send error:", data)
      }
    } catch (error) {
      toast({ title: "Error", description: "Could not send OTP.", variant: "destructive" })
    }
  }

  const verifyOTP = async () => {
    if (!otp || otp.length !== 6) {
      toast({ title: "Invalid OTP", description: "Please enter a 6-digit OTP code.", variant: "destructive" })
      return
    }

    setIsVerifying(true)
    try {
      const response = await fetch("/api/customer/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, otp }),
      })

      const data = await response.json()

      if (response.ok) {
        setOtpVerified(true)
        toast({ title: "OTP verified", description: "Phone number verified successfully." })
      } else {
        toast({ title: "Invalid OTP", description: data.error || "The OTP code is incorrect.", variant: "destructive" })
      }
    } catch (error) {
      toast({ title: "Error", description: "Could not verify OTP.", variant: "destructive" })
    } finally {
      setIsVerifying(false)
    }
  }

  const applyCoupon = async () => {
    if (!couponCode || cart.length === 0) return

    try {
      const totals = calculateTotal()
      const response = await fetch("/api/customer/coupon/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: couponCode, storeId: cart[0]?.store_id, amount: totals.subtotal }),
      })

      const data = await response.json()

      if (response.ok) {
        setDiscount(data.discount || 0)
        toast({ title: "Coupon applied", description: `Discount of ₹${data.discount} applied.` })
      } else {
        toast({ title: "Invalid coupon", description: data.error || "This coupon code is invalid.", variant: "destructive" })
      }
    } catch (error) {
      toast({ title: "Error", description: "Could not apply coupon.", variant: "destructive" })
    }
  }

  const processPayment = async () => {
    if (!paymentMethod) return toast({ title: "Select payment method", description: "Please select a payment method.", variant: "destructive" })
    if (!otpVerified) return toast({ title: "Verify OTP", description: "Please verify your phone number.", variant: "destructive" })

    try {
      const totals = calculateTotal()
      const response = await fetch("/api/customer/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          cart: cart.map((item) => ({ product_id: item.product_id, quantity: item.quantity })),
          storeId: cart[0]?.store_id,
          paymentMethod,
          couponCode: couponCode || null,
          discount,
          totalAmount: totals.total,
        }),
      })

      const data = await response.json()

      if (response.ok) {
        setCart([])
        localStorage.removeItem("customer_cart")
        setPhone("")
        setOtp("")
        setOtpSent(false)
        setOtpVerified(false)
        setCouponCode("")
        setDiscount(0)
        setPaymentMethod("")
        setIsCheckoutOpen(false)

        setPaymentConfirmed(true)
        setConfirmedOrderId(data.orderId || "")
        if (data.billUrl) setConfirmedBillUrl(data.billUrl)

        toast({ title: "Order placed", description: "Your order has been placed successfully!" })

        if (data.billUrl) {
          setTimeout(() => window.open(data.billUrl, "_blank"), 400)
        }
      } else {
        toast({ title: "Payment failed", description: data.error || "Could not process payment.", variant: "destructive" })
      }
    } catch (error) {
      toast({ title: "Error", description: "Could not process payment.", variant: "destructive" })
    }
  }

  if (!isMounted || !isCartLoaded) {
    return (
      <div className="min-h-[100svh] flex items-center justify-center bg-background pb-[env(safe-area-inset-bottom)]">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary text-primary-foreground mb-4 shadow-sm">
            <ShoppingCart className="w-7 h-7" strokeWidth={1.6} />
          </div>
          <p className="text-muted-foreground text-sm font-medium">Loading your cart...</p>
        </div>
      </div>
    )
  }

  const totals = calculateTotal()

  // --- small presentational components inside file for clearer structure ---
  const EmptyState = () => (
    <div className="text-center py-20">
      <div className="mx-auto inline-flex items-center justify-center w-20 h-20 rounded-xl bg-surface-muted shadow-sm mb-6">
        <ShoppingCart className="w-9 h-9 text-primary" strokeWidth={1.6} />
      </div>
      <h3 className="text-xl font-semibold text-foreground mb-2">Your cart is empty</h3>
      <p className="text-muted-foreground">Tap an NFC tag to add items. Explore the store for cute finds ✨</p>
    </div>
  )

  const CartItemRow = ({ item }: { item: CartItem }) => (
    <div className="group flex items-center gap-4 p-4 bg-surface rounded-xl border border-border hover:shadow-md transition-shadow duration-150">
      <div className="flex-shrink-0 w-14 h-14 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20">
        <Package className="w-6 h-6 text-primary" strokeWidth={1.5} />
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-semibold text-foreground truncate">{item.product_name}</h4>
        <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
          <div className="flex items-center gap-1">
            <Store className="w-3 h-3" strokeWidth={2} />
            <span>Store {item.store_id}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Qty:</span>
            <span className="font-medium">{item.quantity}</span>
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="text-foreground font-semibold">₹{item.price.toFixed(2)}</div>
        <div className="mt-2 flex items-center gap-2 justify-end">
          <Button variant="ghost" size="sm" onClick={() => removeFromCart(item.id)} className="text-muted-foreground hover:text-rose-600">
            <Trash2 className="w-4 h-4" strokeWidth={1.6} />
          </Button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-[100svh] bg-background py-8 pb-[env(safe-area-inset-bottom)]">
      <div className="container mx-auto px-4">
        <div className="max-w-4xl mx-auto">
          {/* Main column */}
          <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-xl bg-primary flex items-center justify-center shadow-sm">
                  <ShoppingCart className="w-7 h-7 text-primary-foreground" strokeWidth={1.6} />
                </div>
                <div>
                  <h1 className="text-3xl font-bold text-foreground leading-tight">Your Cart</h1>
                  
                </div>
              </div>

              <div className="hidden md:flex items-center gap-3">
                <div className="text-sm text-muted-foreground">{cart.length} items</div>
                <Button onClick={() => { setCart([]); localStorage.removeItem('customer_cart'); toast({ title: 'Cleared', description: 'Cart cleared.' }) }} variant="ghost" size="sm" className="text-muted-foreground hover:text-rose-600">Clear</Button>
                <ThemeToggle />
              </div>
            </div>
            <div className="md:hidden flex justify-end">
              <ThemeToggle />
            </div>

            {/* NFC Card */}
            <Card className="rounded-2xl shadow-sm border border-border overflow-hidden">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Radio className="w-5 h-5 text-primary" strokeWidth={2} />
                  </div>
                  <div>
                    <CardTitle className="text-lg font-semibold">NFC Tag Reader</CardTitle>
                    <CardDescription className="text-sm text-muted-foreground">Tap your phone on a tag to add items instantly.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex gap-4 items-center">
                  <Button onClick={handleNfcRead} disabled={!isNfcSupported || isNfcReading} className="flex-1 h-12">
                    {isNfcReading ? (
                      <>
                        <div className="w-4 h-4 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        Reading NFC...
                      </>
                    ) : (
                      <>
                        <Radio className="w-4 h-4 mr-2" strokeWidth={2} />
                        Start NFC
                      </>
                    )}
                  </Button>

                  <div className="w-48 text-sm text-muted-foreground">
                    {isNfcSupported ? (
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-success" />
                        <span>Device supports NFC</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-rose-300" />
                        <span>NFC unavailable</span>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Cart list */}
            <Card className="rounded-2xl shadow-md border border-border overflow-hidden">
              <CardHeader className="border-b">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center">
                      <ShoppingCart className="w-5 h-5 text-indigo-600" strokeWidth={1.6} />
                    </div>
                    <div>
                      <CardTitle className="text-lg font-semibold">Items</CardTitle>
                      <CardDescription className="text-sm text-muted-foreground">Review your items before checkout</CardDescription>
                    </div>
                  </div>

                </div>
              </CardHeader>

              <CardContent>
                {cart.length === 0 ? (
                  <EmptyState />
                ) : (
                  <div className="space-y-3">
                    {cart.map((item) => (
                      <CartItemRow key={item.id} item={item} />
                    ))}

                    <div className="mt-4 bg-surface rounded-xl p-4 border border-border shadow-sm">
                      <div className="flex justify-between items-center mb-2">
                        <div className="text-sm text-muted-foreground">Subtotal</div>
                        <div className="font-semibold text-foreground">₹{totals.subtotal.toFixed(2)}</div>
                      </div>

                      {discount > 0 && (
                        <div className="flex justify-between items-center bg-primary/10 p-3 rounded-lg border border-primary/20 mb-3">
                          <div className="flex items-center gap-2 text-sm text-primary">
                            <Gift className="w-4 h-4" />
                            <span>Discount</span>
                          </div>
                          <div className="font-semibold text-foreground">-₹{discount.toFixed(2)}</div>
                        </div>
                      )}

                      <div className="flex justify-between items-center pt-3 border-t">
                        <div className="text-lg font-semibold">Total</div>
                        <div className="text-2xl font-bold text-primary">₹{totals.total.toFixed(2)}</div>
                      </div>
                      
                      {cart.length > 0 && (
                        <Button onClick={handleCheckout} className="w-full mt-4 h-12">
        
                          Proceed to Checkout
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

        </div>
      </div>

      {/* Checkout Dialog (refined visuals) */}
      <Dialog open={isCheckoutOpen} onOpenChange={setIsCheckoutOpen}>
        <DialogContent className="max-w-2xl w-[95vw] sm:w-full max-h-[95svh] sm:max-h-[90svh] bg-surface rounded-2xl shadow-2xl p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] overflow-y-auto">
          <DialogHeader className="relative pb-4 text-center">
            <DialogTitle className="text-lg font-semibold text-foreground">Secure Checkout</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">Verify your number and choose payment method to complete your order.</DialogDescription>
           <Button variant="ghost" size="icon" onClick={() => setIsCheckoutOpen(false)} className="absolute -right-2 -top-2 h-10 w-10 rounded-lg hover:bg-surface-muted" > <X className="w-6 h-6 text-muted-foreground" /> </Button>

          </DialogHeader>

          <div className="mt-6 space-y-5">
            {/* Phone */}
            <div>
              <Label htmlFor="phone" className="text-sm font-medium text-muted-foreground mb-2 block">Phone number</Label>
              <div className="flex gap-3">
                <div className="relative flex-1">
                  <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" strokeWidth={1.6} />
                  <Input id="phone" type="tel" placeholder="Enter your phone number" value={phone} onChange={(e) => setPhone(e.target.value)} className="pl-10 h-12 text-[16px] sm:text-base text-foreground" />
                </div>
                <Button onClick={sendOTP} disabled={otpSent} className="h-12 px-4">
                  {otpSent ? (
                    <>
                      <CheckCircle className="w-4 h-4 mr-2" /> Sent
                    </>
                  ) : (
                    "Send OTP"
                  )}
                </Button>
              </div>
            </div>

            {/* OTP */}
            {otpSent && (
              <div>
                <Label htmlFor="otp" className="text-sm font-medium text-muted-foreground mb-2 block">Enter OTP</Label>
                <div className="flex gap-3 items-center">
                  <Input id="otp" value={otp} onChange={(e) => setOtp(e.target.value)} maxLength={6} className="h-12 text-center font-semibold tracking-widest text-lg text-foreground" disabled={otpVerified} />
                  {otpVerified ? (
                    <Button disabled className="h-12 bg-primary/10 text-primary">Verified</Button>
                  ) : (
                    <Button onClick={verifyOTP} disabled={isVerifying} className="h-12 px-4">
                      {isVerifying ? "Verifying..." : "Verify"}
                    </Button>
                  )}
                </div>
                {otpVerified && <div className="mt-2 text-sm text-success">Phone number verified ✓</div>}
              </div>
            )}

            {/* Coupon */}
            <div>
              <Label htmlFor="coupon" className="text-sm font-medium text-muted-foreground mb-2 block">Coupon code (optional)</Label>
              <div className="flex gap-3">
                <Input id="coupon" value={couponCode} onChange={(e) => setCouponCode(e.target.value)} className="h-12 text-[16px] sm:text-base text-foreground" />
                <Button onClick={applyCoupon} className="h-12 px-4"><Tag className="w-4 h-4 mr-2" />Apply</Button>
              </div>
            </div>

            {/* Payment methods */}
            <div>
              <Label className="text-sm font-medium text-muted-foreground mb-3 block">Payment method</Label>
              <RadioGroup value={paymentMethod} onValueChange={setPaymentMethod} className="space-y-3">
                <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${paymentMethod === 'card'? 'border-primary/40 bg-primary/10': 'border-border bg-surface hover:border-primary/30'}`}>
                  <RadioGroupItem value="card" className="w-4 h-4" />
                  <div className="flex items-center gap-3 flex-1">
                    <div className={`w-9 h-9 rounded-md flex items-center justify-center ${paymentMethod === 'card' ? 'bg-primary/10' : 'bg-surface-muted'}`}>
                      <CreditCard className={`${paymentMethod === 'card' ? 'text-primary' : 'text-muted-foreground'}`} />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-foreground">Card</div>
                      <div className="text-xs text-muted-foreground">Visa, Mastercard, Amex</div>
                    </div>
                  </div>
                </label>

                <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${paymentMethod === 'upi'? 'border-primary/40 bg-primary/10': 'border-border bg-surface hover:border-primary/30'}`}>
                  <RadioGroupItem value="upi" className="w-4 h-4" />
                  <div className="flex items-center gap-3 flex-1">
                    <div className={`w-9 h-9 rounded-md flex items-center justify-center ${paymentMethod === 'upi' ? 'bg-primary/10' : 'bg-surface-muted'}`}>
                      <Smartphone className={`${paymentMethod === 'upi' ? 'text-primary' : 'text-muted-foreground'}`} />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-foreground">UPI</div>
                      <div className="text-xs text-muted-foreground">Google Pay, PhonePe, Paytm</div>
                    </div>
                  </div>
                </label>

                <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${paymentMethod === 'pay_at_desk'? 'border-primary/40 bg-primary/10': 'border-border bg-surface hover:border-primary/30'}`}>
                  <RadioGroupItem value="pay_at_desk" className="w-4 h-4" />
                  <div className="flex items-center gap-3 flex-1">
                    <div className={`w-9 h-9 rounded-md flex items-center justify-center ${paymentMethod === 'pay_at_desk' ? 'bg-primary/10' : 'bg-surface-muted'}`}>
                      <Store className={`${paymentMethod === 'pay_at_desk' ? 'text-primary' : 'text-muted-foreground'}`} />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-foreground">Pay at desk</div>
                      <div className="text-xs text-muted-foreground">Pay when you pick up</div>
                    </div>
                  </div>
                </label>
              </RadioGroup>
            </div>

            {/* Total & pay */}
            <div className="pt-4 border-t">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm text-muted-foreground">Total payable</div>
                <div className="text-xl font-bold text-primary">₹{totals.total.toFixed(2)}</div>
              </div>

              <Button onClick={processPayment} disabled={!otpVerified || !paymentMethod} className="w-full h-12">
                {!otpVerified ? (
                  <>
                    <Lock className="w-4 h-4 mr-2" /> Verify OTP First
                  </>
                ) : !paymentMethod ? (
                  <>
                    <CreditCard className="w-4 h-4 mr-2" /> Select Payment Method
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" /> Complete Payment
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Payment confirmation alert */}
      {paymentConfirmed && confirmedOrderId && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-[calc(1.5rem+env(safe-area-inset-bottom))] z-50">
          <div className="bg-surface rounded-xl shadow-xl p-4 border border-border flex items-center gap-4">
            <div className="w-10 h-10 rounded-md bg-success/10 flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-success" />
            </div>
            <div>
              <div className="font-semibold text-foreground">Payment Confirmed</div>
              <div className="text-sm text-muted-foreground">Order <span className="font-medium">{confirmedOrderId}</span> placed successfully.</div>
            </div>
            <div className="ml-4 flex items-center gap-2">
              {confirmedBillUrl && (
                <Button onClick={() => window.open(confirmedBillUrl!, '_blank')} size="sm" variant="outline"><Download className="w-4 h-4 mr-2" />Bill</Button>
              )}
              <Button onClick={() => { setPaymentConfirmed(false); setConfirmedOrderId(null); setConfirmedBillUrl(null) }} variant="ghost" size="sm">
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
