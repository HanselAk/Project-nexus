exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Use POST" }) };
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing OPENAI_API_KEY" }) };
    }

    const body = JSON.parse(event.body || "{}");
    const prompt = body.prompt;
    const model = body.model || "gpt-4.1-mini";

    if (!prompt || typeof prompt !== "string") {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing prompt (string)" }) };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: prompt,
        temperature: 0.7,
        max_output_tokens: 1400,
      }),
    });

    clearTimeout(timeout);

    const data = await r.json();

    if (!r.ok) {
      return { statusCode: r.status, headers, body: JSON.stringify({ error: data }) };
    }

    let text = "";

    if (typeof data.output_text === "string") text = data.output_text;

    if (!text && Array.isArray(data.output)) {
      const chunks = [];
      for (const item of data.output) {
        if (Array.isArray(item.content)) {
          for (const c of item.content) {
            if (c && typeof c.text === "string") chunks.push(c.text);
          }
        }
        if (item && typeof item.text === "string") chunks.push(item.text);
      }
      text = chunks.join("\n").trim();
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ideasText: text || "" }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(e) }) };
  }
};
