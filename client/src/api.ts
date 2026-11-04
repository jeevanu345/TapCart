import { useCallback, useEffect, useState } from "react";
export type { User, Product, Unit, Order, OrderItem, Role } from "../../server/types";
import type { Product, Order, User } from "../../server/types";
export interface Dashboard {
  metrics: {
    revenueCents: number;
    completedOrders: number;
    availableUnits: number;
    reservedUnits: number;
    soldUnits: number;
    products: number;
    customers: number;
    pendingStores: number;
  };
  recentOrders: Order[];
  lowStock: Product[];
  dailySales: DailySale[];
}
export interface DailySale {
  date: string;
  revenueCents: number;
  orders: number;
}
export interface Analytics {
  dailySales: DailySale[];
  topProducts: { id: string; name: string; units: number; revenueCents: number }[];
  statusCounts: { status: string; count: number }[];
  categorySales: { category: string; units: number; revenueCents: number }[];
}
export interface Customer {
  id: string;
  name: string;
  email: string;
  orders: number;
  totalCents: number;
  lastOrderAt: string;
}
export interface Store {
  id: string;
  name: string;
  address: string;
  status: "PENDING" | "APPROVED" | "DENIED";
  ownerId: string;
  ownerName: string;
  email: string;
  createdAt: string;
}
export interface Session {
  user: User | null;
  csrfToken: string;
  developmentPayments?: boolean;
  cardPayments?: boolean;
}
let csrfToken = "";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.method && options.method !== "GET" ? { "X-CSRF-Token": csrfToken } : {}),
      ...options.headers,
    },
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      typeof data === "object" && data !== null && "error" in data
        ? String(data.error)
        : `Request failed (${response.status})`,
      response.status,
    );
  return data as T;
}
export async function session() {
  const value = await api<Session>("/auth/session");
  csrfToken = value.csrfToken;
  return value;
}
export function write<T>(path: string, body: unknown, method = "POST", key?: string) {
  return api<T>(path, {
    method,
    body: JSON.stringify(body),
    headers: key ? { "Idempotency-Key": key } : {},
  });
}
export function useData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    let active = true;
    if (!path) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    api<T>(path)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((e: unknown) => {
        if (active) setError(message(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, revision]);
  return { data, error, loading, reload };
}
export const message = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong. Please try again.";
export const money = (cents: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
export const date = (value: string) =>
  new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
export const shortId = (id: string) => `TC-${id.slice(-6).toUpperCase()}`;
export function downloadCSV(filename: string, rows: (string | number)[][]) {
  const csv = serializeCSV(rows);
  const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function serializeCSV(rows: (string | number)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          let value = String(cell);
          if (/^\s*[=+@-]|^[\t\r]/.test(value)) value = `'${value}`;
          return `"${value.replace(/"/g, '""')}"`;
        })
        .join(","),
    )
    .join("\r\n");
}
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    value = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(value);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else value += char;
  }
  if (quoted) throw new Error("CSV contains an unclosed quote.");
  row.push(value);
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
