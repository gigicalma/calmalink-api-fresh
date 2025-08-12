// api/chat.js
import OpenAI from "openai";

// Allow your live domains
const ALLOWED_ORIGINS = [
  "https://www.calmalink.com",
  "https://calmalink.com"
];

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Single category for now; two languages
const CATEGORIES = ["calm_breath"];

// Tool schemas
const tools = [
  {
    type: "function",
    name: "get_meditation",
    description: "Return the Calm Breath meditation (audio + script) in English or Spanish.",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", enum: CATEGORIES },
        language: { type: "string", enum: ["en","es"] },
        duration: { type: "integer", enum: [3] }
      },
      required: ["category","language","duration"],
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

// Your uploaded filenames in /public (root)
const AUDIO_EN = "https://calmalink-api-fresh.vercel.app/calmbreathenglish.mp3";
const AUDIO_ES = "https://calmalink-api-fresh.vercel.app/spanishcalmbreath.mp3";

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

// --- Helpers ---
function withCORS(res, origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
function ok(res, payload) { return res.status(200).json(payload); }
// Send an error response with a 500 status code instead of 200
function fail(res, msg) {
  return res.status(500).json({ message: `${msg} / Lo siento, hubo un problema.` });
}

// Parse JSON body safely
function parseBody(req) {
  try {
    if (typeof req.body === "string") return JSON.parse(req.body || "{}");
    if (req.body && typeof req.body === "object") return req.body;
    let data = "";
    return new Promise((resolve, reject) => {
      req.on("data", chunk => { data += chunk; });
      req.on("end", () => {
        if (!data) return resolve({});
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
      req.on("error", reject);
    });
  } catch { return {}; }
}

// Quick-start recognizer: if the last user message asks to start calm_breath, skip the model and return it
function tryQuickMeditation(messages) {
  if (!Array.isArray(messages)) return null;
  const lastUser = [...messages].reverse().find(m => m && m.role === "user" && typeof m.content === "string");
  if (!lastUser) return null;
  const t = lastUser.content.toLowerCase();

  const mentionsCalm =
    t.includes("calm_breath") ||
    t.includes("calm breath") ||
    t.includes("respiración calma") ||
    t.includes("respiracion calma");

  if (!mentionsCalm) return null;

  const language =
    t.includes("español") || t.includes("spanish") || t.includes("espanol")
      ? "es"
      : "en";

  return { category: "calm_breath", language, duration: 3 };
}

const SYSTEM_PROMPT = `
You are CalmaLink, a warm, concise, trauma-informed, bilingual (EN/ES) mindfulness guide.
- You currently offer one meditation: calm_breath (3m) in English and Spanish. More practices are being added soon.
- Respond empathetically to general messages (reflect, validate, offer one step).
- Offer a practice when appropriate; otherwise continue supportive conversation.
- Default to user's last language; if unclear ask "English or Español?" once.
- Do not diagnose; escalate to handoff_crisis for crisis language.
- Prefer calling get_meditation when the user wants a practice or taps a quick-start option.
- Keep replies short, gentle, actionable.
`;

export default async function handler(req, res) {
  withCORS(res, req.headers.origin || "");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return ok(res, { message: "Use POST to chat. / Usa POST para chatear." });

  try {
    const body = await parseBody(req);
    const messages = Array.isArray(body?.messages) ? body.messages : [];

    // 1) Fast-path for quick-start buttons
    const quick = tryQuickMeditation(messages);
    if (quick) {
      const lib = MEDITATIONS[quick.language] || MEDITATIONS.en;
      const med = lib.calm_breath || MEDITATIONS.en.calm_breath;
      const intro =
        quick.language === "es"
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

    // 2) Normal path: ask the model to reply naturally (and call the tool if useful)
    const first = await openai.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages
      ],
      tools,
      tool_choice: "auto"
    });

    const tc = first.output?.[0]?.tool_call;
    if (tc?.name === "get_meditation") {
      // ensure valid language + payload
      let language = "en";
      try { language = JSON.parse(tc.arguments)?.language === "es" ? "es" : "en"; } catch {}
      const lib = MEDITATIONS[language] || MEDITATIONS.en;
      const med = lib.calm_breath || MEDITATIONS.en.calm_breath;

      // Follow-up so the model can introduce the practice in context
      const out = await openai.responses.create({
        model: "gpt-4o-mini",
        input: [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages,
          { role: "tool", name: "get_meditation", content: JSON.stringify({
            title: med.title,
            language,
            duration: med.duration,
            audioUrl: med.audioUrl,
            script: med.script
          }) }
        ]
      });

      const text = out.output_text || (language === "es"
        ? "Aquí tienes tu práctica."
        : "Here is your practice.");
      return ok(res, { message: text, tool: { name: "get_meditation", result: {
        title: med.title,
        language,
        duration: med.duration,
        audioUrl: med.audioUrl,
        script: med.script
      } } });
    }

    // 3) If no tool call, return the model's text directly (NOT the library message)
    const normalText =
      first.output_text?.trim() ||
      first.output?.[0]?.content?.[0]?.text?.trim() ||
      first.choices?.[0]?.message?.content?.trim();

    if (normalText) return ok(res, { message: normalText });

    console.error("No assistant text in OpenAI response:", first);
    return fail(res, "No response from the model.");

  } catch (err) {
    console.error("CalmaLink API error:", err);
    return fail(res, "Sorry, something went wrong.");
  }
}
