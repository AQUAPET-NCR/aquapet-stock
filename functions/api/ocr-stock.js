export async function onRequestPost(context) {
  try {
    const { imageBase64 } = await context.request.json();

    if (!imageBase64) {
      return Response.json({ error: "Missing image data" }, { status: 400 });
    }

    // Convert Base64 data URL to binary array
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const visionPrompt = `Extract the handwritten ledger into a valid JSON array of objects. 
Look at the quantity, item name, cost, retail price, and right-hand category.
Keys must exactly be: "quantity" (number), "name" (string), "purchase_price" (number), "price" (number), "category" (string).
Output ONLY the raw JSON array. Start with [ and end with ]. Do not include markdown ticks.`;

    const aiResponse = await context.env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
      image: [...bytes],
      prompt: visionPrompt,
      max_tokens: 1500
    });

    let rawOutput = (aiResponse.response || '').trim();
    if (rawOutput.startsWith('```json')) rawOutput = rawOutput.replace(/```json|```/g, '').trim();
    if (rawOutput.startsWith('```')) rawOutput = rawOutput.replace(/```/g, '').trim();

    const jsonStart = rawOutput.indexOf('[');
    const jsonEnd = rawOutput.lastIndexOf(']') + 1;

    if (jsonStart === -1 || jsonEnd === -1) {
      return Response.json({ error: "AI failed to format the table. Raw output: " + rawOutput }, { status: 422 });
    }

    const parsedItems = JSON.parse(rawOutput.substring(jsonStart, jsonEnd));
    return Response.json({ items: parsedItems });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
