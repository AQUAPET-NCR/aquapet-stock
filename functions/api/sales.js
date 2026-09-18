export async function onRequestPost(context) {
  const { customer_name, customer_phone, items, total_amount, payment_mode, is_direct_sale } = await context.request.json();
  const db = context.env.DB;

  const saleRes = await db.prepare(
    "INSERT INTO sales (customer_name, customer_phone, total_amount, payment_mode, is_direct_sale) VALUES (?, ?, ?, ?, ?)"
  ).bind(customer_name || 'Walk-in', customer_phone || '', parseFloat(total_amount), payment_mode || 'UPI', is_direct_sale ? 1 : 0).run();

  const saleId = saleRes.meta.last_row_id;

  if (items && items.length > 0) {
    for (const item of items) {
      await db.prepare(
        "INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price) VALUES (?, ?, ?, ?, ?)"
      ).bind(saleId, item.id, item.name, parseInt(item.quantity, 10), parseFloat(item.price)).run();

      await db.prepare(
        "UPDATE products SET quantity = MAX(0, quantity - ?) WHERE id = ?"
      ).bind(parseInt(item.quantity, 10), item.id).run();
    }
  }

  return Response.json({ success: true, saleId });
}
