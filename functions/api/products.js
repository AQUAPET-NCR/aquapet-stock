export async function onRequestGet(context) {
  try {
    const { results } = await context.env.DB.prepare(
      "SELECT * FROM products ORDER BY category ASC, name ASC"
    ).all();
    return Response.json(results || []);
  } catch (err) {
    return Response.json([]);
  }
}

export async function onRequestPost(context) {
  const db = context.env.DB;
  const body = await context.request.json();
  const qty = parseInt(body.quantity, 10) || 0;
  const initialQty = parseInt(body.initial_stock, 10) || qty;
  const cost = parseFloat(body.purchase_price || 0);
  const price = parseFloat(body.price || 0);
  
  try {
    const res = await db.prepare(
      "INSERT INTO products (name, category, purchase_price, price, quantity, initial_stock) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(body.name, body.category || 'General', cost, price, qty, initialQty).run();

    if (cost * qty > 0) {
      await db.prepare("INSERT INTO expenses (category, amount, description) VALUES (?, ?, ?)")
        .bind('Stock Restock', cost * qty, `Auto-Expense: ${qty}x ${body.name}`).run();
    }
    return Response.json({ success: true, id: res.meta.last_row_id });
  } catch(e) { return Response.json({ error: e.message }, { status: 500 }); }
}

export async function onRequestPatch(context) {
  const db = context.env.DB;
  const { id, add_quantity } = await context.request.json();
  const addedQty = parseInt(add_quantity, 10);

  try {
    await db.prepare("UPDATE products SET quantity = quantity + ?, initial_stock = initial_stock + ? WHERE id = ?")
      .bind(addedQty, addedQty, id).run();
    return Response.json({ success: true, added: addedQty });
  } catch(e) { return Response.json({ error: e.message }, { status: 500 }); }
}

export async function onRequestDelete(context) {
  const db = context.env.DB;
  const id = new URL(context.request.url).searchParams.get("id");
  try {
    await db.prepare("DELETE FROM products WHERE id = ?").bind(id).run();
    return Response.json({ success: true });
  } catch(e) { return Response.json({ error: e.message }, { status: 500 }); }
}
