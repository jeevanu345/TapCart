import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Store, Shield, Users, BarChart3, CheckCircle } from "lucide-react"
import { ThemeToggle } from "@/components/ui/theme-toggle"

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(15,118,110,0.08),_transparent_45%)]" />
        <div className="pointer-events-none absolute right-0 top-0 h-64 w-64 rounded-full bg-primary/5 blur-3xl" />

        <header className="relative z-10 border-b border-border bg-surface/80 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-muted border border-border">
                <Image src="/image.png" alt="TapCart logo" width={24} height={24} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">TapCart</p>
                <h1 className="text-lg font-semibold text-foreground">TapCart</h1>
              </div>
            </div>
            <nav className="hidden items-center gap-3 md:flex">
              <Link href="/store/login">
                <Button variant="ghost">Store Login</Button>
              </Link>
              <Link href="/admin/login">
                <Button variant="outline">Admin Access</Button>
              </Link>
              <Link href="/customer">
                <Button variant="outline">Customer Login</Button>
              </Link>
              <ThemeToggle />
            </nav>
            <div className="md:hidden flex items-center gap-2">
              <Link href="/customer">
                <Button variant="outline" size="sm">Customer Login</Button>
              </Link>
              <ThemeToggle />
            </div>
          </div>
        </header>

        <main className="relative z-10">
          <section className="mx-auto max-w-7xl px-4 py-14 md:py-20">
            <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
              <div>
                <p className="text-sm font-medium uppercase tracking-[0.2em] text-primary">TapCart</p>
                <h2 className="mt-4 text-4xl font-semibold text-foreground md:text-5xl">
                  TapCart: NFC-Based Smart Retail System
                </h2>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <Link href="/store/login" className="w-full sm:w-auto">
                    <Button className="w-full">Store Login</Button>
                  </Link>
                  <Link href="/admin/login" className="w-full sm:w-auto">
                    <Button variant="outline" className="w-full">Admin Access</Button>
                  </Link>
                  <Link href="/customer" className="w-full sm:w-auto">
                    <Button variant="outline" className="w-full">Customer Login</Button>
                  </Link>
                </div>
                <div className="mt-6 flex items-center gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-success" />
                    Secure approvals
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-success" />
                    Real-time insights
                  </div>
                </div>
              </div>
              <Card className="border-border/60 bg-surface">
                <CardHeader>
                  <CardTitle className="text-lg">At-a-glance operations</CardTitle>
                  <CardDescription>Everything your team needs to stay aligned.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between rounded-lg border border-border bg-surface-muted px-4 py-3">
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Inventory Health</p>
                      <p className="text-lg font-semibold text-foreground">98% in stock</p>
                    </div>
                    <BarChart3 className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border bg-surface-muted px-4 py-3">
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Customer Activity</p>
                      <p className="text-lg font-semibold text-foreground">+24% this week</p>
                    </div>
                    <Users className="h-5 w-5 text-primary" />
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-3">
              <Link href="/store/login" className="h-full">
                <Card className="h-full border-border/60 transition hover:border-primary/40 hover:shadow-md">
                  <CardHeader className="h-full gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Store className="h-5 w-5" />
                    </div>
                    <CardTitle className="text-lg leading-snug">Store Login</CardTitle>
                    <CardDescription className="text-sm leading-relaxed text-muted-foreground line-clamp-2">
                      Access inventory, orders, and sales in one place.
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
              <Link href="/admin/login" className="h-full">
                <Card className="h-full border-border/60 transition hover:border-primary/40 hover:shadow-md">
                  <CardHeader className="h-full gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Shield className="h-5 w-5" />
                    </div>
                    <CardTitle className="text-lg leading-snug">Admin Access</CardTitle>
                    <CardDescription className="text-sm leading-relaxed text-muted-foreground line-clamp-2">
                      Approve stores and oversee platform operations.
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
              <Link href="/customer" className="h-full">
                <Card className="h-full border-border/60 transition hover:border-primary/40 hover:shadow-md">
                  <CardHeader className="h-full gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Users className="h-5 w-5" />
                    </div>
                    <CardTitle className="text-lg leading-snug">Customer Login</CardTitle>
                    <CardDescription className="text-sm leading-relaxed text-muted-foreground line-clamp-2">
                      Shop seamlessly with NFC and smart checkout.
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            </div>
          </section>

          <section className="border-t border-border bg-surface">
            <div className="mx-auto max-w-7xl px-4 py-16">
              <div className="mb-10 text-center">
                <h3 className="text-3xl font-semibold text-foreground">Everything You Need</h3>
                <p className="mt-3 text-muted-foreground">
                  Powerful features designed to help you manage your store efficiently and grow your business.
                </p>
              </div>
              <div className="grid gap-6 md:grid-cols-3">
                {[
                  {
                    title: "Inventory Management",
                    description: "Track stock levels, manage products, and get low-stock alerts in real time.",
                    icon: <BarChart3 className="h-5 w-5" />,
                  },
                  {
                    title: "Customer Management",
                    description: "Organize customer information and track purchase history effortlessly.",
                    icon: <Users className="h-5 w-5" />,
                  },
                  {
                    title: "Secure & Reliable",
                    description: "Admin-approved accounts with secure authentication and data protection.",
                    icon: <Shield className="h-5 w-5" />,
                  },
                ].map((feature) => (
                  <Card key={feature.title} className="border-border/60 bg-surface-muted h-full">
                    <CardHeader className="h-full gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        {feature.icon}
                      </div>
                      <CardTitle className="text-lg leading-snug">{feature.title}</CardTitle>
                      <CardDescription className="text-sm leading-relaxed text-muted-foreground line-clamp-2">
                        {feature.description}
                      </CardDescription>
                    </CardHeader>
                  </Card>
                ))}
              </div>
            </div>
          </section>

          <section className="mx-auto max-w-7xl px-4 py-16">
            <div className="mb-10 text-center">
              <h3 className="text-3xl font-semibold text-foreground">How It Works</h3>
              <p className="mt-3 text-muted-foreground">
                Get started in three simple steps and begin managing your store today.
              </p>
            </div>
            <div className="grid gap-6 md:grid-cols-3">
              {[
                {
                  step: "1",
                  title: "Sign Up",
                  description: "Create your store account with a unique Store ID and wait for admin approval.",
                },
                {
                  step: "2",
                  title: "Get Approved",
                  description: "Receive email notification once your account is approved by our admin team.",
                },
                {
                  step: "3",
                  title: "Start Managing",
                  description: "Access your dashboard and begin managing inventory, customers, and sales.",
                },
              ].map((item) => (
                <Card key={item.title} className="border-border/60 h-full">
                  <CardHeader className="h-full gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary text-lg font-semibold">
                      {item.step}
                    </div>
                    <CardTitle className="text-lg leading-snug">{item.title}</CardTitle>
                    <CardDescription className="text-sm leading-relaxed text-muted-foreground line-clamp-2">
                      {item.description}
                    </CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </section>

          <section className="border-t border-border bg-surface">
            <div className="mx-auto max-w-7xl px-4 py-16 text-center">
              <h3 className="text-3xl font-semibold text-foreground">Ready to Get Started?</h3>
              <p className="mt-3 text-muted-foreground">
                Join hundreds of stores already using our platform to streamline their operations.
              </p>
              <div className="mt-6 grid gap-3 md:grid-cols-3">
                <Link href="/store/login">
                  <Button variant="outline" className="w-full">Store Login</Button>
                </Link>
                <Link href="/admin/login">
                  <Button variant="outline" className="w-full">Admin Access</Button>
                </Link>
                <Link href="/customer">
                  <Button variant="outline" className="w-full">Customer Login</Button>
                </Link>
              </div>
            </div>
          </section>
        </main>

        <footer className="border-t border-border bg-surface">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 py-6 md:flex-row">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-muted border border-border">
                <Image src="/image.png" alt="TapCart logo" width={18} height={18} />
              </div>
              <span className="text-sm font-medium text-foreground">TapCart</span>
            </div>
            <p className="text-xs text-muted-foreground">© 2024 TapCart. All rights reserved.</p>
          </div>
        </footer>
      </div>
    </div>
  )
}
