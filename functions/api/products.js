export async function onRequestGet(context) {
  const { results } = await context.env.DB.prepare(
    "SELECT id, name, category, purchase_price, price, quantity, initial_stock, month_tag, image_url FROM products ORDER BY category ASC, name ASC"
  ).all();
  return Response.json(results || []);
}

export async function onRequestPost(context) {
  const body = await context.request.json();
  const qty = parseInt(body.quantity, 10) || 0;
  const initialQty = parseInt(body.initial_stock, 10) || qty;
  const monthTag = body.month_tag || 'Sep 2026';

  const res = await context.env.DB.prepare(
    "INSERT INTO products (name, category, purchase_price, price, quantity, initial_stock, month_tag, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    body.name,
    body.category || 'Top Filter',
    parseFloat(body.purchase_price || 0),
    parseFloat(body.price || 0),
    qty,
    initialQty,
    monthTag,
    body.image_url || ''
  ).run();

  return Response.json({ success: true, id: res.meta.last_row_id });
}
