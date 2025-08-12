// api/chat.js
// CalmaLink robust deterministic backend (no loops, broad intent coverage)
// - Triggers Calm Breath for many phrasings (EN/ES) incl. "english", "español", "play", "start", "listen", "yes/sí", etc.
// - Lists library on request
// - Crisis language escalation (returns crisis text)
// - Short, empathetic replies when user just chats
// - Returns audio via { tool: { name:"get_meditation", result:{...} } } which your frontend renders inline

// (OpenAI imported for future use; not required in this deterministic build)
import OpenAI from "openai";

// Allowed website origins
const ALLOWED_ORIGINS = [
  "https://www.calmalink.com",
  "https://calmalink.com"
];

// Public audio files on your Vercel deployment root
const AUDIO_EN = "https://calmalink-api-fresh.vercel.app/calmbreathenglish.mp3";
const AUDIO_ES = "https://calmalink-api-fresh.vercel.app/spanishcalmbreath.mp3";

// Meditation library (expandable)
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

// ---------------- util ----------------
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

// ---------------- NLP-ish helpers (deterministic) ----------------
const YES_EN = ["yes","yeah","yep","ok","okay","sure","go ahead","lets do it","let's do it","please","do it","start it","begin"];
const YES_ES = ["sí","si","dale","va","claro","por favor","hazlo","empecemos","empieza","inicia"];
const START_EN = ["calm breath","calm_breath","play","listen","start","begin","audio","track","meditation","meditate","breathe","breathing"];
const START_ES = ["respiración calma","respiracion calma","reproduce","escuchar","iniciar","empezar","pista","meditación","meditacion","respira","respiración","respiracion"];
const LANG_EN_ONLY = ["english","inglés","ingles","en"];        // accept both spellings as intent to run EN
const LANG_ES_ONLY = ["spanish","español","espanol","es"];     // accept language-only messages as start
const LIBRARY_TRIGGERS = ["library","catalog","list","what do you have","what meditations","qué tienes","biblioteca","lista"];
const HELP_TRIGGERS = ["help","how to","ayuda","como uso","¿cómo uso?","instructions"];
const CRISIS_EN = ["kill myself","suicide","want to die","hurt myself","harm myself","overdose","self harm","self-harm","end my life"];
const CRISIS_ES = ["suicidio","matarme","quiero morir","hacerme daño","dañarme","autolesion","autolesión","sobredosis","quitarme la vida"];

function norm(s="") { return (s || "").toLowerCase().trim(); }
function includesAny(text, arr) { return arr.some(k => text.includes(k)); }

// Infer likely language from recent user turns (last 5)
function inferLanguage(messages) {
  const text = [...messages].slice(-5).map(m => (m?.role === "user" ? (m.content || "") : "")).join(" ").toLowerCase();
  if (includesAny(text, ["español","espanol","meditación","meditacion","respiración","respiracion","reproduce","escuchar","pista"])) return "es";
  if (includesAny(text, ["english"])) return "en";
  return "en";
}

// Did user request the meditation?
function wantsMeditation(messages) {
  const lastUser = [...messages].reverse().find(m => m && m.role === "user" && typeof m.content === "string");
  if (!lastUser) return { want:false, lang:null };

  const t = norm(lastUser.content);

  // Language-only triggers
  if (LANG_EN_ONLY.includes(t)) return { want:true, lang:"en" };
  if (LANG_ES_ONLY.includes(t)) return { want:true, lang:"es" };

  // Affirmations (after an invite)
  const saidYes = includesAny(t, [...YES_EN, ...YES_ES]);

  // Start phrases
  const saidStart = includesAny(t, [...START_EN, ...START_ES]);

  // If either path true, we want to start (language may still be null)
  if (saidYes || saidStart) return { want:true, lang:null };

  // If previous assistant nudged about library, treat "yes/sí" as start
  const prevAssistant = [...messages].reverse().find(m => m && m.role === "assistant" && typeof m.content === "string");
  if (prevAssistant && prevAssistant.content.toLowerCase().includes("we currently offer a calm breath")) {
    if (saidYes) return { want:true, lang:null };
  }

  return { want:false, lang:null };
}

function wantsLibrary(messages) {
  const lastUser = [...messages].reverse().find(m => m && m.role === "user" && typeof m.content === "string");
  if (!lastUser) return false;
  return includesAny(norm(lastUser.content), LIBRARY_TRIGGERS);
}

function wantsHelp(messages) {
  const lastUser = [...messages].reverse().find(m => m && m.role === "user" && typeof m.content === "string");
  if (!lastUser) return false;
  return includesAny(norm(lastUser.content), HELP_TRIGGERS);
}

function isCrisis(messages) {
  const lastUser = [...messages].reverse().find(m => m && m.role === "user" && typeof m.content === "string");
  if (!lastUser) return false;
  const t = norm(lastUser.content);
  return includesAny(t, CRISIS_EN) || includesAny(t, CRISIS_ES);
}

// Short supportive default
function supportiveReply(lang) {
  if (lang === "es") {
    return "Gracias por compartir. Estoy aquí contigo—un paso a la vez. ¿Quieres hacer una Respiración Calma de 3 minutos ahora? Di “español” o “english” para elegir idioma.";
  }
  return "Thanks for sharing. I’m here with you—one step at a time. Want to do a 3-minute Calm Breath now? Say “english” or “español” to choose language.";
}

function libraryReply(lang) {
  if (lang === "es") {
    return "Biblioteca actual:\n• Respiración Calma (3 min) — Español e Inglés\nMás meditaciones llegarán pronto.";
  }
  return "Current library:\n• Calm Breath (3 min) — English & Spanish\nMore meditations are coming soon.";
}

function helpReply(lang) {
  if (lang === "es") {
    return "Puedes decir: “español” o “english” • “reproduce la meditación” • “escuchar la pista” • “lista de meditaciones”. Si necesitas ayuda urgente, llama al 911 o al 988 en EE. UU.";
  }
  return "You can say: “english” or “español” • “play the meditation” • “listen to the track” • “show library”. If you need urgent help, call 911 or 988 (U.S.).";
}

// Package a meditation response your frontend can render
function sendMeditation(res, lang) {
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

// Crisis handoff text
function crisisReply(lang) {
  if (lang === "es") {
    return "Siento que estés pasando por esto. No puedo ofrecer ayuda de crisis, pero quiero que obtengas apoyo inmediato. En EE. UU., llama o envía un texto al 988 (Línea de Vida), o llama al 911 si es una emergencia. Si estás fuera de EE. UU., usa tu número local de emergencias.";
  }
  return "I’m really sorry you’re going through this. I can’t provide crisis support here, but I want you to get immediate help. In the U.S., call or text 988 (Suicide & Crisis Lifeline), or call 911 if this is an emergency. If you’re outside the U.S., use your local emergency number.";
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

  // 1) Crisis detection
  if (isCrisis(messages)) {
    return ok(res, { message: crisisReply(lang) });
  }

  // 2) Library request
  if (wantsLibrary(messages)) {
    return ok(res, { message: libraryReply(lang) });
  }

  // 3) Help
  if (wantsHelp(messages)) {
    return ok(res, { message: helpReply(lang) });
  }

  // 4) Start meditation (broad triggers incl. "english"/"español" + yes/ok)
  const decision = wantsMeditation(messages);
  if (decision.want) {
    const chosenLang = decision.lang || lang;
    return sendMeditation(res, chosenLang);
  }

  // 5) Supportive default + gentle invite
  return ok(res, { message: supportiveReply(lang) });
}
