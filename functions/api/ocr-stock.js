export async function onRequestPost(context) {
  try {
    const { imageBase64 } = await context.request.json();

    if (!imageBase64) {
      return Response.json({ error: "Missing image data" }, { status: 400 });
    }

    // Convert Base64 data URL to binary array for Workers AI Vision
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const visionPrompt = `You are a ledger OCR scanner for an Indian pet and aquarium business.
Analyze the handwritten Day Book register image.
Columns on the left represent:
- Quantity (first column)
- Particulars / Item Name (second column)
- Purchase/Wholesale Price (Folio/Cost)
- Retail Selling Price (Amount Rs.)
The right side lists category tags (such as: Power Head, Light, Aquarium, Fish Food, Medicine, Plant Fertilizer, Fish Medicine, Heater, Biomedia, Toys, Filter).

Extract EVERY product row into a valid JSON array of objects with the exact schema:
[
  {
    "quantity": number,
    "name": "Item Name",
    "purchase_price": number,
    "price": number,
    "category": "Exact Category Tag from page"
  }
]
Output ONLY raw JSON. No explanations, no markdown formatting.`;

    const aiResponse = await context.env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
      image: [...bytes],
      prompt: visionPrompt,
      max_tokens: 2048
    });

    let rawOutput = (aiResponse.response || '').trim();
    if (rawOutput.startsWith('```json')) rawOutput = rawOutput.replace(/```json|```/g, '').trim();
    if (rawOutput.startsWith('```')) rawOutput = rawOutput.replace(/```/g, '').trim();

    const jsonStart = rawOutput.indexOf('[');
    const jsonEnd = rawOutput.lastIndexOf(']') + 1;

    if (jsonStart === -1 || jsonEnd === -1) {
      return Response.json({ error: "Failed to extract structured ledger rows." }, { status: 422 });
    }

    const parsedItems = JSON.parse(rawOutput.substring(jsonStart, jsonEnd));
    return Response.json({ items: parsedItems });

  } catch (err) {
    return Response.json({ error: "Vision processing error: " + err.message }, { status: 500 });
  }
}
