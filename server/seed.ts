import { randomBytes } from "node:crypto";
import { v7 as uuid } from "uuid";
import type { Database } from "./db.js";
import { hashPassword, tokenHash } from "./auth.js";

export const developmentCredentials = {
  password: "TapCartDemo123!",
  admin: "admin@tapcart.local",
  store: "store@tapcart.local",
  shopper: "shopper@tapcart.local",
};
export async function seedDevelopment(db: Database): Promise<void> {
  if (process.env.NODE_ENV === "production")
    throw new Error("Development seed is prohibited in production.");
  const password = await hashPassword(developmentCredentials.password);
  await db.transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('tapcart-development-seed'))");
    if ((await client.query("SELECT 1 FROM app_user LIMIT 1")).rowCount) return;
    const admin = uuid(),
      owner = uuid(),
      shopper = uuid(),
      pendingOwner = uuid(),
      store = uuid(),
      pendingStore = uuid(),
      historicalSession = uuid();
    for (const [userId, name, email, role] of [
      [admin, "Platform Admin", developmentCredentials.admin, "ADMIN"],
      [owner, "Ananya Rao", developmentCredentials.store, "STORE"],
      [shopper, "Alex Morgan", developmentCredentials.shopper, "CUSTOMER"],
      [pendingOwner, "Rahul Mehta", "pending@tapcart.local", "STORE"],
    ])
      await client.query(
        "INSERT INTO app_user(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)",
        [userId, name, email, password, role],
      );
    await client.query(
      "INSERT INTO store(id,owner_id,name,address,status,approved_at) VALUES($1,$2,'Greenfield Market','12 Church Street, Bengaluru','APPROVED',now()),($3,$4,'Harvest Corner','Indiranagar, Bengaluru','PENDING',NULL)",
      [store, owner, pendingStore, pendingOwner],
    );
    await client.query(
      "INSERT INTO session(id,user_id,token_hash,csrf_token,expires_at) VALUES($1,$2,$3,$4,now()-interval '1 second')",
      [
        historicalSession,
        shopper,
        tokenHash(randomBytes(32).toString("hex")),
        randomBytes(32).toString("base64url"),
      ],
    );
    const catalog = [
      [
        "APL-01",
        "Royal Gala Apples",
        "Produce",
        18900,
        "Crisp, naturally sweet apples from carefully selected orchards.",
        "https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?auto=format&fit=crop&w=600&q=80",
      ],
      [
        "AVO-02",
        "Fresh Avocados",
        "Produce",
        12900,
        "Creamy avocados, ready for salads, toast and everyday goodness.",
        "https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?auto=format&fit=crop&w=600&q=80",
      ],
      [
        "BRD-03",
        "Artisan Sourdough",
        "Bakery",
        24500,
        "Slow fermented sourdough with a golden crust, baked fresh daily.",
        "https://images.unsplash.com/photo-1585478259715-876acc5be8eb?auto=format&fit=crop&w=600&q=80",
      ],
      [
        "MLK-04",
        "Organic Whole Milk",
        "Dairy",
        8500,
        "Farm fresh organic whole milk. Keep refrigerated.",
        "https://images.unsplash.com/photo-1563636619-e9143da7973b?auto=format&fit=crop&w=600&q=80",
      ],
      [
        "EGG-05",
        "Free Range Eggs",
        "Dairy",
        16500,
        "A pack of six pasture raised eggs from local farms.",
        "https://images.unsplash.com/photo-1506976785307-8732e854ad03?auto=format&fit=crop&w=600&q=80",
      ],
      [
        "COF-06",
        "House Blend Coffee",
        "Pantry",
        44900,
        "A rich medium roast, freshly packed for your morning ritual.",
        "https://images.unsplash.com/photo-1559525839-b184a4d698c7?auto=format&fit=crop&w=600&q=80",
      ],
      [
        "HON-07",
        "Wildflower Honey",
        "Pantry",
        32500,
        "Raw wildflower honey, naturally sweet and minimally processed.",
        "https://images.unsplash.com/photo-1587049352851-8d4e89133924?auto=format&fit=crop&w=600&q=80",
      ],
      [
        "PAS-08",
        "Italian Penne Pasta",
        "Pantry",
        17900,
        "Durum wheat pasta for a simple, satisfying dinner.",
        "https://images.unsplash.com/photo-1551462147-37885acc36f1?auto=format&fit=crop&w=600&q=80",
      ],
      [
        "STR-09",
        "Fresh Strawberries",
        "Produce",
        21900,
        "Juicy, handpicked strawberries in a recyclable punnet.",
        "https://images.unsplash.com/photo-1464965911861-746a04b4bca6?auto=format&fit=crop&w=600&q=80",
      ],
      [
        "YOG-10",
        "Greek Yogurt",
        "Dairy",
        9900,
        "Thick, creamy plain yogurt, high in protein.",
        "https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=600&q=80",
      ],
      [
        "TEA-11",
        "Chamomile Tea",
        "Beverages",
        28500,
        "A calming caffeine free herbal infusion.",
        "https://images.unsplash.com/photo-1544787219-7f47ccb76574?auto=format&fit=crop&w=600&q=80",
      ],
      [
        "CHO-12",
        "Dark Chocolate 70%",
        "Snacks",
        19500,
        "Single origin dark chocolate with deep cocoa notes.",
        "https://images.unsplash.com/photo-1511381939415-e44015466834?auto=format&fit=crop&w=600&q=80",
      ],
    ] as const;
    const products = [];
    for (const [sku, name, category, price, description, image] of catalog) {
      const productId = uuid();
      products.push({ id: productId, sku, name, price });
      await client.query(
        `INSERT INTO product(id,store_id,sku,name,category,price_cents,description,image_url,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()-interval '35 days')`,
        [productId, store, sku, name, category, price, description, image],
      );
      const quantity = sku === "TEA-11" ? 3 : sku === "HON-07" ? 4 : 12;
      for (let index = 0; index < quantity; index++) {
        const unitId = uuid();
        await client.query(
          "INSERT INTO inventory_unit(id,product_id,store_id,staff_code) VALUES($1,$2,$3,$4)",
          [unitId, productId, store, `${sku}-${String(index + 1).padStart(3, "0")}`],
        );
      }
    }
    // Development-only fixture history is clearly identified as DEVELOPMENT payments.
    // It is never executed automatically at server startup or against a populated database.
    for (let day = 29; day >= 0; day--) {
      const dailyOrders = 2 + (day % 4);
      for (let index = 0; index < dailyOrders; index++) {
        const chosen = [
          products[(day + index) % products.length],
          products[(day * 3 + index + 4) % products.length],
        ];
        const orderId = uuid(),
          time = new Date(Date.now() - day * 86400000 - index * 3600000),
          total = chosen.reduce((sum, item) => sum + item.price, 0);
        await client.query(
          "INSERT INTO customer_order(id,user_id,owner_session_id,store_id,status,payment_method,total_cents,payment_reference,created_at,paid_at,completed_at) VALUES($1,$2,$3,$4,'COMPLETED','DEVELOPMENT',$5,$6,$7,$7,$7)",
          [orderId, shopper, historicalSession, store, total, `seed:${orderId}`, time],
        );
        for (const item of chosen) {
          const unitId = uuid(),
            reservationId = uuid();
          await client.query(
            "INSERT INTO inventory_unit(id,product_id,store_id,staff_code,status,sold_order_id,sold_at,version,created_at) VALUES($1,$2,$3,$4,'SOLD',$5,$6,3,$6)",
            [unitId, item.id, store, `HIST-${unitId}`, orderId, time],
          );
          await client.query(
            "INSERT INTO order_unit(order_id,unit_id,product_id,reservation_id,protected_version,sale_epoch,name,sku,price_cents) VALUES($1,$2,$3,$4,2,0,$5,$6,$7)",
            [orderId, unitId, item.id, reservationId, item.name, item.sku, item.price],
          );
          await client.query(
            "INSERT INTO unit_sale(unit_id,sale_epoch,order_id,price_cents,sold_at) VALUES($1,0,$2,$3,$4)",
            [unitId, orderId, item.price, time],
          );
        }
        await client.query(
          "INSERT INTO payment_event(event_id,order_id,outcome,source,created_at) VALUES($1,$2,'SUCCEEDED','DEVELOPMENT_SEED',$3)",
          [`seed:${orderId}`, orderId, time],
        );
      }
    }
  });
}
