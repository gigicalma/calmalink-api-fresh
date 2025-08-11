// api/chat.js
import OpenAI from "openai";

// Allow your live domains
const ALLOWED_ORIGINS = [
  "https://www.calmalink.com",
  "https://calmalink.com"
];

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Only one category for now (two languages)
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

// ===== Replace the audio files by uploading to /public/audio (see steps below) =====
// After you upload, they'll be reachable at these URLs:
const AUDIO_EN = "https://calmalink-api-fresh.vercel.app/audio/calm-breath-en.mp3";
const AUDIO_ES = "https://calmalink-api-fresh.vercel.app/audio/calm-breath-es.mp3";

const MEDITATIONS = {
  en: {
    calm_breath: {
      title: "Calm Breath • 3 min",
      duration: 3,
      audioUrl: AUDIO_EN,
      script:
        "Sit comfortably. Inhale 4, exhale 6. With each exhale, let your shoulders and jaw soften. If thoughts arise, place them on a cloud and let them drift by. Return to your breath: inhale for 4, exhale for 6. When you’re ready, open your eyes and carry this calm with you."
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

// Tool implementations
const toolImpl = {
  async get_meditation({ category, language }) {
    const lib = MEDITATIONS[language] || MEDITATIONS.en;
    const med = lib[category] || MEDITATIONS.en.calm_breath;
    return {
      title: med.title,
      language,
      duration: med.duration,
      audioUrl: med.audioUrl,
      script: med.script
    };
  },
  async handoff_crisis() {
    return {
      message_en: "If you’re in immediate danger, call 911. In the U.S., dial or text 988 for the Suicide & Crisis Lifeline.",
      message_es: "Si estás en peligro inmediato, llama al 911. En EE. UU., marca o envía texto al 988 para la Línea de Suicidio y Crisis."
    };
  }
};

const SYSTEM_PROMPT = `
You are CalmaLink, a warm, concise, trauma-informed, bilingual (EN/ES) mindfulness guide.
- You currently offer one meditation: calm_breath (3m) available in English and Spanish. More practices are being added soon.
- Default to user's last language; if unclear ask "English or Español?" once.
- Do not diagnose; escalate to handoff_crisis for crisis language.
- Prefer calling get_meditation when the user wants a practice or taps a quick-start option.
- Short paragraphs; one actionable step at a time.
`;

// CORS
function withCORS(res, origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
function ok(res, payload) { return res.status(200).json(payload); }
function fail(res, msg) { return res.status(200).json({ message: `${msg} / Lo siento, hubo un problema.` }); }

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

export default async function handler(req, res) {
  withCORS(res, req.headers.origin || "");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return ok(res, { message: "Use POST to chat. / Usa POST para chatear." });

  try {
    const body = await parseBody(req);
    const messages = Array.isArray(body?.messages) ? body.messages : [];

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
    if (tc?.name) {
      const args = tc.arguments ? JSON.parse(tc.arguments) : {};
      const result = await toolImpl[tc.name](args);

      const followup = await openai.responses.create({
        model: "gpt-4o-mini",
        input: [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages,
          { role: "tool", name: tc.name, content: JSON.stringify(result) }
        ]
      });

      const text = followup.output_text || "Here is your practice. / Aquí tienes tu práctica.";
      return ok(res, { message: text, tool: { name: tc.name, result } });
    }

    const text = first.output_text || "We currently have Calm Breath in English and Spanish—more meditations are on the way. Would you like to try one now? / Tenemos Respiration Calma en español y Calm Breath en inglés—más prácticas vienen pronto. ¿Quieres probar una ahora?";
    return ok(res, { message: text });

  } catch (err) {
    console.error("CalmaLink API error:", err);
    return fail(res, "Sorry, something went wrong.");
  }
}
