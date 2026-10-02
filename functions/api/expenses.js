export async function onRequestGet(context) {
  try {
    const { results } = await context.env.DB.prepare(
      "SELECT * FROM expenses ORDER BY id DESC LIMIT 50"
    ).all();
    return Response.json(results || []);
  } catch (err) {
    return Response.json([]);
  }
}

export async function onRequestPost(context) {
  const db = context.env.DB;
  const body = await context.request.json();
  try {
    const res = await db.prepare("INSERT INTO expenses (category, amount, description) VALUES (?, ?, ?)")
      .bind(body.category || 'Misc', parseFloat(body.amount) || 0, body.description || '').run();
    return Response.json({ success: true, id: res.meta.last_row_id });
  } catch(e) { return Response.json({ error: e.message }, { status: 500 }); }
}

export async function onRequestDelete(context) {
  const db = context.env.DB;
  const id = new URL(context.request.url).searchParams.get("id");
  try {
    await db.prepare("DELETE FROM expenses WHERE id = ?").bind(id).run();
    return Response.json({ success: true });
  } catch(e) { return Response.json({ error: e.message }, { status: 500 }); }
}
