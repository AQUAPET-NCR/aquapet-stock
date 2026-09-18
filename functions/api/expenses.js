export async function onRequestGet(context) {
  const { results } = await context.env.DB.prepare(
    "SELECT * FROM expenses ORDER BY created_at DESC LIMIT 50"
  ).all();
  return Response.json(results);
}

export async function onRequestPost(context) {
  const { category, amount, description } = await context.request.json();
  await context.env.DB.prepare(
    "INSERT INTO expenses (category, amount, description) VALUES (?, ?, ?)"
  ).bind(category, parseFloat(amount), description || '').run();
  return Response.json({ success: true });
}
