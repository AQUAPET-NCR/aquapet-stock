export async function onRequestPost(context) {
  const { question } = await context.request.json();
  const db = context.env.DB;

  if (!question || question.trim().length === 0) {
    return Response.json({ answer: "Please ask a question about your inventory or sales." });
  }

  // Create rate limit table if not present
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS ai_rate_limits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // Check calls in the last 60 minutes (Max 20 calls/hour to stay well within free limits)
  const rateCheck = await db.prepare(`
    SELECT COUNT(*) as count FROM ai_rate_limits 
    WHERE created_at >= datetime('now', '-1 hour')
  `).first();

  if (rateCheck && rateCheck.count >= 20) {
    return Response.json({ 
      answer: "Hourly AI query limit reached (20/hr) to protect your free tier. Please try again in a bit!" 
    });
  }

  // Record this query
  await db.prepare("INSERT INTO ai_rate_limits DEFAULT VALUES").run();

  // Pull live metrics for context
  const stockSnapshot = await db.prepare("SELECT name, category, price, quantity FROM products WHERE quantity < 8 LIMIT 12").all();
  const financeSnapshot = await db.prepare(`
    SELECT 
      (SELECT COALESCE(SUM(total_amount),0) FROM sales WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime')) as today_sales,
      (SELECT COALESCE(SUM(total_amount),0) FROM sales) as total_sales,
      (SELECT COALESCE(SUM(amount),0) FROM expenses) as total_expenses,
      (SELECT COALESCE(SUM(price * quantity),0) FROM products) as inventory_valuation
  `).first();

  const contextPrompt = `You are Aquapet AI, the executive store assistant for Mittar's pet shop Aquapet.
Store Real-time Financials:
- Today's Gross Sales: ₹${financeSnapshot.today_sales}
- Total Lifetime Sales: ₹${financeSnapshot.total_sales}
- Total Lifetime Shop Expenses: ₹${financeSnapshot.total_expenses}
- Net Profit: ₹${financeSnapshot.total_sales - financeSnapshot.total_expenses}
- Total Inventory Value on Hand: ₹${financeSnapshot.inventory_valuation}
- Critical Stock Items: ${JSON.stringify(stockSnapshot.results)}

Answer Mittar's query concisely and directly in 2 sentences max. Use Indian Rupee (₹). Give clear operational insights.`;

  try {
    const response = await context.env.AI.run('@cf/meta/llama-3-8b-instruct', {
      messages: [
        { role: 'system', content: contextPrompt },
        { role: 'user', content: question.trim() }
      ]
    });
    return Response.json({ answer: response.response });
  } catch (err) {
    return Response.json({ 
      answer: `Current Sales: ₹${financeSnapshot.today_sales}. Stock Value: ₹${financeSnapshot.inventory_valuation}. Net Profit: ₹${financeSnapshot.total_sales - financeSnapshot.total_expenses}.` 
    });
  }
}
