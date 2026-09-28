export async function onRequestPost(context) {
  const { question } = await context.request.json();
  const db = context.env.DB;

  if (!question || question.trim().length === 0) {
    return Response.json({ answer: "Please ask a question or enter a shop command." });
  }

  const cleanQuery = question.trim().toLowerCase();

  // 1. FAST-PATH: Specific Category / Fish Inquiries (Live SQL execution)
  if (cleanQuery.includes("fish") && (cleanQuery.includes("how many") || cleanQuery.includes("stock") || cleanQuery.includes("list") || cleanQuery.includes("available"))) {
    const { results: fishes } = await db.prepare(
      "SELECT name, quantity, price FROM products WHERE LOWER(category) = 'fish' AND quantity > 0"
    ).all();

    if (!fishes || fishes.length === 0) {
      return Response.json({ answer: "No fish currently recorded in stock.", executedAction: "chat" });
    }

    const totalUnits = fishes.reduce((acc, f) => acc + (f.quantity || 0), 0);
    const fishList = fishes.map(f => `${f.name}: ${f.quantity} pcs (₹${f.price})`).join(", ");
    return Response.json({
      answer: `You have ${totalUnits} fish in stock across ${fishes.length} varieties: ${fishList}.`,
      executedAction: "chat"
    });
  }

  // 2. FAST-PATH: General Overall Stock Lookups
  if (
    cleanQuery.includes("how much stock") || 
    cleanQuery.includes("stock left") || 
    cleanQuery.includes("total stock") ||
    cleanQuery.includes("remaining stock")
  ) {
    const stats = await db.prepare(`
      SELECT 
        COUNT(*) as total_items,
        COALESCE(SUM(quantity), 0) as total_units,
        COALESCE(SUM(quantity * price), 0) as total_value,
        (SELECT COUNT(*) FROM products WHERE quantity <= 0) as out_of_stock,
        (SELECT COUNT(*) FROM products WHERE quantity <= 2 AND quantity > 0) as low_stock
      FROM products
    `).first();

    return Response.json({
      answer: `You have ${stats.total_units} total units in stock across ${stats.total_items} items (Retail Value: ₹${stats.total_value}). ${stats.low_stock} items are running low and ${stats.out_of_stock} are depleted.`,
      executedAction: "chat"
    });
  }

  // 3. FAST-PATH: Direct Customer Lookups
  if (cleanQuery.startsWith("who is") || cleanQuery.includes("customer")) {
    const words = cleanQuery.replace(/who is|customer|details|spend|spent|\?/gi, "").trim();
    if (words.length > 1) {
      const q = `%${words}%`;
      const { results: custSales } = await db.prepare(
        "SELECT id, customer_name, customer_phone, total_amount, created_at FROM sales WHERE LOWER(customer_name) LIKE ? OR customer_phone LIKE ? ORDER BY id DESC LIMIT 5"
      ).bind(q, q).all();

      if (custSales && custSales.length > 0) {
        const total = custSales.reduce((a, b) => a + (b.total_amount || 0), 0);
        return Response.json({
          answer: `Found ${custSales[0].customer_name} (${custSales[0].customer_phone}): ${custSales.length} bill(s) recorded, total lifetime spend ₹${total}.`,
          executedAction: "customer_found",
          customerPhone: custSales[0].customer_phone !== 'N/A' ? custSales[0].customer_phone : null
        });
      }
    }
  }

  // 4. Rate Limit Protection
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS ai_rate_limits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  const rateCheck = await db.prepare(`
    SELECT COUNT(*) as count FROM ai_rate_limits 
    WHERE created_at >= datetime('now', '-1 hour')
  `).first();

  if (rateCheck && rateCheck.count >= 20) {
    return Response.json({ answer: "Hourly AI query limit reached (20/hr). Direct lookups still work!" });
  }
  await db.prepare("INSERT INTO ai_rate_limits DEFAULT VALUES").run();

  // 5. Financial Snapshot Context
  const finance = await db.prepare(`
    SELECT 
      (SELECT COALESCE(SUM(total_amount),0) FROM sales WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime')) as today,
      (SELECT COALESCE(SUM(total_amount),0) FROM sales) as total_rev,
      (SELECT COALESCE(SUM(amount),0) FROM expenses) as total_exp,
      (SELECT COALESCE(SUM(price * quantity),0) FROM products) as inv_val,
      (SELECT COUNT(*) FROM products WHERE quantity <= 0) as out_count
  `).first();

  const systemPrompt = `You are Aquapet AI store copilot for Mittar.
Store Metrics: Today Sales: ₹${finance.today}, Total Sales: ₹${finance.total_rev}, Total Exp: ₹${finance.total_exp}, Net Profit: ₹${finance.total_rev - finance.total_exp}, Inventory Value: ₹${finance.inv_val}, Depleted Items: ${finance.out_count}.

If user wants to ADD A PRODUCT (e.g. "Add 10 Oscars bought at 400 sold at 800"), output ONLY:
{"action":"add_stock","name":"Item Name","category":"Fish|Top Filter|Biomedia|Toys","cost":number,"price":number,"quantity":number}

If user wants to RECORD MORTALITY/LOSS (e.g. "Mark 2 Oscars dead"), output ONLY:
{"action":"record_loss","item_query":"name","quantity":number}

If user wants to BILL/INVOICE, output ONLY:
{"action":"create_bill","customer":"Name","phone":"Phone","discount":0,"item_name":"name","quantity":number}

Otherwise, answer directly in 1-2 short sentences using ₹. Do not output JSON for standard queries.`;

  try {
    const aiResponse = await context.env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question.trim() }
      ]
    });

    let raw = (aiResponse.response || '').trim();

    if (raw.includes('{"action"')) {
      const jsonStart = raw.indexOf('{');
      const jsonEnd = raw.lastIndexOf('}') + 1;
      const parsed = JSON.parse(raw.substring(jsonStart, jsonEnd));

      if (parsed.action === 'add_stock' && parsed.name && parsed.quantity > 0) {
        const cost = parseFloat(parsed.cost) || 0;
        const price = parseFloat(parsed.price) || 0;
        const qty = parseInt(parsed.quantity, 10);
        const total = cost * qty;

        await db.prepare(
          "INSERT INTO products (name, category, purchase_price, price, quantity, initial_stock, month_tag) VALUES (?, ?, ?, ?, ?, ?, 'Sep 2026')"
        ).bind(parsed.name, parsed.category || 'Fish', cost, price, qty, qty).run();

        if (total > 0) {
          const expCat = (parsed.category === 'Fish') ? 'Breeder Stock' : 'Stock Restock';
          await db.prepare(
            "INSERT INTO expenses (category, amount, description) VALUES (?, ?, ?)"
          ).bind(expCat, total, `AI Agent: Added ${qty}x ${parsed.name} @ ₹${cost}/pc`).run();
        }

        return Response.json({
          answer: `Added ${qty}x ${parsed.name} (Stock: ${qty}, Cost: ₹${cost}, Sell: ₹${price}). Expense of ₹${total} logged to Balance Sheet.`,
          executedAction: "stock_updated"
        });
      }

      if (parsed.action === 'record_loss' && parsed.item_query) {
        const prod = await db.prepare("SELECT id, name, purchase_price, quantity FROM products WHERE LOWER(name) LIKE ? LIMIT 1")
          .bind(`%${parsed.item_query.toLowerCase()}%`).first();

        if (prod) {
          const lossQty = parseInt(parsed.quantity, 10) || 1;
          const costLoss = (prod.purchase_price || 0) * lossQty;

          await db.prepare("UPDATE products SET quantity = MAX(0, quantity - ?) WHERE id = ?").bind(lossQty, prod.id).run();
          await db.prepare("INSERT INTO expenses (category, amount, description) VALUES ('Mortality Loss', ?, ?)").bind(costLoss, `Tank Loss: ${lossQty}x ${prod.name}`).run();

          return Response.json({
            answer: `Recorded loss of ${lossQty}x ${prod.name}. Remaining: ${Math.max(0, prod.quantity - lossQty)}. Logged ₹${costLoss} under Mortality Loss.`,
            executedAction: "stock_updated"
          });
        }
      }

      if (parsed.action === 'create_bill' && parsed.item_name) {
        const prod = await db.prepare("SELECT id, name, price, quantity FROM products WHERE LOWER(name) LIKE ? LIMIT 1")
          .bind(`%${parsed.item_name.toLowerCase()}%`).first();

        if (prod) {
          const bQty = parseInt(parsed.quantity, 10) || 1;
          const totalAmt = prod.price * bQty;
          const custName = parsed.customer || 'Walk-in Customer';
          const custPhone = parsed.phone || 'N/A';

          const saleRes = await db.prepare("INSERT INTO sales (customer_name, customer_phone, total_amount, payment_mode) VALUES (?, ?, ?, 'Cash')")
            .bind(custName, custPhone, totalAmt).run();
          const saleId = saleRes.meta.last_row_id;

          await db.prepare("INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price) VALUES (?, ?, ?, ?, ?)")
            .bind(saleId, prod.id, prod.name, bQty, prod.price).run();

          await db.prepare("UPDATE products SET quantity = MAX(0, quantity - ?) WHERE id = ?").bind(bQty, prod.id).run();

          return Response.json({
            answer: `Created Bill #${saleId} for ${custName} (${bQty}x ${prod.name} = ₹${totalAmt}).`,
            executedAction: "bill_created",
            billData: {
              saleId,
              date: new Date().toLocaleString('en-IN'),
              customer: custName,
              phone: custPhone,
              items: [{ id: prod.id, name: prod.name, quantity: bQty, price: prod.price }],
              total: totalAmt,
              discount: 0
            }
          });
        }
      }
    }

    return Response.json({ answer: raw, executedAction: "chat" });

  } catch (err) {
    return Response.json({
      answer: `Total inventory value sits at ₹${finance.inv_val}, lifetime sales ₹${finance.total_rev}, and net profit ₹${finance.total_rev - finance.total_exp}.`
    });
  }
}
