export async function onRequestGet(context) {
  const { results } = await context.env.DB.prepare(
    "SELECT id, name, category, purchase_price, price, quantity, initial_stock, month_tag, image_url FROM products ORDER BY category ASC, name ASC"
  ).all();
  return Response.json(results || []);
}

export async function onRequestPost(context) {
  const db = context.env.DB;
  const body = await context.request.json();
  const qty = parseInt(body.quantity, 10) || 0;
  const initialQty = parseInt(body.initial_stock, 10) || qty;
  const purchasePrice = parseFloat(body.purchase_price || 0);
  const retailPrice = parseFloat(body.price || 0);
  const monthTag = body.month_tag || 'Sep 2026';

  // 1. Insert product into catalog
  const res = await db.prepare(
    "INSERT INTO products (name, category, purchase_price, price, quantity, initial_stock, month_tag, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    body.name,
    body.category || 'Top Filter',
    purchasePrice,
    retailPrice,
    qty,
    initialQty,
    monthTag,
    body.image_url || ''
  ).run();

  // 2. Automatically log wholesale purchase to Expenses ledger
  const totalWholesaleCost = purchasePrice * qty;
  if (totalWholesaleCost > 0) {
    const expenseCategory = (body.category === 'Fish') ? 'Breeder Stock' : 'Stock Restock';
    await db.prepare(
      "INSERT INTO expenses (category, amount, description) VALUES (?, ?, ?)"
    ).bind(
      expenseCategory,
      totalWholesaleCost,
      `Auto-Expense: Added ${qty}x ${body.name} @ ₹${purchasePrice}/pc (${monthTag})`
    ).run();
  }

  return Response.json({ success: true, id: res.meta.last_row_id });
}

export async function onRequestPatch(context) {
  const db = context.env.DB;
  const { id, add_quantity } = await context.request.json();
  const addedQty = parseInt(add_quantity, 10);

  if (!id || isNaN(addedQty) || addedQty <= 0) {
    return Response.json({ error: "Invalid restock parameters" }, { status: 400 });
  }

  // 1. Fetch current product details
  const product = await db.prepare("SELECT name, category, purchase_price FROM products WHERE id = ?").bind(id).first();
  if (!product) {
    return Response.json({ error: "Product not found" }, { status: 404 });
  }

  // 2. Update stock and initial base
  await db.prepare(
    "UPDATE products SET quantity = quantity + ?, initial_stock = initial_stock + ? WHERE id = ?"
  ).bind(addedQty, addedQty, id).run();

  // 3. Automatically append cost to Expenses ledger
  const wholesaleCost = product.purchase_price * addedQty;
  if (wholesaleCost > 0) {
    const expenseCategory = (product.category === 'Fish') ? 'Breeder Stock' : 'Stock Restock';
    await db.prepare(
      "INSERT INTO expenses (category, amount, description) VALUES (?, ?, ?)"
    ).bind(
      expenseCategory,
      wholesaleCost,
      `Auto-Expense: Restocked ${addedQty}x ${product.name} @ ₹${product.purchase_price}/pc`
    ).run();
  }

  return Response.json({ success: true, added: addedQty });
}

export async function onRequestDelete(context) {
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const id = url.searchParams.get("id");

  if (!id) {
    return Response.json({ error: "Missing product ID" }, { status: 400 });
  }

  await db.prepare("DELETE FROM products WHERE id = ?").bind(id).run();
  return Response.json({ success: true, deletedId: id });
}
