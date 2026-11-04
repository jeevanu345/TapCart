export type Role = "ADMIN" | "STORE" | "CUSTOMER";
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  storeId: string | null;
  storeRole?: "OWNER" | "MANAGER" | "STAFF" | null;
}
export interface Auth {
  user: User;
  sessionId: string;
  csrfToken: string;
}
export interface AppOptions {
  origin: string;
  production: boolean;
  developmentPayments: boolean;
  cardPayments?: boolean;
}
export interface Product {
  id: string;
  storeId: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  priceCents: number;
  imageUrl: string;
  active: boolean;
  available: number;
  reserved: number;
  sold: number;
  createdAt: string;
}
export interface Unit {
  id: string;
  productId: string;
  storeId: string;
  staffCode: string;
  status: "AVAILABLE" | "RESERVED" | "SOLD";
  version: number;
  saleEpoch: number;
  reservationId?: string | null;
  reservedUntil?: string | null;
  checkoutOrderId?: string | null;
  checkoutProtectedUntil?: string | null;
  soldOrderId?: string | null;
  name: string;
  sku: string;
  category: string;
  priceCents: number;
  imageUrl: string;
}
export interface OrderItem {
  unitId: string;
  productId: string;
  name: string;
  sku: string;
  priceCents: number;
  reservationId: string;
  protectedVersion: number;
  saleEpoch: number;
  returnedAt: string | null;
}
export interface Order {
  id: string;
  userId: string;
  storeId: string;
  status:
    "PAYMENT_PENDING" | "PAYMENT_FAILED" | "PAID" | "COMPLETED" | "REFUND_PENDING" | "REFUNDED";
  paymentMethod: "DESK" | "DEVELOPMENT" | "CARD";
  totalCents: number;
  customerName: string;
  storeName: string;
  createdAt: string;
  paidAt: string | null;
  completedAt: string | null;
  refundDueCents: number;
  refundedCents: number;
  failureReason: string | null;
  items: OrderItem[];
}
