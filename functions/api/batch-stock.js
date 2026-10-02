export async function onRequestPost(context) {
  const db = context.env.DB;
  const { batch_date, items } = await context.request.json();

  if (!items || !Array.isArray(items) || items.length === 0) {
    return Response.json({ error: "No items supplied" }, { status: 400 });
  }

  const currentDate = batch_date || new Date().toISOString().split('T')[0];
  let totalWholesaleCost = 0;

  for (const item of items) {
    const qty = parseInt(item.quantity, 10) || 0;
    const cost = parseFloat(item.purchase_price) || 0;
    const price = parseFloat(item.price) || 0;
    const cat = item.category || 'General';

    if (qty > 0 && item.name) {
      // 1. Insert product row with batch_date
      const res = await db.prepare(
        "INSERT INTO products (name, category, purchase_price, price, quantity, initial_stock, month_tag, batch_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(item.name.trim(), cat, cost, price, qty, qty, currentDate, currentDate).run();

      const prodId = res.meta.last_row_id;
      const rowCost = cost * qty;
      totalWholesaleCost += rowCost;

      // 2. Link item-level auto-expense
      if (rowCost > 0) {
        await db.prepare(
          "INSERT INTO expenses (category, amount, description, product_id, quantity_added, batch_tag) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(
          cat === 'Fish' ? 'Breeder Stock' : 'Stock Restock',
          rowCost,
          `Auto-Batch: ${qty}x ${item.name} (${currentDate})`,
          prodId,
          qty,
          currentDate
        ).run();
      }
    }
  }

  return Response.json({
    success: true,
    totalItems: items.length,
    batchDate: currentDate,
    totalWholesaleInvested: totalWholesaleCost
  });
}
