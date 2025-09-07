// api/grammar-review.js
// Vercel serverless function (Node.js 18+)
// Uses Google Gemini (generative language API)

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { question, userAnswer, correctAnswer, level } = req.body || {};
  if (!question || typeof userAnswer !== "string") {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server misconfigured: no Gemini API key" });
  }

  const systemPrompt = [
    "You are a Japanese grammar checker for JLPT N5 learners.",
    "Input: question/prompt, learner's answer, and reference correct answer (for guidance).",
    "Task: Decide if the learner's answer is correct at N5 level.",
    "Return ONLY JSON with:",
    "is_correct (bool), verdict (short string ≤120 chars　in english), better (corrected version　in hiragana or katakana, do not write in kanji),",
    "issues (array of bullet points), score (0..1)."
  ].join(" ");

  const userContent = JSON.stringify({
    question,
    userAnswer,
    correctAnswer,
    level: level || "JLPT N5"
  });

  try {
    // Gemini "generateContent" endpoint
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            { role: "user", parts: [{ text: `${systemPrompt}\n\n${userContent}` }] }
          ],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json"
          }
        })
      }
    );

    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status).json({ error: "Gemini request failed", detail: text });
    }

    const data = await r.json();
    // Gemini puts text output inside candidates[0].content.parts[0].text
    const textOut = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    let parsed;
    try { parsed = JSON.parse(textOut); } catch { parsed = null; }

    if (!parsed) {
      return res.status(502).json({ error: "Bad Gemini output", raw: textOut });
    }

    // Clean result
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
