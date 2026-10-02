export async function onRequestPost(context) {
  try {
    const { imageBase64 } = await context.request.json();

    if (!imageBase64) {
      return Response.json({ error: "Missing image data" }, { status: 400 });
    }

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Strict prompt with a formatting example forces the AI to output pure JSON
    const visionPrompt = `You are a data extraction tool. Extract the handwritten ledger table into a pure JSON array.
Columns: Quantity, Item Name, Purchase Price, Retail Price, Right-hand Category.
Do NOT output any conversational text. Output ONLY the JSON array.
Example format:
[
  {"quantity": 1, "name": "NS-801", "purchase_price": 320, "price": 600, "category": "Power Head"},
  {"quantity": 4, "name": "MJ-C30 LED", "purchase_price": 128, "price": 300, "category": "Light"}
]`;

    const aiResponse = await context.env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
      image: [...bytes],
      prompt: visionPrompt,
      max_tokens: 1500
    });

    // Handle different response formats from Cloudflare AI
    let rawOutput = (aiResponse.response || aiResponse.description || aiResponse.result || '').trim();
    
    // Clean up markdown ticks if the AI includes them
    if (rawOutput.startsWith('```json')) rawOutput = rawOutput.replace(/```json/g, '').replace(/```/g, '').trim();
    if (rawOutput.startsWith('```')) rawOutput = rawOutput.replace(/```/g, '').trim();

    const jsonStart = rawOutput.indexOf('[');
    const jsonEnd = rawOutput.lastIndexOf(']') + 1;

    if (jsonStart === -1 || jsonEnd === -1) {
      return Response.json({ 
        error: "AI did not return a valid table array.", 
        raw_ai_output: rawOutput 
      }, { status: 422 });
    }

    const parsedItems = JSON.parse(rawOutput.substring(jsonStart, jsonEnd));
    return Response.json({ items: parsedItems });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
