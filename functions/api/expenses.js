export async function onRequestGet(context) {
  const db = context.env.DB;
  try {
    const { results } = await db.prepare(
      "SELECT id, category, amount, description, product_id, quantity_added, created_at FROM expenses ORDER BY id DESC LIMIT 50"
    ).all();
    return Response.json(results || []);
  } catch (err) {
    return Response.json([]);
  }
}

export async function onRequestPost(context) {
  const db = context.env.DB;
  const body = await context.request.json();
  const category = body.category || 'Misc';
  const amount = parseFloat(body.amount) || 0;
  const description = body.description || '';

  if (amount <= 0) {
    return Response.json({ error: "Invalid amount" }, { status: 400 });
  }

  const res = await db.prepare(
    "INSERT INTO expenses (category, amount, description) VALUES (?, ?, ?)"
  ).bind(category, amount, description).run();

  return Response.json({ success: true, id: res.meta.last_row_id });
}

export async function onRequestDelete(context) {
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const id = url.searchParams.get("id");

  if (!id) {
    return Response.json({ error: "Missing expense ID" }, { status: 400 });
  }

  // 1. Check if this expense was linked to an inventory stock addition
  const exp = await db.prepare("SELECT product_id, quantity_added, description FROM expenses WHERE id = ?").bind(id).first();

  if (exp && exp.product_id && exp.quantity_added > 0) {
    // Revert/deduct the quantity that was added with this purchase
    await db.prepare(
      "UPDATE products SET quantity = MAX(0, quantity - ?), initial_stock = MAX(0, initial_stock - ?) WHERE id = ?"
    ).bind(exp.quantity_added, exp.quantity_added, exp.product_id).run();
  }

  // 2. Remove expense record
  await db.prepare("DELETE FROM expenses WHERE id = ?").bind(id).run();

  return Response.json({ 
    success: true, 
    deletedId: id, 
    stockReverted: exp && exp.product_id ? exp.quantity_added : 0 
  });
}
