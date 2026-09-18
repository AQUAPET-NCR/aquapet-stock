export async function onRequestPost(context) {
  const { question } = await context.request.json();
  const db = context.env.DB;

  const stockSnapshot = await db.prepare("SELECT name, category, price, quantity FROM products WHERE quantity < 10 LIMIT 15").all();
  const financeSnapshot = await db.prepare(`
    SELECT 
      (SELECT COALESCE(SUM(total_amount),0) FROM sales WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime')) as today_sales,
      (SELECT COALESCE(SUM(total_amount),0) FROM sales) as total_sales,
      (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE category = 'Breeder Stock') as breeder_expenses,
      (SELECT COALESCE(SUM(amount),0) FROM expenses) as total_expenses
  `).first();

  const contextPrompt = `You are Aquapet AI, store assistant for Mittar's pet shop Aquapet.
Store Snapshot:
- Today's Sales: ₹${financeSnapshot.today_sales}
- Total Gross Sales: ₹${financeSnapshot.total_sales}
- Total Breeder Purchases: ₹${financeSnapshot.breeder_expenses}
- Total Shop Expenses: ₹${financeSnapshot.total_expenses}
- Low/Key Stock: ${JSON.stringify(stockSnapshot.results)}

Answer Mittar's question directly, clearly, and concisely in 2 sentences max. Use Indian Rupee (₹).`;

  try {
    const response = await context.env.AI.run('@cf/meta/llama-3-8b-instruct', {
      messages: [
        { role: 'system', content: contextPrompt },
        { role: 'user', content: question }
      ]
    });
    return Response.json({ answer: response.response });
  } catch (err) {
    return Response.json({ answer: `Today's sales are ₹${financeSnapshot.today_sales}. Low stock alerts: ${stockSnapshot.results.map(r => r.name + ' (' + r.quantity + ')').join(', ')}.` });
  }
}
