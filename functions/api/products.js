export async function onRequestGet(context) {
  const { results } = await context.env.DB.prepare(
    "SELECT * FROM products ORDER BY category ASC, name ASC"
  ).all();
  return Response.json(results);
}

export async function onRequestPost(context) {
  const { name, category, price, quantity, image_url } = await context.request.json();
  const res = await context.env.DB.prepare(
    "INSERT INTO products (name, category, price, quantity, image_url) VALUES (?, ?, ?, ?, ?)"
  ).bind(name, category, parseFloat(price), parseInt(quantity, 10), image_url || '').run();
  return Response.json({ success: true, id: res.meta.last_row_id });
}
