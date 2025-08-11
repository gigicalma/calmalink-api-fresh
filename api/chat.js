// api/chat.js
import OpenAI from "openai";

// ✅ Your live site domains are pre-approved here (no edits needed)
const ALLOWED_ORIGINS = [
  "https://www.calmalink.com",
  "https://calmalink.com"
];

// OpenAI client (key comes from Vercel env: OPENAI_API_KEY)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- Tool (function) schemas for function calling ---
const tools = [
  {
    type: "function",
    name: "get_meditation",
    description: "Fetch a meditation by category, language, and duration (minutes).",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["grounding","anxiety","postpartum","sleep","lgbtq_affirming","ancestral"] },
        language: { type: "string", enum: ["en","es"] },
        duration: { type: "integer", minimum: 1, maximum: 30 }
      },
      required: ["category","language","duration"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "log_checkin",
    description: "Log a mood check-in (if user has consented elsewhere).",
    parameters: {
      type: "object",
      properties: {
        mood: { type: "string", enum: ["calm","okay","stressed","overwhelmed","sad","anxious"] },
        notes: { type: "string" }
      },
      required: ["mood"],
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

// Demo meditation scripts (swap in your real content later)
const MEDITATIONS = {
  en: {
    grounding: "Begin by noticing your breath. Feel your feet on the floor...",
    anxiety: "Inhale to a count of 4, exhale to 6. Repeat gently...",
    postpartum: "Slow breaths. On each exhale: 'I am safe. I am enough.'",
    lgbtq_affirming: "Inhale self-kindness; exhale shame. You belong.",
    ancestral: "Place your hand on your heart. Imagine an ancestor offering strength..."
  },
  es: {
    grounding: "Empieza notando tu respiración. Siente tus pies en el suelo...",
    anxiety: "Inhala contando 4, exhala 6. Repite suavemente...",
    postpartum: "Respira lento. En cada exhalación: 'Estoy a salvo. Soy suficiente.'",
    lgbtq_affirming: "Inhala amabilidad; exhala vergüenza. Perteneces.",
    ancestral: "Mano en el corazón. Imagina a un ancestro dándote fuerza..."
  }
};

// Implement each tool's logic
const toolImpl = {
  async get_meditation({ category, language, duration }) {
    const lib = MEDITATIONS[language] || MEDITATIONS.en;
    const script = lib[category] || lib.grounding;
    return {
      title: `${category} • ${duration} min`,
      language,
      duration,
      audioUrl: null, // Add your audio URL if available
      script
    };
  },
  async log_checkin({ mood, notes }) {
    // TODO: Save to your DB if you have one
    return { ok: true, mood, notes: notes || "" };
  },
  async handoff_crisis() {
    return {
      message_en: "If you’re in immediate danger, call 911. In the U.S., dial or text 988 for the Suicide & Crisis Lifeline.",
      message_es: "Si estás en peligro inmediato, llama al 911. En EE. UU., marca o envía texto al 988 para la Línea de Suicidio y Crisis."
    };
  }
};

// CalmaLink's tone and safety rules
const SYSTEM_PROMPT = `
You are CalmaLink, a warm, concise, trauma-informed, bilingual (EN/ES) mindfulness guide.
- Default to the user's last language; ask “English or Español?” if unclear.
- Ask consent before sensitive topics or logging; continue without logging if no consent.
- Offer culturally rooted options (ancestral, community, LGBTQ+ affirming, postpartum).
- Do not diagnose or replace care. If crisis signals appear, call handoff_crisis immediately.
- Prefer tool calls for meditations, mood logging, crisis handoff.
- Short paragraphs; one actionable step at a time.
`;

// CORS setup (no changes needed)
function withCORS(res, origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// Vercel serverless function handler
export default async function handler(req, res) {
  withCORS(res, req.headers.origin || "");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { messages } = req.body;

    // First model call (may request a tool call)
    const first = await openai.responses.create({
      model: "gpt-5", // You can use gpt-4o or gpt-4o-mini for cost savings
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        ...(Array.isArray(messages) ? messages : [])
      ],
      tools,
      tool_choice: "auto"
    });

    // Handle tool call
    const tc = first.output?.[0]?.tool_call;
    if (tc?.name) {
      const args = tc.arguments ? JSON.parse(tc.arguments) : {};
      const result = await toolImpl[tc.name](args);

      const followup = await openai.responses.create({
        model: "gpt-5",
        input: [
          { role: "system", content: SYSTEM_PROMPT },
          ...(Array.isArray(messages) ? messages : []),
          { role: "tool", name: tc.name, content: JSON.stringify(result) }
        ]
      });

      const text = followup.output_text || "Lo siento, hubo un problema. / Sorry, something went wrong.";
      return res.status(200).json({ message: text, tool: { name: tc.name, result } });
    }

    // No tool call, just text
    const text = first.output_text || "Lo siento, hubo un problema. / Sorry, something went wrong.";
    return res.status(200).json({ message: text });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
}

