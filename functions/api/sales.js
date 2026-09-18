export async function onRequestGet(context) {
  const db = context.env.DB;
  try {
    const { results } = await db.prepare(
      "SELECT id, customer_name, customer_phone, total_amount, payment_mode, created_at FROM sales ORDER BY id DESC LIMIT 50"
    ).all();
    return Response.json(results || []);
  } catch (err) {
    return Response.json([]);
  }
}

export async function onRequestPost(context) {
  const body = await context.request.json();
  const db = context.env.DB;

  const customerName = (body.customer_name && body.customer_name.trim().length > 0) 
    ? body.customer_name.trim() 
    : 'Walk-in Customer';
  const customerPhone = (body.customer_phone && body.customer_phone.trim().length > 0) 
    ? body.customer_phone.trim() 
    : 'N/A';
  const totalAmount = parseFloat(body.total_amount) || 0;
  const paymentMode = body.payment_mode || 'Cash';
  const isDirect = body.is_direct_sale ? 1 : 0;

  const saleRes = await db.prepare(
    "INSERT INTO sales (customer_name, customer_phone, total_amount, payment_mode, is_direct_sale) VALUES (?, ?, ?, ?, ?)"
  ).bind(customerName, customerPhone, totalAmount, paymentMode, isDirect).run();

  const saleId = saleRes.meta.last_row_id;

  if (body.items && body.items.length > 0) {
    for (const item of body.items) {
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

export async function onRequestDelete(context) {
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const id = url.searchParams.get("id");

  if (!id) {
    return Response.json({ error: "Missing sale ID" }, { status: 400 });
  }

  // 1. Fetch items sold under this bill to restore stock
  const { results: items } = await db.prepare(
    "SELECT product_id, quantity FROM sale_items WHERE sale_id = ?"
  ).bind(id).all();

  // 2. Put stock back into products table
  if (items && items.length > 0) {
    for (const item of items) {
      await db.prepare(
        "UPDATE products SET quantity = quantity + ? WHERE id = ?"
      ).bind(item.quantity, item.product_id).run();
    }
  }

  // 3. Delete sale items and sale record
  await db.prepare("DELETE FROM sale_items WHERE sale_id = ?").bind(id).run();
  await db.prepare("DELETE FROM sales WHERE id = ?").bind(id).run();

  return Response.json({ success: true, reversedId: id });
}
