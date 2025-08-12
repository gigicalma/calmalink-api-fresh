// api/chat.js
// Deterministic CalmaLink API — no model calls, no loops.
// Triggers Calm Breath on common phrases; otherwise replies briefly + offers the practice.

import OpenAI from "openai"; // kept for future use, but not required in this minimal build

// Allow your live domains
const ALLOWED_ORIGINS = [
  "https://www.calmalink.com",
  "https://calmalink.com"
];

// Public audio files (Vercel public root)
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

// ---------- helpers ----------
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
      req.on("end", () => {
        if (!data) return resolve({});
        try { resolve(JSON.parse(data)); } catch { reject(new Error("Invalid JSON")); }
      });
      req.on("error", reject);
    } catch (e) { reject(e); }
  });
}

// Detect Spanish from recent user messages
function inferLanguage(messages) {
  const text = [...messages].slice(-5).map(m => m?.role === "user" ? (m.content || "") : "").join(" ").toLowerCase();
  const esHits = ["español","espanol","respiración","respiracion","meditación","meditacion","reproduce","escuchar","pista","iniciar","empezar","sí "," si "];
  return esHits.some(w => text.includes(w)) ? "es" : "en";
}

// Did the user ask to start/play/listen OR just say yes/ok? (EN/ES)
function wantsMeditation(messages) {
  if (!Array.isArray(messages) || !messages.length) return false;
  const lastUser = [...messages].reverse().find(m => m && m.role === "user" && typeof m.content === "string");
  if (!lastUser) return false;

  const t = lastUser.content.toLowerCase();

  const startWords = [
    "calm_breath","calm breath","respiración calma","respiracion calma",
    "play","listen","start","begin","audio","track","meditation","meditate",
    "reproduce","escuchar","iniciar","empezar","pista","meditación","meditacion"
  ];
  const confirms = ["yes","yeah","yep","ok","okay","sure","go ahead","let's do it","lets do it","sí","si","dale","va"];

  if (startWords.some(k => t.includes(k)) || confirms.some(k => t.includes(k))) return true;

  // If the previous assistant message was the "library" nudge and user replied anything affirmative, start
  const prevAssistant = [...messages].reverse().find(m => m && m.role === "assistant" && typeof m.content === "string");
  if (prevAssistant && prevAssistant.content.toLowerCase().includes("we currently offer a calm breath")) {
    if (confirms.some(k => t.includes(k))) return true;
  }

  return false;
}

// Short supportive default reply (no model)
function supportiveReply(lang) {
  if (lang === "es") {
    return "Gracias por compartir. Estoy aquí para apoyarte con un paso a la vez. ¿Te gustaría hacer ahora una práctica breve de Respiración Calma (3 min)?";
  }
  return "Thanks for sharing. I’m here to support you—one small step at a time. Would you like to do a 3-minute Calm Breath now?";
}

// ---------- handler ----------
export default async function handler(req, res) {
  withCORS(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return bad(res, 405, "Use POST to chat. / Usa POST para chatear.");

  let body;
  try { body = await parseBody(req); }
  catch { return bad(res, 400, "Invalid JSON body."); }

  const messages = Array.isArray(body?.messages) ? body.messages : [];

  // If user wants the track, return it deterministically
  if (wantsMeditation(messages)) {
    const lang = inferLanguage(messages);
    const med = (MEDITATIONS[lang] && MEDITATIONS[lang].calm_breath) || MEDITATIONS.en.calm_breath;
    const intro = lang === "es"
      ? "Aquí tienes tu práctica de Respiración Calma."
      : "Here is your Calm Breath practice.";
    return ok(res, {
      message: intro,
      tool: { name: "get_meditation", result: {
        title: med.title,
        language: lang,
        duration: med.duration,
        audioUrl: med.audioUrl,
        script: med.script
      } }
    });
  }

  // Otherwise, send a brief, empathetic nudge (no looping)
  const lang = inferLanguage(messages);
  return ok(res, { message: supportiveReply(lang) });
}
