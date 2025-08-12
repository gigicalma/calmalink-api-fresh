// api/chat.js
import OpenAI from "openai";

// Domains allowed to call this API
const ALLOWED_ORIGINS = [
  "https://www.calmalink.com",
  "https://calmalink.com"
];

// Single category for now
const CATEGORIES = ["calm_breath"];

// Public audio files on your Vercel site root
const AUDIO_EN = "https://calmalink-api-fresh.vercel.app/calmbreathenglish.mp3";
const AUDIO_ES = "https://calmalink-api-fresh.vercel.app/spanishcalmbreath.mp3";

// Meditation library
const MEDITATIONS = {
  en: {
    calm_breath: {
      title: "Calm Breath • 3 min",
      duration: 3,
      audioUrl: AUDIO_EN,
      script:
        "Sit comfortably. Inhale 4, exhale 6. With each exhale, soften your shoulders and jaw. If thoughts arise, place them on a cloud and let them drift by. Return to your breath: inhale for 4, exhale for 6. When you’re ready, open your eyes and carry this calm with you."
    }
  },
  es: {
    calm_breath: {
      title: "Respiración Calma • 3 min",
      duration: 3,
      audioUrl: AUDIO_ES,
      script:
        "Siéntate con comodidad. Inhala 4, exhala 6. Con cada exhalación, suaviza hombros y mandíbula. Si surgen pensamientos, colócalos sobre una nube y déjalos pasar. Regresa a la respiración: inhala 4, exhala 6. Cuando estés listo, abre los ojos y lleva contigo esta calma."
    }
  }
};

// Tools (function calling)
const tools = [
  {
    type: "function",
    name: "get_meditation",
    description: "Return the Calm Breath meditation (audio + script) in English or Spanish.",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", enum: CATEGORIES },
        language: { type: "string", enum: ["en", "es"] },
        duration: { type: "integer", enum: [3] }
      },
      required: ["category", "language", "duration"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "handoff_crisis",
    description: "Trigger crisis protocol (no PHI). Returns hotline text.",
    parameters: { type: "object", properties: {}, additionalProperties: false }
  }
];

