// netlify/functions/generate-ideas.js

const OPENAI_URL = "https://api.openai.com/v1/responses";
const UPSTREAM_TIMEOUT_MS = 9000; // keep under Netlify timeout limits

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

function extractResponseText(data) {
  try {
    if (data?.output?.length) {
      const chunks = [];
      for (const item of data.output) {
        const content = item?.content || [];
        for (const c of content) {
          if (c?.type === "output_text" && typeof c?.text === "string") chunks.push(c.text);
        }
      }
      return chunks.join("\n").trim();
    }
  } catch {}
  if (typeof data?.output_text === "string") return data.output_text.trim();
  return "";
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (event.httpMethod !== "POST") return json(405, { error: { message: "Method not allowed. Use POST." } });

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return json(500, { error: { message: "API key not configured. Set OPENAI_API_KEY in Netlify env vars." } });
    }

    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: { message: "Invalid JSON body." } });
    }

    const model = body.model || "gpt-4.1-mini";
    const count = Number(body.count || 3);
    let prompt = String(body.prompt || "").trim();
    if (!prompt) return json(400, { error: { message: "Missing prompt." } });

    if (prompt.length > 12000) prompt = prompt.slice(0, 12000);

    // Force JSON output so your frontend can reliably read timeline/cost/etc.
    const schemaHint = `
Return ONLY valid JSON (no markdown, no backticks).
Shape:
{
  "ideas": [
    {
      "title": "string",
      "description": "string (compact, 2-4 sentences)",
      "key_components": ["string", "..."],
      "technologies": ["string", "..."],
      "challenges": ["string", "..."],
      "unique_value": "string (1-2 sentences)",
      "est_cost": "string (example: $45-$210)",
      "timeline": "string (example: Months 1-2 ...)",
      "image_prompt": "string (a visual prompt, NO text in image)"
    }
  ]
}
Generate exactly ${count} ideas in the array.
`;

    const payload = {
      model,
      input: [
        {
          role: "system",
          content:
            "You are a senior-design project advisor. Be concise. Follow the user's constraints. Output must be strictly valid JSON.",
        },
        {
          role: "user",
          content: [{ type: "input_text", text: prompt + "\n\n" + schemaHint }],
        },
      ],
      max_output_tokens: 1100, // enough for multiple compact ideas
      temperature: 0.7,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    let resp;
    try {
      resp = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const text = await resp.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return json(502, {
        error: { message: `Upstream returned non-JSON (status ${resp.status}).`, details: text.slice(0, 300) },
      });
    }

    if (!resp.ok) {
      const msg = data?.error?.message || data?.message || `OpenAI API error (${resp.status})`;
      return json(resp.status, { error: { message: msg, details: data } });
    }

    const ideasText = extractResponseText(data);
    if (!ideasText) return json(500, { error: { message: "OpenAI returned empty text.", details: data } });

    // Try parse JSON so frontend can render reliably
    let ideasJson = null;
    try {
      ideasJson = JSON.parse(ideasText);
    } catch {
      // if model ever violates format, still return the text so you can see it
      ideasJson = null;
    }

    return json(200, { ideasText, ideasJson, modelUsed: model });
  } catch (err) {
    const msg =
      err?.name === "AbortError"
        ? "Upstream timed out. Reduce idea count/detail level and try again."
        : err?.message || "Server error";
    return json(504, { error: { message: msg } });
  }
};
