export async function onRequestGet(context) {
  const { results } = await context.env.DB.prepare(
    "SELECT id, name, category, purchase_price, price, quantity, image_url FROM products ORDER BY category ASC, name ASC"
  ).all();
  return Response.json(results || []);
}

export async function onRequestPost(context) {
  const { name, category, purchase_price, price, quantity, image_url } = await context.request.json();
  const res = await context.env.DB.prepare(
    "INSERT INTO products (name, category, purchase_price, price, quantity, image_url) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(
    name,
    category,
    parseFloat(purchase_price || 0),
    parseFloat(price || 0),
    parseInt(quantity, 10) || 0,
    image_url || ''
  ).run();
  return Response.json({ success: true, id: res.meta.last_row_id });
}