// -------------------- helpers --------------------
function withCORS(req, res) {
  const origin = req.headers.origin || "";
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function ok(res, payload) { return res.status(200).json(payload); }
function fail(res, msg) { return res.status(200).json({ message: `${msg} / Lo siento, hubo un problema.` }); }

function parseBody(req) {
  return new Promise((resolve, reject) => {
    try {
      if (typeof req.body === "string") return resolve(JSON.parse(req.body || "{}"));
      if (req.body && typeof req.body === "object") return resolve(req.body);
      let data = "";
      req.on("data", c => { data += c; });
      req.on("end", () => {
        if (!data) return resolve({});
        try { resolve(JSON.parse(data)); } catch { reject(new Error("Invalid JSON")); }
      });
      req.on("error", reject);
    } catch (e) { reject(e); }
  });
}

// Detect likely language from recent user turns
function inferLanguage(messages) {
  const text = [...messages].slice(-4).map(m => m?.role === "user" ? (m.content || "") : "").join(" ").toLowerCase();
  const esHits = ["español","espanol","respiración","respiracion","meditación","meditacion","inicia","empezar","reproduce","escuchar","pista"];
  return esHits.some(w => text.includes(w)) ? "es" : "en";
}

// Recognize natural phrasings to start the meditation (EN/ES)
function tryQuickMeditation(messages) {
  if (!Array.isArray(messages)) return null;
  const lastUser = [...messages].reverse().find(m => m && m.role === "user" && typeof m.content === "string");
  if (!lastUser) return null;

  const t = lastUser.content.toLowerCase();

  const keywords = [
    "calm_breath","calm breath","respiración calma","respiracion calma",
    "play","listen","start","begin","audio","track","meditation",
    "reproduce","escuchar","iniciar","empezar","pista","meditación","meditacion"
  ];
  const wantsPlay = keywords.some(kw => t.includes(kw));
  if (!wantsPlay) return null;

  const lang =
    (t.includes("español") || t.includes("espanol") || t.includes("respiración") || t.includes("respiracion") || t.includes("reproduce") || t.includes("pista") || t.includes("meditación") || t.includes("meditacion"))
      ? "es"
      : (t.includes("english") ? "en" : inferLanguage(messages));

  return { category: "calm_breath", language: lang, duration: 3 };
}

const SYSTEM_PROMPT = `
You are CalmaLink, a warm, concise, trauma-informed, bilingual (EN/ES) mindfulness guide.
- One practice available: calm_breath (3m) in English and Spanish. More practices are coming soon.
- If user asks to play/listen/start a meditation, provide calm_breath in their language.
- Respond empathetically to general messages; offer one step at a time. No diagnosis.
- If crisis language appears, call handoff_crisis.
- Keep replies short, gentle, actionable.
`;

// -------------------- handler --------------------
export default async function handler(req, res) {
  withCORS(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ message: "Use POST to chat. / Usa POST para chatear." });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ message: "Server misconfigured. Missing OPENAI_API_KEY." });

  const openai = new OpenAI({ apiKey });

  let body;
  try { body = await parseBody(req); }
  catch { return res.status(400).json({ message: "Invalid JSON body." }); }

  const messages = Array.isArray(body?.messages) ? body.messages : [];

  // 1) Fast-path: recognize "play/listen/start/meditation" etc. and return the track directly
  const quick = tryQuickMeditation(messages);
  if (quick) {
    const lib = MEDITATIONS[quick.language] || MEDITATIONS.en;
    const med = lib.calm_breath || MEDITATIONS.en.calm_breath;
    const intro = quick.language === "es"
      ? "Aquí tienes tu práctica de Respiración Calma."
      : "Here is your Calm Breath practice.";
    return ok(res, {
      message: intro,
      tool: { name: "get_meditation", result: {
        title: med.title,
        language: quick.language,
        duration: med.duration,
        audioUrl: med.audioUrl,
        script: med.script
      } }
    });
  }

  // 2) Model path: let the model reply, and call the tool if it chooses to
  try {
    const first = await openai.responses.create({
      model: "gpt-4o-mini",
      input: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      tools,
      tool_choice: "auto"
    });

    // Try to find a tool call in different shapes
    let toolCall = null;
    try {
      // responses API commonly: output[0].tool_calls[0] or output[0].tool_call
      const out0 = first?.output?.[0];
      if (out0?.tool_calls?.length) toolCall = out0.tool_calls[0];
      else if (out0?.tool_call) toolCall = out0.tool_call;
    } catch {}

    if (toolCall?.name === "get_meditation") {
      let lang = "en";
      try { lang = JSON.parse(toolCall.arguments)?.language === "es" ? "es" : "en"; } catch {}
      const lib = MEDITATIONS[lang] || MEDITATIONS.en;
      const med = lib.calm_breath || MEDITATIONS.en.calm_breath;

      // Let the model introduce the practice in context
      const follow = await openai.responses.create({
        model: "gpt-4o-mini",
        input: [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages,
          { role: "tool", name: "get_meditation", content: JSON.stringify({
            title: med.title,
            language: lang,
            duration: med.duration,
            audioUrl: med.audioUrl,
            script: med.script
          }) }
        ]
      });

      const text = follow?.output_text || (lang === "es" ? "Aquí tienes tu práctica." : "Here is your practice.");
      return ok(res, { message: text, tool: { name: "get_meditation", result: {
        title: med.title,
        language: lang,
        duration: med.duration,
        audioUrl: med.audioUrl,
        script: med.script
      } } });
    }

    // If no tool call, return the model text (avoid looping the library message)
    const normalText =
      (first?.output_text && first.output_text.trim()) ||
      (first?.output?.[0]?.content?.[0]?.text && first.output[0].content[0].text.trim()) ||
      (first?.choices?.[0]?.message?.content && first.choices[0].message.content.trim());

    if (normalText) return ok(res, { message: normalText });

    // Absolute last resort
    return ok(res, {
      message:
        "We currently offer a Calm Breath meditation in English and Spanish. Would you like to try one now? / Actualmente ofrecemos una meditación de Respiración Calma en español e inglés. ¿Quieres probar una ahora?"
    });

  } catch (err) {
    console.error("CalmaLink API error:", err);
    return fail(res, "Sorry, something went wrong.");
  }
}
