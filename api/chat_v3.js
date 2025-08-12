// api/chat_v3.js
// CalmaLink hybrid backend (natural model chat + reliable tool playback)
// • Natural, empathetic conversation (EN/ES) using gpt-4o
// • Deterministic quick intents so “english / español / play / start / yes / no / just talk” never miss
// • Library / help / crisis shortcuts
// • Returns inline audio via: { tool: { name:"get_meditation", result:{...} } }

import OpenAI from "openai";

// CORS (add your Squarespace preview domain here if needed)
const ALLOWED_ORIGINS = [
  "https://calmalink.com",
  "https://www.calmalink.com"
];

// Public audio files on your Vercel deployment
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

// ---------- utilities ----------
function withCORS(req, res) {
  const origin = req.headers.origin || "";
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
function ok(res, payload) { return res.status(200).json(payload); }
function bad(res, code, message) { return res.status(code).json({ message }); }
function parseBody(req) {
  return new Promise((resolve, reject) => {
    try {
      if (typeof req.body === "string") return resolve(JSON.parse(req.body || "{}"));
      if (req.body && typeof req.body === "object") return resolve(req.body);
      let data = "";
      req.on("data", c => { data += c; });
      req.on("end", () => { if (!data) return resolve({}); try { resolve(JSON.parse(data)); } catch { reject(new Error("Invalid JSON")); } });
      req.on("error", reject);
    } catch (e) { reject(e); }
  });
}
const norm = (s="") => (s || "").toLowerCase().trim();
const includesAny = (t, arr) => arr.some(k => t.includes(k));

// ---------- system prompt & tools ----------
const SYSTEM_PROMPT = `
You are CalmaLink, a warm, concise, trauma-informed, bilingual (English & Spanish) mindfulness guide.

STYLE
- Speak naturally and empathetically. Reflect, validate, then offer one small next step.
- Keep responses short (2–5 sentences) unless reading a brief script via tool.
- Never diagnose or provide medical advice. If crisis language appears, call "handoff_crisis".

CAPABILITIES
- One practice is available: calm_breath (3 minutes) in English and Spanish.
- If the user asks to play/listen/start a meditation (or says "english"/"español"), call "get_meditation".
- If the user declines (e.g., "not now", "just talk"), continue supportive conversation without pushing a practice.
- If they ask for the library or help, answer simply.

LANGUAGE
- Reply in the user’s language. If unclear, ask once: "English or Español?"
`;

const tools = [
  {
    type: "function",
    name: "get_meditation",
    description: "Return Calm Breath (audio + script) in English or Spanish.",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["calm_breath"] },
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
    description: "Provide crisis handoff text.",
    parameters: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    type: "function",
    name: "get_library",
    description: "List currently available meditations.",
    parameters: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    type: "function",
    name: "get_help",
    description: "Explain how to use CalmaLink briefly.",
    parameters: { type: "object", properties: {}, additionalProperties: false }
  }
];

// ---------- deterministic quick intents (never miss) ----------
function quickIntent(messages) {
  const last = [...(messages||[])].reverse().find(m => m?.role === "user" && typeof m.content === "string");
  if (!last) return null;
  const t = norm(last.content);

  // Language-only = start immediately
  if (["english","inglés","ingles","en"].includes(t)) return { name:"get_meditation", args:{ category:"calm_breath", language:"en", duration:3 } };
  if (["spanish","español","espanol","es"].includes(t)) return { name:"get_meditation", args:{ category:"calm_breath", language:"es", duration:3 } };

  // Clear start phrases
  const start = ["calm breath","calm_breath","play","listen","start","begin","audio","track","meditation","meditate","breathe","breathing","reproduce","escuchar","iniciar","empezar","pista","meditación","meditacion","respiración","respiracion"];
  if (includesAny(t, start)) {
    const lang = (t.includes("español")||t.includes("espanol")||t.includes(" meditación")||t.includes(" respiración")) ? "es" : (t.includes("english") ? "en" : "en");
    return { name:"get_meditation", args:{ category:"calm_breath", language:lang, duration:3 } };
  }

  // Declines / talk-only
  const decline = ["just talk","i want to talk","can we talk","no meditation","not now","later","skip","stop","cancel","solo hablar","sin meditación","sin meditacion","no ahora","más tarde","mas tarde","omitir","detener","pausa","no gracias","no quiero"];
  if (includesAny(t, decline)) return { name:null };

  // Library / help
  const library = ["library","catalog","list","what do you have","what meditations","qué tienes","biblioteca","lista"];
  if (includesAny(t, library)) return { name:"get_library" };

  const help = ["help","how to","ayuda","como uso","¿cómo uso?","instructions"];
  if (includesAny(t, help)) return { name:"get_help" };

  // Crisis
  const crisis = ["kill myself","suicide","want to die","hurt myself","harm myself","overdose","self harm","self-harm","end my life","suicidio","matarme","quiero morir","hacerme daño","dañarme","autolesion","autolesión","sobredosis","quitarme la vida"];
  if (includesAny(t, crisis)) return { name:"handoff_crisis" };

  return null;
}

