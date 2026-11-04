import { expect, it } from "vitest";
import { renderInvoice } from "./invoice.js";
it("renders server amounts and escapes untrusted names in printable receipts", () => {
  const receipt = renderInvoice({
    id: "019a4976-c0c0-7111-8111-111111111111",
    storeName: "<script>bad()</script>",
    customerName: "Alex & Co",
    status: "COMPLETED",
    totalCents: 14950,
    refundedCents: 0,
    createdAt: "2026-11-04T00:00:00Z",
    items: [{ name: '<img onerror="bad()">', sku: "Cup", priceCents: 14950, returnedAt: null }],
  });
  expect(receipt).toContain("&lt;script&gt;");
  expect(receipt).not.toContain("<script>");
  expect(receipt).not.toContain("<img");
  expect(receipt).toContain("149.50");
  expect(receipt).toContain("Alex &amp; Co");
});
