import { GoogleGenAI } from "@google/genai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GEMINI_MODEL = "gemini-2.5-flash";
const ELEVENLABS_MUSIC_URL = "https://api.elevenlabs.io/v1/music";
type StylePresetKey = "dance-pop" | "electro-rock" | "arcade-funk" | "power-pop";
type MoodKey = "happy" | "epic" | "space" | "bold";
type EnergyKey = "medium" | "high";
type BeatKey = "steady" | "bouncy" | "turbo";

type SongRequest = {
  style?: StylePresetKey;
  mood?: MoodKey;
  energy?: EnergyKey;
  beat?: BeatKey;
  details?: string;
};

type PlannedSection = {
  sectionName: string;
  durationMs: number;
  positiveLocalStyles: string[];
  negativeLocalStyles: string[];
  lines: string[];
};

type SongPlan = {
  title: string;
  summary: string;
  bpm: number;
  positiveGlobalStyles: string[];
  negativeGlobalStyles: string[];
  sections: PlannedSection[];
};

const STYLE_PRESETS: Record<
  StylePresetKey,
  {
    label: string;
    bpm: number;
    prompt: string;
    styles: string[];
  }
> = {
  "dance-pop": {
    label: "Dance Pop",
    bpm: 118,
    prompt: "dance-pop with bright synth hooks, playful rhythm guitar, and a huge beat",
    styles: ["dance pop", "bright synths", "rhythm guitar", "big drums"],
  },
  "electro-rock": {
    label: "Electro Rock",
    bpm: 124,
    prompt: "electro-rock with punchy drums, crunchy guitars, and high-energy chorus moments",
    styles: ["electro rock", "punchy drums", "electric guitar", "arena energy"],
  },
  "arcade-funk": {
    label: "Arcade Funk",
    bpm: 112,
    prompt: "arcade funk with slap bass, playful chants, rhythmic guitar chops, and video game sparkle",
    styles: ["arcade funk", "playful bass", "rhythmic guitar", "retro game sparkle"],
  },
  "power-pop": {
    label: "Power Pop",
    bpm: 128,
    prompt: "power pop with catchy riffs, huge drums, singalong hooks, and festival energy",
    styles: ["power pop", "catchy riffs", "huge drums", "singalong hook"],
  },
};

const MOODS: Record<MoodKey, { label: string; prompt: string; styles: string[] }> = {
  happy: {
    label: "Happy",
    prompt: "happy, colorful, playful, kid-friendly",
    styles: ["happy", "colorful", "playful", "kid friendly"],
  },
  epic: {
    label: "Epic",
    prompt: "heroic, exciting, adventurous, and larger than life",
    styles: ["heroic", "exciting", "adventurous", "big chorus"],
  },
  space: {
    label: "Space",
    prompt: "spacey, futuristic, shiny, and full of neon motion",
    styles: ["spacey", "futuristic", "neon", "shiny"],
  },
  bold: {
    label: "Bold",
    prompt: "bold, confident, high-energy, and a little mischievous",
    styles: ["bold", "confident", "high energy", "mischievous"],
  },
};

const ENERGY_PRESETS: Record<EnergyKey, { label: string; bpmOffset: number; styles: string[] }> = {
  medium: {
    label: "Medium",
    bpmOffset: 0,
    styles: ["steady momentum", "clear groove"],
  },
  high: {
    label: "High",
    bpmOffset: 10,
    styles: ["high energy", "fast drive", "strong impact"],
  },
};