// ---------- handler ----------
export default async function handler(req, res) {
  withCORS(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return bad(res, 405, "Use POST to chat. / Usa POST para chatear.");

  if (!process.env.OPENAI_API_KEY) return bad(res, 500, "Server misconfigured. Missing OPENAI_API_KEY.");
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  let body;
  try { body = await parseBody(req); }
  catch { return bad(res, 400, "Invalid JSON body."); }

  const messages = Array.isArray(body?.messages) ? body.messages : [];

  // 0) Deterministic quick intents
  const qi = quickIntent(messages);
  if (qi?.name === "get_meditation") {
    const lang = qi.args.language;
    const lib = MEDITATIONS[lang] || MEDITATIONS.en;
    const med = lib.calm_breath || MEDITATIONS.en.calm_breath;
    const intro = lang === "es" ? "Aquí tienes tu práctica de Respiración Calma." : "Here is your Calm Breath practice.";
    return ok(res, { message: intro, tool: { name:"get_meditation", result:{
      title: med.title, language: lang, duration: med.duration, audioUrl: med.audioUrl, script: med.script
    } } });
  }
  if (qi?.name === "get_library") {
    return ok(res, { message: "Current library: Calm Breath (3 min) — English & Spanish. More meditations are coming soon. / Biblioteca actual: Respiración Calma (3 min) — Español e Inglés. Pronto añadiremos más." });
  }
  if (qi?.name === "get_help") {
    return ok(res, { message: "You can say “english” or “español”, “play the meditation”, “show library”, or just talk to me. / Puedes decir “english” o “español”, “reproduce la meditación”, “lista de meditaciones”, o simplemente háblame." });
  }
  if (qi?.name === "handoff_crisis") {
    return ok(res, { message: "I’m really sorry you’re going through this. In the U.S., call or text 988 (Suicide & Crisis Lifeline), or call 911 if this is an emergency. / Siento que estés pasando por esto. En EE. UU., llama o envía un texto al 988, o llama al 911 si es una emergencia." });
  }
  // qi === null or qi.name === null → continue to model conversation

  try {
    // 1) Natural conversation + tool choice
    const first = await openai.responses.create({
      model: "gpt-4o",
      input: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      tools,
      tool_choice: "auto",
      temperature: 0.6
    });

    // Extract tool call robustly
    let toolCall = null;
    const out0 = first?.output?.[0];
    if (out0?.tool_calls?.length) toolCall = out0.tool_calls[0];
    else if (out0?.tool_call) toolCall = out0.tool_call;

    if (toolCall?.name === "get_meditation") {
      let lang = "en";
      try { lang = JSON.parse(toolCall.arguments)?.language === "es" ? "es" : "en"; } catch {}
      const lib = MEDITATIONS[lang] || MEDITATIONS.en;
      const med = lib.calm_breath || MEDITATIONS.en.calm_breath;

      // 2) Let the model introduce the practice, then return tool payload
      const follow = await openai.responses.create({
        model: "gpt-4o",
        input: [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages,
          { role: "tool", name: "get_meditation", content: JSON.stringify({
            title: med.title, language: lang, duration: med.duration, audioUrl: med.audioUrl, script: med.script
          }) }
        ],
        temperature: 0.6
      });

      const text = follow?.output_text || (lang === "es" ? "Aquí tienes tu práctica." : "Here is your practice.");
      return ok(res, { message: text, tool: { name:"get_meditation", result:{
        title: med.title, language: lang, duration: med.duration, audioUrl: med.audioUrl, script: med.script
      } } });
    }

    // No tool call → return model text (natural chat)
    const normalText =
      (first?.output_text && first.output_text.trim()) ||
      (first?.output?.[0]?.content?.[0]?.text && first.output[0].content[0].text.trim());
    if (normalText) return ok(res, { message: normalText });

    // Rare fallback
    return ok(res, { message: "I’m here with you. Would you like to talk, or try a 3‑minute Calm Breath? / Estoy aquí contigo. ¿Quieres conversar o probar una Respiración Calma de 3 minutos?" });

  } catch (err) {
    console.error("CalmaLink chat_v3 error:", err);
    return ok(res, { message: "Sorry—something went wrong. We can just talk, or I can guide a 3‑minute Calm Breath. / Lo siento, algo falló. Podemos conversar o puedo guiar una Respiración Calma de 3 minutos." });
  }
}
