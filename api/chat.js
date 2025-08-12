// api/chat.js
// Deterministic CalmaLink API: starts Calm Breath on common phrases OR language-only messages.

import OpenAI from "openai"; // kept for future use

// Allowed origins
const ALLOWED_ORIGINS = [
  "https://www.calmalink.com",
  "https://calmalink.com"
];

// Public audio
const AUDIO_EN = "https://calmalink-api-fresh.vercel.app/calmbreathenglish.mp3";
const AUDIO_ES = "https://calmalink-api-fresh.vercel.app/spanishcalmbreath.mp3";

// Library
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

// Language inference
function inferLanguage(messages) {
  const text = [...messages].slice(-5).map(m => m?.role === "user" ? (m.content || "") : "").join(" ").toLowerCase();
  if (/\bespañol\b|\bespanol\b|\brespiración\b|\brespiracion\b|\bmeditación\b|\bmeditacion\b|\breproduce\b|\bescuchar\b|\bpista\b/.test(text)) return "es";
  if (/\benglish\b/.test(text)) return "en";
  return "en";
}

// Determine if user wants to start
function wantsMeditation(messages) {
  if (!Array.isArray(messages) || !messages.length) return { want:false, lang:null };
  const lastUser = [...messages].reverse().find(m => m && m.role === "user" && typeof m.content === "string");
  if (!lastUser) return { want:false, lang:null };

  const t = lastUser.content.toLowerCase().trim();

  // Language-only triggers
  if (t === "english") return { want:true, lang:"en" };
  if (t === "spanish" || t === "español" || t === "espanol") return { want:true, lang:"es" };

  // Start keywords (EN/ES)
  const startWords = [
    "calm_breath","calm breath","respiración calma","respiracion calma",
    "play","listen","start","begin","audio","track","meditation","meditate",
    "reproduce","escuchar","iniciar","empezar","pista","meditación","meditacion"
  ];
  const confirms = ["yes","yeah","yep","ok","okay","sure","go ahead","let's do it","lets do it","sí","si","dale","va"];

  if (startWords.some(k => t.includes(k)) || confirms.some(k => t.includes(k))) {
    return { want:true, lang:null };
  }

  // If previous assistant message was the library nudge, treat confirmations as start
  const prevAssistant = [...messages].reverse().find(m => m && m.role === "assistant" && typeof m.content === "string");
  if (prevAssistant && prevAssistant.content.toLowerCase().includes("we currently offer a calm breath")) {
    if (confirms.some(k => t.includes(k))) return { want:true, lang:null };
  }

  return { want:false, lang:null };
}

function supportiveReply(lang) {
  if (lang === "es") {
    return "Gracias por compartir. Estoy aquí para apoyarte con un paso a la vez. ¿Te gustaría hacer ahora una práctica breve de Respiración Calma (3 min)? Di “español” o “english” para elegir idioma.";
  }
  return "Thanks for sharing. I’m here with you—one step at a time. Want to do a 3-minute Calm Breath now? Say “english” or “español” to choose language.";
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

  const decision = wantsMeditation(messages);
  if (decision.want) {
    const lang = decision.lang || inferLanguage(messages);
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

  const lang = inferLanguage(messages);
  return ok(res, { message: supportiveReply(lang) });
}
