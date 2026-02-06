import { NextRequest, NextResponse } from "next/server"
import { getStoreSession } from "@/lib/auth"
import { neon } from "@neondatabase/serverless"
import { enforceSameOrigin } from "@/lib/security"

function getSql() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set")
  return neon(url)
}

async function ensureProductsTable(sql: any) {
  try {
    // Create products table if it doesn't exist
    await sql`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        store_id VARCHAR(50),
        name VARCHAR(255) NOT NULL,
        stock INTEGER DEFAULT 0,
        price DECIMAL(10,2) DEFAULT 0.00,
        category VARCHAR(100) DEFAULT 'General',
        custom_id VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `
    
    // Ensure columns exist (for existing tables)
    try {
      await sql`alter table products add column if not exists category varchar(100) default 'General'`
    } catch (e) {
      // Column might already exist
    }
    try {
      await sql`alter table products add column if not exists stock integer default 1`
    } catch (e) {
      // Column might already exist
    }
    try {
      await sql`alter table products add column if not exists custom_id varchar(50)`
    } catch (e) {
      // Column might already exist
    }
  } catch (tableError) {
    console.log("Table creation check:", tableError)
  }
}

export async function GET() {
  try {
    const session = await getStoreSession()
    if (!session?.isAuthenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const sql = getSql()

    // Ensure products table exists
    await ensureProductsTable(sql)

    const items = await sql`select id, store_id, name, coalesce(category,'General') as category, custom_id, (price::float8) as price, coalesce(stock,1)::int as stock from products where store_id = ${session.storeId} order by id desc`
    const categoryCounts = await sql`select coalesce(category,'General') as category, count(*)::int as count, sum(coalesce(stock,1))::int as total_stock from products where store_id = ${session.storeId} group by category order by category`

    return NextResponse.json({ items: items as any, categoryCounts: categoryCounts as any })
  } catch (err) {
    console.error("Products GET error", err)
    const errorMessage = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json(
      { error: "Internal server error", details: errorMessage },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const csrf = enforceSameOrigin(request)
    if (!csrf.ok) {
      return NextResponse.json({ error: csrf.reason }, { status: 403 })
    }

    const session = await getStoreSession()
    if (!session?.isAuthenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const { name, category, customId, price, quantity } = await request.json()
    if (!name || !category || !customId || typeof price !== "number" || !quantity || quantity < 1) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
    }
    const sql = getSql()
    
    // Ensure products table exists
    await ensureProductsTable(sql)

    // Check if custom ID already exists for this store
    const existing = await sql`select 1 from products where store_id = ${session.storeId} and custom_id = ${customId} limit 1`
    if (existing.length > 0) {
      return NextResponse.json({ error: "Custom ID already exists" }, { status: 400 })
    }

    // Insert N rows with sequential IDs
    for (let i = 0; i < quantity; i++) {
      let sequentialId = customId
      
      // Generate sequential ID if quantity > 1
      if (quantity > 1) {
        // Extract base ID and number
        const baseMatch = customId.match(/^(.+?)(\d+)$/)
        if (baseMatch) {
          const base = baseMatch[1]
          const startNum = parseInt(baseMatch[2])
          sequentialId = `${base}${String(startNum + i).padStart(baseMatch[2].length, '0')}`
        } else {
          // If no number at end, add sequential numbers
          sequentialId = `${customId}${String(i + 1).padStart(2, '0')}`
        }
      }
      
      await sql`insert into products (store_id, name, category, custom_id, price, stock) values (${session.storeId}, ${name}, ${category}, ${sequentialId}, ${price}, 1)`
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("Products POST error", err)
    const errorMessage = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json(
      { error: "Internal server error", details: errorMessage },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const csrf = enforceSameOrigin(request)
    if (!csrf.ok) {
      return NextResponse.json({ error: csrf.reason }, { status: 403 })
    }

    const session = await getStoreSession()
    if (!session?.isAuthenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const { id, name, customId, category, price } = await request.json()
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })
    const sql = getSql()
    
    // Ensure products table exists
    await ensureProductsTable(sql)

    // Check if custom ID already exists for this store (excluding current item)
    if (customId) {
      const existing = await sql`select 1 from products where store_id = ${session.storeId} and custom_id = ${customId} and id != ${id} limit 1`
      if (existing.length > 0) {
        return NextResponse.json({ error: "Custom ID already exists" }, { status: 400 })
      }
    }

    await sql`update products set name = coalesce(${name}, name), custom_id = coalesce(${customId}, custom_id), category = coalesce(${category}, category), price = coalesce(${price}, price) where id = ${id} and store_id = ${session.storeId}`
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("Products PATCH error", err)
    const errorMessage = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json(
      { error: "Internal server error", details: errorMessage },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const csrf = enforceSameOrigin(request)
    if (!csrf.ok) {
      return NextResponse.json({ error: csrf.reason }, { status: 403 })
    }

    const session = await getStoreSession()
    if (!session?.isAuthenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const { id } = await request.json()
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })
    const sql = getSql()
    
    // Ensure products table exists
    await ensureProductsTable(sql)
    
    await sql`delete from products where id = ${id} and store_id = ${session.storeId}`
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("Products DELETE error", err)
    const errorMessage = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json(
      { error: "Internal server error", details: errorMessage },
      { status: 500 }
    )
  }
} 
