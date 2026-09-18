export async function onRequestGet(context) {
  const db = context.env.DB;
  
  try {
    const todaySales = await db.prepare(
      "SELECT COALESCE(SUM(total_amount), 0) as total FROM sales WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime')"
    ).first();

    const totalSales = await db.prepare("SELECT COALESCE(SUM(total_amount), 0) as total FROM sales").first();
    const totalExpenses = await db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM expenses").first();
    const inventoryVal = await db.prepare("SELECT COALESCE(SUM(price * quantity), 0) as val, SUM(quantity) as total_qty FROM products").first();
    const lowStock = await db.prepare("SELECT COUNT(*) as count FROM products WHERE quantity < 5").first();

    // Expense breakdown by category
    const expenseBreakdown = await db.prepare(
      "SELECT category, SUM(amount) as total FROM expenses GROUP BY category ORDER BY total DESC"
    ).all();

    // Recent expense transactions
    const recentExpenses = await db.prepare(
      "SELECT id, category, amount, description, created_at FROM expenses ORDER BY id DESC LIMIT 20"
    ).all();

    const sToday = todaySales ? todaySales.total : 0;
    const sTotal = totalSales ? totalSales.total : 0;
    const eTotal = totalExpenses ? totalExpenses.total : 0;
    const invVal = inventoryVal ? inventoryVal.val : 0;
    const invQty = inventoryVal ? inventoryVal.total_qty : 0;

    return Response.json({
      todaySales: sToday,
      totalSales: sTotal,
      totalExpenses: eTotal,
      netProfit: sTotal - eTotal,
      inventoryValuation: invVal,
      totalInventoryUnits: invQty,
      lowStockCount: lowStock ? lowStock.count : 0,
      expenseBreakdown: expenseBreakdown.results || [],
      recentExpenses: recentExpenses.results || []
    });
  } catch (err) {
    return Response.json({
      todaySales: 0,
      totalSales: 0,
      totalExpenses: 0,
      netProfit: 0,
      inventoryValuation: 0,
      totalInventoryUnits: 0,
      lowStockCount: 0,
      expenseBreakdown: [],
      recentExpenses: []
    });
  }
}
