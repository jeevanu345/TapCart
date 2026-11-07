import type { Database } from "../db.js";
import { forecasts, catalog } from "./data.js";
import { searchCatalog } from "./catalog.js";
export const languages = ["en", "hi", "kn"] as const;
export type Language = (typeof languages)[number];
export interface Evidence {
  label: string;
  href: string;
  facts: Record<string, unknown>;
}
const words = {
  en: {
    stock: "Replenishment review",
    empty: "No matching store records.",
    search: "Catalog matches",
    sales: "Completed orders in the last 28 days",
    units: "available",
    order: "suggested reorder",
    pending: "Orders needing payment or refund review",
    limits: "Based on authorized store records. Forecasts are estimates. I cannot change records.",
  },
  hi: {
    stock: "पुनर्भरण समीक्षा",
    empty: "कोई मेल खाता स्टोर रिकॉर्ड नहीं मिला।",
    search: "कैटलॉग के परिणाम",
    sales: "पिछले 28 दिनों में पूर्ण हुए ऑर्डर",
    units: "उपलब्ध",
    order: "सुझाई गई पुनः खरीद",
    pending: "भुगतान या रिफंड समीक्षा वाले ऑर्डर",
    limits: "अधिकृत स्टोर रिकॉर्ड पर आधारित। पूर्वानुमान अनुमान हैं। मैं रिकॉर्ड बदल नहीं सकता।",
  },
  kn: {
    stock: "ಮರುಪೂರಣ ಪರಿಶೀಲನೆ",
    empty: "ಹೊಂದುವ ಅಂಗಡಿ ದಾಖಲೆಗಳು ಸಿಗಲಿಲ್ಲ.",
    search: "ಕ್ಯಾಟಲಾಗ್ ಫಲಿತಾಂಶಗಳು",
    sales: "ಕಳೆದ 28 ದಿನಗಳಲ್ಲಿ ಪೂರ್ಣಗೊಂಡ ಆರ್ಡರ್‌ಗಳು",
    units: "ಲಭ್ಯ",
    order: "ಸೂಚಿಸಿದ ಮರುಖರೀದಿ",
    pending: "ಪಾವತಿ ಅಥವಾ ಮರುಪಾವತಿ ಪರಿಶೀಲನೆಯ ಆರ್ಡರ್‌ಗಳು",
    limits:
      "ಅನುಮತಿಸಿದ ಅಂಗಡಿ ದಾಖಲೆಗಳನ್ನು ಆಧರಿಸಿದೆ. ಮುನ್ಸೂಚನೆಗಳು ಅಂದಾಜುಗಳು. ದಾಖಲೆಗಳನ್ನು ಬದಲಾಯಿಸಲು ಸಾಧ್ಯವಿಲ್ಲ.",
  },
};
export async function answerStoreQuestion(
  db: Database,
  storeId: string,
  question: string,
  language: Language,
) {
  const text = words[language],
    q = question.toLowerCase(),
    evidence: Evidence[] = [];
  let answer = "";
  if (
    /stock|reorder|replenish|restock|forecast|demand|inventory|स्टॉक|भंडार|ಖರೀದಿ|ದಾಸ್ತಾನು|मांग/.test(
      q,
    )
  ) {
    const rows = (await forecasts(db, storeId))
      .sort((a, b) => b.reorderQuantity - a.reorderQuantity)
      .slice(0, 8);
    answer =
      text.stock +
      "\n" +
      (rows
        .map(
          (f) =>
            `${f.name}: ${f.available} ${text.units}; ${f.reorderQuantity} ${text.order}; ${f.planningHorizonDays} days.`,
        )
        .join("\n") || text.empty);
    for (const f of rows)
      evidence.push({
        label: f.name,
        href: "/store/intelligence/lab?tab=forecasts",
        facts: {
          productId: f.productId,
          available: f.available,
          onOrder: f.onOrder,
          planningHorizonDays: f.planningHorizonDays,
          reorderQuantity: f.reorderQuantity,
          method: f.method,
          backtest: f.backtest,
        },
      });
  } else if (
    /sale|revenue|order|बिक्री|राजस्व|मारಾಟ|ಆದಾಯ/.test(q) &&
    !/refund|payment|रिफंड/.test(q)
  ) {
    const rows = (
      await db.query(
        `SELECT id,total_cents,completed_at FROM customer_order WHERE store_id=$1 AND status='COMPLETED' AND completed_at>=now()-interval '28 days' ORDER BY completed_at DESC LIMIT 10000`,
        [storeId],
      )
    ).rows;
    const total = rows.reduce((a, r) => a + r.total_cents, 0);
    answer = `${text.sales}: ${rows.length}${rows.length === 10000 ? "+" : ""}. ${new Intl.NumberFormat(language === "hi" ? "hi-IN" : language === "kn" ? "kn-IN" : "en-IN", { style: "currency", currency: "INR" }).format(total / 100)}${rows.length === 10000 ? " (first 10,000 records)" : ""}.`;
    evidence.push({
      label: text.sales,
      href: "/store/reports",
      facts: {
        orders: rows.length,
        totalCents: total,
        periodDays: 28,
        capped: rows.length === 10000,
      },
    });
  } else if (/payment|refund|pending|भुगतान|रिफंड|ಪಾವತಿ|ಮರುಪಾವತಿ/.test(q)) {
    const rows = (
      await db.query(
        `SELECT id,status,total_cents,refund_due_cents FROM customer_order WHERE store_id=$1 AND status IN('PAYMENT_PENDING','PAID','REFUND_PENDING') ORDER BY created_at LIMIT 30`,
        [storeId],
      )
    ).rows;
    answer = text.pending + ": " + rows.length + (rows.length === 30 ? "+" : "") + ".";
    rows.forEach((r) =>
      evidence.push({
        label: `${r.id.slice(-8)} · ${r.status}`,
        href: "/store/reconciliation",
        facts: {
          orderId: r.id,
          status: r.status,
          totalCents: r.total_cents,
          refundDueCents: r.refund_due_cents,
        },
      }),
    );
  } else {
    const result = await searchCatalog(await catalog(db, storeId), question, storeId);
    answer =
      text.search +
      "\n" +
      (result.results
        .slice(0, 8)
        .map((p) => `${p.name}: ₹${(p.priceCents / 100).toFixed(2)}; ${p.available} ${text.units}.`)
        .join("\n") || text.empty);
    result.results.slice(0, 8).forEach((p) =>
      evidence.push({
        label: p.name,
        href: "/store/inventory",
        facts: {
          productId: p.id,
          sku: p.sku,
          priceCents: p.priceCents,
          available: p.available,
          searchMode: result.mode,
        },
      }),
    );
  }
  return {
    answer: answer + "\n\n" + text.limits,
    language,
    mode: "grounded-local",
    evidence,
    generatedAt: new Date().toISOString(),
  };
}
