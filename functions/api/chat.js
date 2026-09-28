export async function onRequestPost(context) {
  const { question } = await context.request.json();
  const db = context.env.DB;

  if (!question || question.trim().length === 0) {
    return Response.json({ answer: "Please ask a question or enter a shop command." });
  }

  // 1. Rate Limit Protection (20 queries/hour)
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
    return Response.json({ 
      answer: "Hourly AI query limit reached (20/hr) to protect your free tier. Please try again shortly." 
    });
  }

  await db.prepare("INSERT INTO ai_rate_limits DEFAULT VALUES").run();

  // 2. Fetch Catalog & Financial Snapshots for Agent Context
  const { results: allProducts } = await db.prepare(
    "SELECT id, name, category, purchase_price, price, quantity FROM products"
  ).all();

  const financeSnapshot = await db.prepare(`
    SELECT 
      (SELECT COALESCE(SUM(total_amount),0) FROM sales WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime')) as today_sales,
      (SELECT COALESCE(SUM(total_amount),0) FROM sales) as total_sales,
      (SELECT COALESCE(SUM(amount),0) FROM expenses) as total_expenses,
      (SELECT COALESCE(SUM(price * quantity),0) FROM products) as inventory_valuation
  `).first();

  // Compact catalog summary for prompt
  const productContext = (allProducts || []).map(p => `${p.id}:${p.name}(₹${p.price},stock:${p.quantity})`).join("; ");

  const systemParserPrompt = `You are the executive command parser for Aquapet store POS.
Available Products (id:name:price:stock):
${productContext}

Evaluate user prompt: "${question.trim()}"

Output ONLY a valid JSON object matching one of these structures without markdown:

Case A: Bill creation
{"action":"create_bill","customer":"Name","phone":"Phone or N/A","discount_percent":0|10|15,"items":[{"id":number,"quantity":number}]}

Case B: Add new item to stock
{"action":"add_stock","name":"Item Name","category":"Fish|Top Filter|Biomedia|Toys","cost":number,"price":number,"quantity":number}

Case C: Record mortality loss (fish death / broken item)
{"action":"record_loss","item_query":"name fragment","quantity":number}

Case D: Customer details inquiry
{"action":"customer_lookup","query":"Name or phone fragment"}

Case E: General question, stock query, or financial inquiry
{"action":"chat"}`;

  try {
    const aiParse = await context.env.AI.run('@cf/meta/llama-3-8b-instruct', {
      messages: [
        { role: 'system', content: 'You are a strict JSON command router. Output valid JSON only, no backticks, no prose.' },
        { role: 'user', content: systemParserPrompt }
      ]
    });

    let rawText = (aiParse.response || '').trim();
    if (rawText.startsWith('```json')) rawText = rawText.replace(/```json|```/g, '').trim();
    if (rawText.startsWith('```')) rawText = rawText.replace(/```/g, '').trim();

    let parsed = null;
    try {
      parsed = JSON.parse(rawText);
    } catch (e) {
      parsed = { action: 'chat' };
    }

    // --- CASE A: CONVERSATIONAL BILLING ---
    if (parsed && parsed.action === 'create_bill' && Array.isArray(parsed.items) && parsed.items.length > 0) {
      let finalItems = [];
      let subtotal = 0;

      for (const reqItem of parsed.items) {
        const prod = (allProducts || []).find(p => p.id == reqItem.id);
        if (prod && reqItem.quantity > 0) {
          const qty = Math.min(reqItem.quantity, prod.quantity > 0 ? prod.quantity : reqItem.quantity);
          finalItems.push({
            id: prod.id,
            name: prod.name,
            quantity: qty,
            price: prod.price
          });
          subtotal += prod.price * qty;
        }
      }

      if (finalItems.length === 0) {
        return Response.json({ answer: "I couldn't match the items in your request to existing inventory." });
      }

      const discPct = parsed.discount_percent || 0;
      const discountVal = (subtotal * discPct) / 100;
      const totalAmount = Math.max(0, Math.round(subtotal - discountVal));
      const customerName = parsed.customer || 'Walk-in Customer';
      const customerPhone = parsed.phone || 'N/A';

      // Insert Sale
      const saleRes = await db.prepare(
        "INSERT INTO sales (customer_name, customer_phone, total_amount, payment_mode, is_direct_sale) VALUES (?, ?, ?, 'Cash', 0)"
      ).bind(customerName, customerPhone, totalAmount).run();

      const saleId = saleRes.meta.last_row_id;

      // Insert Sale Items & Deduct Stock
      for (const item of finalItems) {
        await db.prepare(
          "INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price) VALUES (?, ?, ?, ?, ?)"
        ).bind(saleId, item.id, item.name, item.quantity, item.price).run();

        await db.prepare(
          "UPDATE products SET quantity = MAX(0, quantity - ?) WHERE id = ?"
        ).bind(item.quantity, item.id).run();
      }

      return Response.json({
        answer: `Bill #${saleId} created for ${customerName} (Total: ₹${totalAmount}). Stock deducted.`,
        executedAction: "bill_created",
        billData: {
          saleId: saleId,
          date: new Date().toLocaleString('en-IN'),
          customer: customerName,
          phone: customerPhone,
          items: finalItems,
          total: totalAmount,
          discount: Math.round(discountVal)
        }
      });
    }

    // --- CASE B: ADD STOCK VIA AGENT ---
    if (parsed && parsed.action === 'add_stock' && parsed.name && parsed.quantity > 0) {
      const name = parsed.name;
      const category = parsed.category || 'Top Filter';
      const cost = parseFloat(parsed.cost) || 0;
      const price = parseFloat(parsed.price) || 0;
      const qty = parseInt(parsed.quantity, 10);
      const totalCost = cost * qty;

      await db.prepare(
        "INSERT INTO products (name, category, purchase_price, price, quantity, initial_stock, month_tag) VALUES (?, ?, ?, ?, ?, ?, 'Sep 2026')"
      ).bind(name, category, cost, price, qty, qty).run();

      if (totalCost > 0) {
        const expCat = (category === 'Fish') ? 'Breeder Stock' : 'Stock Restock';
        await db.prepare(
          "INSERT INTO expenses (category, amount, description) VALUES (?, ?, ?)"
        ).bind(expCat, totalCost, `AI Agent: Added ${qty}x ${name} @ ₹${cost}/pc`).run();
      }

      return Response.json({
        answer: `Added ${qty}x ${name} (Stock: ${qty}, Cost: ₹${cost}, Sell: ₹${price}). Expense of ₹${totalCost} logged to Balance Sheet.`,
        executedAction: "stock_updated"
      });
    }

    // --- CASE C: RECORD MORTALITY LOSS ---
    if (parsed && parsed.action === 'record_loss' && parsed.item_query) {
      const query = parsed.item_query.toLowerCase();
      const matched = (allProducts || []).find(p => p.name.toLowerCase().includes(query));
      const lossQty = parseInt(parsed.quantity, 10) || 1;

      if (!matched) {
        return Response.json({ answer: `I couldn't find an item matching "${parsed.item_query}" in your inventory.` });
      }

      const costLoss = (matched.purchase_price || 0) * lossQty;

      await db.prepare(
        "UPDATE products SET quantity = MAX(0, quantity - ?) WHERE id = ?"
      ).bind(lossQty, matched.id).run();

      await db.prepare(
        "INSERT INTO expenses (category, amount, description) VALUES ('Mortality Loss', ?, ?)"
      ).bind(costLoss, `Tank Loss: ${lossQty}x ${matched.name} (Wholesale Loss: ₹${costLoss})`).run();

      return Response.json({
        answer: `Logged mortality loss for ${lossQty}x ${matched.name}. Stock updated (${Math.max(0, matched.quantity - lossQty)} remaining), ₹${costLoss} recorded under Mortality Loss.`,
        executedAction: "stock_updated"
      });
    }

    // --- CASE D: CUSTOMER LOOKUP ---
    if (parsed && parsed.action === 'customer_lookup' && parsed.query) {
      const q = `%${parsed.query.toLowerCase()}%`;
      const { results: custSales } = await db.prepare(
        "SELECT id, customer_name, customer_phone, total_amount, created_at FROM sales WHERE LOWER(customer_name) LIKE ? OR customer_phone LIKE ? ORDER BY id DESC LIMIT 10"
      ).bind(q, q).all();

      if (!custSales || custSales.length === 0) {
        return Response.json({ answer: `No customer records found matching "${parsed.query}".` });
      }

      const totalSpent = custSales.reduce((acc, s) => acc + (s.total_amount || 0), 0);
      const name = custSales[0].customer_name;
      const phone = custSales[0].customer_phone;

      return Response.json({
        answer: `Customer ${name} (${phone}) has made ${custSales.length} purchase(s) totaling ₹${totalSpent}. Latest bill: ₹${custSales[0].total_amount} on ${new Date(custSales[0].created_at).toLocaleDateString()}.`,
        executedAction: "customer_found",
        customerPhone: phone !== 'N/A' ? phone : null
      });
    }

    // --- CASE E: GENERAL ADVISORY & STOCK LOOKUPS ---
    const advisePrompt = `You are Aquapet AI store copilot.
Current Store Financials:
- Today's Sales: ₹${financeSnapshot.today_sales}
- Total Sales: ₹${financeSnapshot.total_sales}
- Total Expenses: ₹${financeSnapshot.total_expenses}
- Net Profit: ₹${financeSnapshot.total_sales - financeSnapshot.total_expenses}
- Inventory Value: ₹${financeSnapshot.inventory_valuation}
Inventory Snapshot:
${productContext}

Answer Mittar's query concisely and directly in 2 sentences max. Use Indian Rupee (₹).`;

    const chatResponse = await context.env.AI.run('@cf/meta/llama-3-8b-instruct', {
      messages: [
        { role: 'system', content: advisePrompt },
        { role: 'user', content: question.trim() }
      ]
    });

    return Response.json({ answer: chatResponse.response, executedAction: "chat" });

  } catch (err) {
    return Response.json({ answer: "I couldn't process that command. Check network connectivity." });
  }
}
