import { NextRequest, NextResponse } from "next/server"
import { getStoreSession } from "@/lib/auth"
import { neon } from "@neondatabase/serverless"
import { enforceSameOrigin } from "@/lib/security"

function getSql() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set")
  return neon(url)
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

    const formData = await request.formData()
    const file = formData.get('file') as File
    
    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 })
    }

    // Validate file type - Only CSV for now to avoid xlsx dependency issues
    const allowedTypes = [
      'text/csv',
      'application/csv'
    ]
    
    if (!allowedTypes.includes(file.type) && !file.name.toLowerCase().endsWith('.csv')) {
      return NextResponse.json({ error: "Invalid file type. Please upload CSV files only." }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    let jsonData: any[] = []

    // Parse CSV file with better CSV handling
    const text = new TextDecoder().decode(arrayBuffer)
    const lines = text.split(/\r?\n/).filter(line => line.trim())
    
    if (lines.length < 2) {
      return NextResponse.json({ error: "File must contain at least a header row and one data row." }, { status: 400 })
    }
    
    // Parse CSV headers - handle quoted values better
    const parseCSVLine = (line: string): string[] => {
      const result: string[] = []
      let current = ''
      let inQuotes = false
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i]
        if (char === '"') {
          inQuotes = !inQuotes
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim())
          current = ''
        } else {
          current += char
        }
      }
      result.push(current.trim())
      return result
    }
    
    const headers = parseCSVLine(lines[0]).map(h => h.replace(/"/g, '').toLowerCase())
    
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]).map(v => v.replace(/"/g, ''))
      const row: any = {}
      headers.forEach((header, index) => {
        row[header] = values[index] || ''
      })
      jsonData.push(row)
    }

    // Validate required columns
    const requiredColumns = ['name', 'category', 'customid', 'price', 'quantity']
    const sampleRow = jsonData[0]
    if (!sampleRow) {
      return NextResponse.json({ error: "File is empty" }, { status: 400 })
    }

    const hasRequiredColumns = requiredColumns.every(col => 
      Object.keys(sampleRow).some(key => key.toLowerCase().includes(col))
    )

    if (!hasRequiredColumns) {
      return NextResponse.json({ 
        error: "Missing required columns. File must contain: name, category, customid, price, quantity" 
      }, { status: 400 })
    }

    const sql = getSql()
    
    // Ensure columns exist
    await sql`alter table products add column if not exists category varchar(100) default 'General'`
    await sql`alter table products add column if not exists custom_id varchar(50)`
    await sql`alter table products add column if not exists stock integer default 1`

    let successCount = 0
    let errorCount = 0
    const errors: string[] = []

    for (const row of jsonData) {
      try {
        // Map columns (case insensitive)
        const name = row.name || row.Name || row.NAME || ''
        const category = row.category || row.Category || row.CATEGORY || 'General'
        const customId = row.customid || row.customId || row.CustomID || row.CUSTOMID || ''
        const price = parseFloat(row.price || row.Price || row.PRICE || '0')
        const quantity = parseInt(row.quantity || row.Quantity || row.QUANTITY || '1')

        if (!name || !customId || isNaN(price) || isNaN(quantity) || quantity < 1) {
          const missingFields = []
          if (!name) missingFields.push('name')
          if (!customId) missingFields.push('customid')
          if (isNaN(price)) missingFields.push('price')
          if (isNaN(quantity) || quantity < 1) missingFields.push('quantity')
          
          errors.push(`Row ${successCount + errorCount + 1}: Missing or invalid data for fields: ${missingFields.join(', ')}`)
          errorCount++
          continue
        }

        // Check if custom ID already exists for this store
        const existing = await sql`select 1 from products where store_id = ${session.storeId} and custom_id = ${customId} limit 1`
        if (existing.length > 0) {
          errors.push(`Row ${successCount + errorCount + 1}: Custom ID "${customId}" already exists`)
          errorCount++
          continue
        }

        // Insert items with sequential IDs (one row per quantity)
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
        
        successCount++
      } catch (error) {
        errors.push(`Row ${successCount + errorCount + 1}: ${error}`)
        errorCount++
      }
    }

    if (successCount === 0) {
      return NextResponse.json({
        success: false,
        message: `No products were uploaded successfully. ${errorCount} errors occurred.`,
        successCount,
        errorCount,
        errors: errors.slice(0, 10)
      }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      message: `Upload completed successfully! ${successCount} products added${errorCount > 0 ? `, ${errorCount} rows had errors` : ''}.`,
      successCount,
      errorCount,
      errors: errors.slice(0, 10) // Limit error messages
    })

  } catch (error) {
    console.error("Bulk upload error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
