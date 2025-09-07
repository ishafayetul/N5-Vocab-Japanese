// api/grammar-review.js
// Vercel serverless function (Node.js 18+)

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { question, userAnswer, correctAnswer, level } = req.body || {};
    if (!question || typeof userAnswer !== "string") {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Server misconfigured: no API key" });
    }

    const systemPrompt = [
      "You are a Japanese grammar checker for JLPT N5 learners.",
      "You will receive: the question/prompt, the learner's answer, and a reference correct answer (for guidance).",
      "Evaluate if the learner's answer is acceptable for N5 level.",
      "Allow small variations if they are correct in Japanese.",
      "Return ONLY JSON with keys:",
      "is_correct (bool), verdict (≤120 chars), better (corrected version),",
      "issues (array of bullet points), score (0..1)."
    ].join(" ");

    const userContent = JSON.stringify({
      question,
      userAnswer,
      correctAnswer,
      level: level || "JLPT N5"
    });

    // --- Chat Completions API (fix for unsupported_parameter) ---
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        // Ask for structured JSON back
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent }
        ],
        temperature: 0.2
      })
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status).json({
        error: "OpenAI request failed",
        detail: text.slice(0, 800)
      });
    }

    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    let parsed;
    try { parsed = JSON.parse(content); } catch { parsed = null; }
    if (!parsed || typeof parsed !== "object") {
      return res.status(502).json({ error: "Bad model output" });
    }

    // Sanitize / clamp
    parsed.is_correct = !!parsed.is_correct;
    parsed.verdict = String(parsed.verdict || "").slice(0, 120);
    parsed.better = String(parsed.better || "");
    parsed.issues = Array.isArray(parsed.issues) ? parsed.issues.slice(0, 6) : [];
    parsed.score = Math.max(0, Math.min(1, Number(parsed.score || 0)));

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: "Server error", detail: err?.message || String(err) });
  }
}
