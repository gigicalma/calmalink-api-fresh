// api/chat_v2.js
// CalmaLink robust deterministic backend (no model calls, no loops).
// Triggers Calm Breath for many phrases (EN/ES), handles "english/español", yes/ok, library, help, and crisis text.

import OpenAI from "openai"; // not used now; kept for future

// Allowed website origins
const ALLOWED_ORIGINS = [
  "https://calmalink.com",
  "https://www.calmalink.com"
];

// Public audio files on your Vercel root
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

// ---------------- utils ----------------
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

function norm(s="") { return (s || "").toLowerCase().trim(); }
function includesAny(text, arr) { return arr.some(k => text.includes(k)); }

// ---------------- intent helpers ----------------
const YES_EN = ["yes","yeah","yep","ok","okay","sure","go ahead","lets do it","let's do it","please","do it","start it","begin"];
const YES_ES = ["sí","si","dale","va","claro","por favor","hazlo","empecemos","empieza","inicia"];
const START_EN = ["calm breath","calm_breath","play","listen","start","begin","audio","track","meditation","meditate","breathe","breathing"];
const START_ES = ["respiración calma","respiracion calma","reproduce","escuchar","iniciar","empezar","pista","meditación","meditacion","respira","respiración","respiracion"];
const LANG_EN_ONLY = ["english","inglés","ingles","en"];
const LANG_ES_ONLY = ["spanish","español","espanol","es"];

const LIBRARY_TRIGGERS = ["library","catalog","list","what do you have","what meditations","qué tienes","biblioteca","lista"];
const HELP_TRIGGERS = ["help","how to","ayuda","como uso","¿cómo uso?","instructions"];
const CRISIS_EN = ["kill myself","suicide","want to die","hurt myself","harm myself","overdose","self harm","self-harm","end my life"];
const CRISIS_ES = ["suicidio","matarme","quiero morir","hacerme daño","dañarme","autolesion","autolesión","sobredosis","quitarme la vida"];

// Infer likely language from recent user turns
function inferLanguage(messages) {
  const text = [...messages].slice(-5).map(m => (m?.role === "user" ? (m.content || "") : "")).join(" ").toLowerCase();
  if (includesAny(text, ["español","espanol","meditación","meditacion","respiración","respiracion","reproduce","escuchar","pista"])) return "es";
  if (includesAny(text, ["english"])) return "en";
  return "en";
}

function wantsLibrary(messages) {
  const u = [...messages].reverse().find(m => m?.role === "user" && typeof m.content === "string");
  return !!u && includesAny(norm(u.content), LIBRARY_TRIGGERS);
}
function wantsHelp(messages) {
  const u = [...messages].reverse().find(m => m?.role === "user" && typeof m.content === "string");
  return !!u && includesAny(norm(u.content), HELP_TRIGGERS);
}
function isCrisis(messages) {
  const u = [...messages].reverse().find(m => m?.role === "user" && typeof m.content === "string");
  if (!u) return false;
  const t = norm(u.content);
  return includesAny(t, CRISIS_EN) || includesAny(t, CRISIS_ES);
}

function wantsMeditation(messages) {
  const u = [...messages].reverse().find(m => m?.role === "user" && typeof m.content === "string");
  if (!u) return { want:false, lang:null, reason:null };
  const t = norm(u.content);

  if (LANG_EN_ONLY.includes(t)) return { want:true, lang:"en", reason:"lang-only-en" };
  if (LANG_ES_ONLY.includes(t)) return { want:true, lang:"es", reason:"lang-only-es" };

  const saidYes = includesAny(t, [...YES_EN, ...YES_ES]);
  const saidStart = includesAny(t, [...START_EN, ...START_ES]);

  if (saidYes || saidStart) return { want:true, lang:null, reason: saidYes ? "confirm" : "start-phrase" };

  const prevA = [...messages].reverse().find(m => m?.role === "assistant" && typeof m.content === "string");
  if (prevA && prevA.content.toLowerCase().includes("we currently offer a calm breath")) {
    if (saidYes) return { want:true, lang:null, reason:"confirm-after-library" };
  }

  return { want:false, lang:null, reason:null };
}

function supportiveReply(lang) {
  if (lang === "es") {
    return "Gracias por compartir. Estoy aquí contigo—un paso a la vez. ¿Quieres hacer una Respiración Calma de 3 minutos ahora? Di “español” o “english” para elegir idioma.";
  }
  return "Thanks for sharing. I’m here with you—one step at a time. Want to do a 3-minute Calm Breath now? Say “english” or “español” to choose language.";
}
function libraryReply(lang) {
  if (lang === "es") return "Biblioteca actual:\n• Respiración Calma (3 min) — Español e Inglés\nMás meditaciones llegarán pronto.";
  return "Current library:\n• Calm Breath (3 min) — English & Spanish\nMore meditations are coming soon.";
}
function helpReply(lang) {
  if (lang === "es") return "Puedes decir: “español” o “english” • “reproduce la meditación” • “escuchar la pista” • “lista de meditaciones”. Si necesitas ayuda urgente, llama al 911 o al 988 en EE. UU.";
  return "You can say: “english” or “español” • “play the meditation” • “listen to the track” • “show library”. If you need urgent help, call 911 or 988 (U.S.).";
}
function crisisReply(lang) {
  if (lang === "es") return "Siento que estés pasando por esto. En EE. UU., llama o envía un texto al 988 (Línea de Vida), o llama al 911 si es una emergencia. Si estás fuera de EE. UU., usa tu número local de emergencias.";
  return "I’m really sorry you’re going through this. In the U.S., call or text 988 (Suicide & Crisis Lifeline), or call 911 if this is an emergency. If you’re outside the U.S., use your local emergency number.";
}
function sendMeditation(res, lang, reason) {
  const lib = MEDITATIONS[lang] || MEDITATIONS.en;
  const med = lib.calm_breath || MEDITATIONS.en.calm_breath;
  const intro = lang === "es" ? "Aquí tienes tu práctica de Respiración Calma." : "Here is your Calm Breath practice.";
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

// ---------------- handler ----------------
export default async function handler(req, res) {
  withCORS(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return bad(res, 405, "Use POST to chat. / Usa POST para chatear.");

  let body;
  try { body = await parseBody(req); }
  catch { return bad(res, 400, "Invalid JSON body."); }

  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const lang = inferLanguage(messages);

  if (isCrisis(messages)) return ok(res, { message: crisisReply(lang) });
  if (wantsLibrary(messages)) return ok(res, { message: libraryReply(lang) });
  if (wantsHelp(messages)) return ok(res, { message: helpReply(lang) });

  const decision = wantsMeditation(messages);
  if (decision.want) return sendMeditation(res, decision.lang || lang, decision.reason);

  return ok(res, { message: supportiveReply(lang) });
}
