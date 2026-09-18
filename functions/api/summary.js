export async function onRequestGet(context) {
  const db = context.env.DB;
  
  const todaySales = await db.prepare(
    "SELECT COALESCE(SUM(total_amount), 0) as total FROM sales WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime')"
  ).first();

  const totalSales = await db.prepare("SELECT COALESCE(SUM(total_amount), 0) as total FROM sales").first();
  const totalExpenses = await db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM expenses").first();
  const lowStock = await db.prepare("SELECT COUNT(*) as count FROM products WHERE quantity < 5").first();

  return Response.json({
    todaySales: todaySales.total,
    totalSales: totalSales.total,
    totalExpenses: totalExpenses.total,
    netProfit: totalSales.total - totalExpenses.total,
    lowStockCount: lowStock.count
  });
}