const BEAT_PRESETS: Record<BeatKey, { label: string; prompt: string; bpmOffset: number; styles: string[] }> = {
  steady: {
    label: "Steady",
    prompt: "steady four-on-the-floor beat with a clear kick and snare",
    bpmOffset: 0,
    styles: ["steady beat", "clear downbeats"],
  },
  bouncy: {
    label: "Bouncy",
    prompt: "bouncy groove with clear rhythmic accents",
    bpmOffset: 4,
    styles: ["bouncy groove", "rhythmic accents"],
  },
  turbo: {
    label: "Turbo",
    prompt: "fast arcade groove with crisp, chart-friendly accents",
    bpmOffset: 8,
    styles: ["fast groove", "arcade pace", "chart friendly accents"],
  },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function cleanDetails(details: string | undefined) {
  return (details ?? "")
    .replace(/[^\w\s,.'!-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function getGeminiApiKey() {
  return (
    process.env.GEMINI_API_KEY ??
    process.env.GOOGLE_API_KEY ??
    process.env.Gemini_API_Key
  );
}

function getElevenLabsApiKey() {
  return (
    process.env.ELEVENLABS_API_KEY ??
    process.env.ElevenLabs_API_Key
  );
}

function buildPromptContext(request: SongRequest) {
  const style = STYLE_PRESETS[request.style ?? "dance-pop"] ?? STYLE_PRESETS["dance-pop"];
  const mood = MOODS[request.mood ?? "happy"] ?? MOODS.happy;
  const energy = ENERGY_PRESETS[request.energy ?? "medium"] ?? ENERGY_PRESETS.medium;
  const beat = BEAT_PRESETS[request.beat ?? "steady"] ?? BEAT_PRESETS.steady;
  const details = cleanDetails(request.details);
  const bpm = clamp(style.bpm + energy.bpmOffset + beat.bpmOffset, 100, 148);
  const summary = `${style.label} • ${mood.label} • ${beat.label}`;

  return {
    style,
    mood,
    energy,
    beat,
    bpm,
    details,
    summary,
  };
}

function songPlanSchema() {
  return {
    type: "object",
    required: [
      "title",
      "summary",
      "bpm",
      "positiveGlobalStyles",
      "negativeGlobalStyles",
      "sections",
    ],
    properties: {
      title: { type: "string" },
      summary: { type: "string" },
      bpm: { type: "number" },
      positiveGlobalStyles: {
        type: "array",
        items: { type: "string" },
      },
      negativeGlobalStyles: {
        type: "array",
        items: { type: "string" },
      },
      sections: {
        type: "array",
        minItems: 3,
        maxItems: 4,
        items: {
          type: "object",
          required: [
            "sectionName",
            "durationMs",
            "positiveLocalStyles",
            "negativeLocalStyles",
            "lines",
          ],
          properties: {
            sectionName: { type: "string" },
            durationMs: { type: "number" },
            positiveLocalStyles: {
              type: "array",
              items: { type: "string" },
            },
            negativeLocalStyles: {
              type: "array",
              items: { type: "string" },
            },
            lines: {
              type: "array",
              minItems: 1,
              maxItems: 4,
              items: { type: "string" },
            },
          },
        },
      },
    },
  };
}

function normalizePlan(plan: SongPlan, fallbackSummary: string, fallbackBpm: number) {
  const sections = (plan.sections ?? [])
    .slice(0, 4)
    .map((section) => ({
      sectionName: String(section.sectionName || "Section").slice(0, 40),
      durationMs: clamp(Number(section.durationMs || 5000), 3500, 7000),
      positiveLocalStyles: (section.positiveLocalStyles ?? [])
        .map((item) => String(item).slice(0, 50))
        .filter(Boolean)
        .slice(0, 6),
      negativeLocalStyles: (section.negativeLocalStyles ?? [])
        .map((item) => String(item).slice(0, 50))
        .filter(Boolean)
        .slice(0, 6),
      lines: (section.lines ?? [])
        .map((line) => String(line).trim().slice(0, 120))
        .filter(Boolean)
        .slice(0, 4),
    }))
    .filter((section) => section.lines.length > 0);

  if (sections.length === 0) {
    sections.push({
      sectionName: "Hook",
      durationMs: 5000,
      positiveLocalStyles: ["catchy hook", "clear singing"],
      negativeLocalStyles: ["mumbling", "slow intro"],
      lines: ["Turn it up, we shine tonight", "Jump to the beat and feel the light"],
    });
  }

  return {
    title: String(plan.title || "Gemini Star Beat").slice(0, 80),
    summary: String(plan.summary || fallbackSummary).slice(0, 120),
    bpm: clamp(Number(plan.bpm || fallbackBpm), 96, 150),
    positiveGlobalStyles: (plan.positiveGlobalStyles ?? [])
      .map((item) => String(item).slice(0, 60))
      .filter(Boolean)
      .slice(0, 12),
    negativeGlobalStyles: (plan.negativeGlobalStyles ?? [])
      .map((item) => String(item).slice(0, 60))
      .filter(Boolean)
      .slice(0, 12),
    sections,
  };
}

async function generateLyricsPlan(request: SongRequest) {
  const geminiApiKey = getGeminiApiKey();
  if (!geminiApiKey) {
    throw new Error("Missing Gemini API key on the server.");
  }

  const context = buildPromptContext(request);
  const ai = new GoogleGenAI({
    apiKey: geminiApiKey,
  });

  const prompt = [
    "Create a short sung pop song plan for a kids rhythm game.",
    `Style: ${context.style.prompt}.`,
    `Mood: ${context.mood.prompt}.`,
    `Energy: ${context.energy.label}.`,
    `Beat target: ${context.beat.prompt}.`,
    `Target BPM: ${context.bpm}.`,
    "The result must be ideal for a Guitar Hero style game: punchy beat, clear accents, fast hook, easy-to-hear chorus rhythm.",
    "Lyrics must be original, child-friendly, simple, catchy, and easy to sing.",
    "No references to existing songs or artists. No profanity. No romance. No acoustic campfire vibe. No long intro.",
    "Keep the full song around 20 seconds total, divided into 3 or 4 short sections.",
    "Every section should include 1 to 4 short lyric lines.",
    context.details ? `Extra idea from the player: ${context.details}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: songPlanSchema(),
    },
  });

  if (!response.text) {
    throw new Error("Gemini did not return a song plan.");
  }

  const parsed = JSON.parse(response.text) as SongPlan;
  return normalizePlan(parsed, context.summary, context.bpm);
}

async function composeWithElevenLabs(plan: SongPlan) {
  const elevenLabsApiKey = getElevenLabsApiKey();
  if (!elevenLabsApiKey) {
    throw new Error("Missing ElevenLabs API key on the server.");
  }

  const response = await fetch(ELEVENLABS_MUSIC_URL, {
    method: "POST",
    headers: {
      "xi-api-key": elevenLabsApiKey,
      "content-type": "application/json",
      accept: "audio/mpeg",
    },
    body: JSON.stringify({
      composition_plan: {
        positive_global_styles: [
          ...plan.positiveGlobalStyles,
          "clear lead vocals",
          "strong beat",
          "rhythm game friendly timing",
        ],
        negative_global_styles: [
          ...plan.negativeGlobalStyles,
          "spoken word",
          "mumbled vocals",
          "slow intro",
          "ambient drift",
        ],
        sections: plan.sections.map((section) => ({
          section_name: section.sectionName,
          duration_ms: section.durationMs,
          positive_local_styles: section.positiveLocalStyles,
          negative_local_styles: section.negativeLocalStyles,
          lines: section.lines,
        })),
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 401 && errorText.includes("music_generation")) {
      throw new Error(
        "Your ElevenLabs API key is valid, but it does not have music_generation permission. Enable ElevenLabs Music access for this account or use a key from an account that has it.",
      );
    }
    throw new Error(
      `ElevenLabs music request failed (${response.status}): ${errorText.slice(0, 300)}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SongRequest;
    const plan = await generateLyricsPlan(body);
    const audio = await composeWithElevenLabs(plan);
    const lyrics = plan.sections.flatMap((section) => section.lines);

    return Response.json(
      {
        title: plan.title,
        summary: plan.summary,
        bpm: plan.bpm,
        mimeType: "audio/mpeg",
        audioBase64: audio.toString("base64"),
        lyrics,
        sections: plan.sections.map((section) => ({
          name: section.sectionName,
          lines: section.lines,
        })),
      },
      {
        headers: {
          "cache-control": "no-store",
        },
      },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Song generation failed unexpectedly.";
    return Response.json(
      {
        error: message,
      },
      { status: 500 },
    );
  }
}
