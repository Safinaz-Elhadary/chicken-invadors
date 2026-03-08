"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

type GameMode = "intro" | "playing" | "paused" | "gameover";
type CameraState = "idle" | "ready" | "blocked";
type TrackerStatus = "idle" | "loading" | "ready" | "error";
type CameraControlMode = "none" | "hand" | "motion";

type Note = {
  id: number;
  lane: number;
  time: number;
  frequency: number;
  judged: boolean;
  hit: boolean;
};

type SongEvent = {
  time: number;
  kind: "chord" | "lead" | "kick" | "snare";
  frequency?: number;
  frequencies?: number[];
  duration: number;
  gain: number;
  waveform: OscillatorType;
};

type SongChart = {
  title: string;
  bpm: number;
  beatSeconds: number;
  totalTime: number;
  notes: Note[];
  events: SongEvent[];
};

type SongAsset = {
  key: string;
  title: string;
  src: string;
  summary: string;
  lyrics: string[];
  bpmHint?: number;
  generated: boolean;
};

type SongFormState = {
  style: "dance-pop" | "electro-rock" | "arcade-funk" | "power-pop";
  mood: "happy" | "epic" | "space" | "bold";
  energy: "medium" | "high";
  beat: "steady" | "bouncy" | "turbo";
  details: string;
};

type Flash = {
  lane: number;
  ttl: number;
  kind: "hit" | "miss";
};

type CelebrationNote = {
  id: number;
  lane: number;
  side: "left" | "right";
  ttl: number;
  totalTtl: number;
  driftX: number;
  driftY: number;
  sway: number;
  size: number;
  spin: number;
};

type ControlState = {
  lane: number;
  x: number;
  y: number;
  source: "camera" | "mouse" | "keyboard";
  handVisible: boolean;
  pinch: boolean;
};

type GameState = {
  mode: GameMode;
  song: SongChart;
  notes: Note[];
  songTime: number;
  score: number;
  combo: number;
  streak: number;
  multiplier: number;
  flash: Flash | null;
  celebrationNotes: CelebrationNote[];
  message: string;
  nextSongEventIndex: number;
};

type AudioRig = {
  ctx: AudioContext;
  master: GainNode;
};

type HandPoint = {
  x: number;
  y: number;
};

type HandLandmarkerLike = {
  close?: () => void;
  detectForVideo: (
    video: HTMLVideoElement,
    timestampMs: number,
  ) => {
    landmarks?: HandPoint[][];
  };
};

const LANE_COUNT = 4;
const LANE_LABELS = ["GREEN", "RED", "YELLOW", "BLUE"];
const SONG_LEAD_IN = 2.4;
const APPROACH_SECONDS = 3.6;
const HIT_WINDOW = 0.26;
const MISS_WINDOW = 0.34;
const FLASH_SECONDS = 0.18;
const CELEBRATION_SECONDS = 0.9;
const BASE_WIDTH = 1280;
const PROVIDED_SONG_TITLE = "Sample Music 1";
const PROVIDED_SONG_PATH = "/music/sample-music-1.mp3";
const KEY_TO_LANE: Record<string, number> = {
  a: 0,
  s: 1,
  d: 2,
  f: 3,
};
const DEFAULT_SONG_ASSET: SongAsset = {
  key: "provided-sample",
  title: PROVIDED_SONG_TITLE,
  src: PROVIDED_SONG_PATH,
  summary: "Sample beat",
  lyrics: [],
  bpmHint: 100,
  generated: false,
};
const DEFAULT_SONG_FORM: SongFormState = {
  style: "dance-pop",
  mood: "happy",
  energy: "medium",
  beat: "steady",
  details: "",
};

const CHORD_LIBRARY = [
  [196, 246.94, 293.66],
  [220, 261.63, 329.63],
  [174.61, 220, 261.63],
  [146.83, 220, 293.66],
];
const CHORD_LANE_WEIGHTS = [
  [0, 2, 1, 0],
  [1, 3, 2, 1],
  [0, 1, 2, 2],
  [0, 2, 3, 1],
];
const LEAD_NOTES = [392, 440, 493.88, 523.25];
const CANVAS_NOTE_COLORS = ["#35ff85", "#ff5168", "#ffd84a", "#5ca9ff"];
const OPENING_RIFFS = [
  [0, 1, 2, 1],
  [0, 2, 1, 3],
  [0, 1, 0, 2],
  [0, 3, 2, 1],
];
const PROGRESSIONS = [
  [0, 1, 2, 3],
  [0, 2, 1, 3],
  [3, 0, 1, 2],
  [0, 3, 2, 1],
];
const TITLE_WORD_A = [
  "Neon",
  "Midnight",
  "Silver",
  "Velvet",
  "Echo",
  "Chrome",
  "Solar",
  "Electric",
];
const TITLE_WORD_B = [
  "Runway",
  "Static",
  "Mirage",
  "Afterglow",
  "Voltage",
  "Wildfire",
  "Satellite",
  "Pulse",
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function lerp(start: number, end: number, t: number) {
  return start + (end - start) * t;
}

function createSeededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pickRandom<T>(items: T[], random: () => number) {
  return items[Math.floor(random() * items.length)] ?? items[0];
}

function createSongTitle(random: () => number) {
  return `${pickRandom(TITLE_WORD_A, random)} ${pickRandom(TITLE_WORD_B, random)}`;
}

function chooseLaneForChord(
  chordIndex: number,
  previousLane: number,
  random: () => number,
) {
  const weighted = CHORD_LANE_WEIGHTS[chordIndex] ?? [0, 1, 2, 3];
  const pool = [
    weighted[0],
    weighted[1],
    weighted[2],
    weighted[3],
    previousLane,
    clamp(previousLane + (random() > 0.5 ? 1 : -1), 0, LANE_COUNT - 1),
  ];
  return pickRandom(pool, random);
}

function cloneSongNotes(notes: Note[]) {
  return notes.map((note) => ({
    ...note,
    judged: false,
    hit: false,
  }));
}

function createCelebrationNotes(lane: number) {
  const notes: CelebrationNote[] = [];
  const patterns = [
    { side: "left" as const, driftX: -44, driftY: -170, sway: 28, size: 0.88, spin: -0.2 },
    { side: "left" as const, driftX: -76, driftY: -126, sway: 24, size: 0.72, spin: -0.38 },
    { side: "left" as const, driftX: -30, driftY: -210, sway: 18, size: 0.8, spin: -0.14 },
    { side: "right" as const, driftX: 44, driftY: -170, sway: 28, size: 0.88, spin: 0.2 },
    { side: "right" as const, driftX: 76, driftY: -126, sway: 24, size: 0.72, spin: 0.38 },
    { side: "right" as const, driftX: 30, driftY: -210, sway: 18, size: 0.8, spin: 0.14 },
  ];

  for (let index = 0; index < patterns.length; index += 1) {
    const pattern = patterns[index]!;
    notes.push({
      id: lane * 100 + index,
      lane,
      side: pattern.side,
      ttl: CELEBRATION_SECONDS,
      totalTtl: CELEBRATION_SECONDS,
      driftX: pattern.driftX,
      driftY: pattern.driftY,
      sway: pattern.sway,
      size: pattern.size,
      spin: pattern.spin,
    });
  }

  return notes;
}

function createPreviewSongChart(): SongChart {
  return {
    title: PROVIDED_SONG_TITLE,
    bpm: 92,
    beatSeconds: 60 / 92,
    totalTime: SONG_LEAD_IN + 16,
    notes: [
      {
        id: 0,
        lane: 0,
        time: SONG_LEAD_IN + 0.7,
        frequency: LEAD_NOTES[0],
        judged: false,
        hit: false,
      },
      {
        id: 1,
        lane: 3,
        time: SONG_LEAD_IN + 1.4,
        frequency: LEAD_NOTES[3],
        judged: false,
        hit: false,
      },
    ],
    events: [],
  };
}

function estimateBeatSeconds(beatTimes: number[]) {
  const intervals = beatTimes
    .slice(1)
    .map((time, index) => time - beatTimes[index]!)
    .filter((interval) => interval >= 0.35 && interval <= 1.2)
    .sort((left, right) => left - right);

  if (intervals.length === 0) {
    return 60 / 92;
  }

  return intervals[Math.floor(intervals.length / 2)] ?? 60 / 92;
}

function nearestPeakDistance(time: number, peaks: Array<{ time: number; energy: number }>) {
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const peak of peaks) {
    const distance = Math.abs(peak.time - time);
    if (distance < bestDistance) {
      bestDistance = distance;
    }
  }

  return bestDistance;
}

function buildSongChartFromAudioBuffer(buffer: AudioBuffer, title = PROVIDED_SONG_TITLE): SongChart {
  const sampleRate = buffer.sampleRate;
  const channelCount = buffer.numberOfChannels;
  const channels = Array.from({ length: channelCount }, (_, index) =>
    buffer.getChannelData(index),
  );
  const hopSize = Math.max(1, Math.floor(sampleRate * 0.12));
  const windowSize = Math.max(hopSize, Math.floor(sampleRate * 0.18));
  const energies: number[] = [];
  const times: number[] = [];

  for (let start = 0; start + windowSize < buffer.length; start += hopSize) {
    let sum = 0;

    for (let offset = 0; offset < windowSize; offset += 1) {
      let mixed = 0;
      for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
        mixed += channels[channelIndex]![start + offset] ?? 0;
      }
      mixed /= channelCount || 1;
      sum += mixed * mixed;
    }

    energies.push(Math.sqrt(sum / windowSize));
    times.push(start / sampleRate);
  }

  const averageEnergy =
    energies.reduce((total, value) => total + value, 0) / Math.max(1, energies.length);
  const peaks: Array<{ time: number; energy: number }> = [];
  let lastPeakTime = -Infinity;

  for (let index = 2; index < energies.length - 2; index += 1) {
    const energy = energies[index]!;
    const localAverage =
      (energies[index - 2]! +
        energies[index - 1]! +
        energies[index]! +
        energies[index + 1]! +
        energies[index + 2]!) /
      5;
    const time = times[index]!;
    const isPeak = energy >= energies[index - 1]! && energy >= energies[index + 1]!;

    if (
      time > 0.25 &&
      time < buffer.duration - 0.2 &&
      isPeak &&
      energy > Math.max(averageEnergy * 1.35, localAverage * 1.12) &&
      time - lastPeakTime > 0.28
    ) {
      peaks.push({ time, energy });
      lastPeakTime = time;
    }
  }

  if (peaks.length < 12) {
    peaks.length = 0;
    for (let time = 0.55; time < buffer.duration - 0.2; time += 0.65) {
      peaks.push({ time, energy: averageEnergy });
    }
  }

  const beatTimes = peaks.map((peak) => peak.time);
  const beatSeconds = estimateBeatSeconds(beatTimes);
  const bpm = Math.round(60 / beatSeconds);
  const subdivision = Math.max(0.22, beatSeconds / 2);
  const firstBeat = peaks[0]?.time ?? 0.55;
  const noteMoments: Array<{ time: number; energy: number }> = [...peaks];

  for (
    let time = Math.max(0.55, firstBeat - subdivision);
    time < buffer.duration - 0.2;
    time += subdivision
  ) {
    const distanceToPeak = nearestPeakDistance(time, peaks);
    if (distanceToPeak <= subdivision * 0.2) {
      continue;
    }

    const energyIndex = clamp(Math.round(time / (hopSize / sampleRate)), 0, energies.length - 1);
    const localEnergy = energies[energyIndex] ?? averageEnergy;
    noteMoments.push({
      time,
      energy: localEnergy,
    });
  }

  noteMoments.sort((left, right) => left.time - right.time);
  const notes: Note[] = [];
  let previousLane = 0;
  let id = 0;

  for (let index = 0; index < noteMoments.length; index += 1) {
    const moment = noteMoments[index]!;
    const energyRatio = moment.energy / Math.max(averageEnergy, 0.0001);
    const distanceToPeak = nearestPeakDistance(moment.time, peaks);
    const isPeakNote = distanceToPeak < subdivision * 0.22;
    let lane = index % LANE_COUNT;

    if (index >= 4) {
      if (isPeakNote && energyRatio > 1.7) {
        lane = (previousLane + 2) % LANE_COUNT;
      } else if (index % 5 === 0 || !isPeakNote) {
        lane = (previousLane + 3) % LANE_COUNT;
      } else {
        lane = (previousLane + 1 + (energyRatio > 1.45 ? 1 : 0)) % LANE_COUNT;
      }
    }

    if (lane === previousLane && index % 2 === 0) {
      lane = (lane + 1) % LANE_COUNT;
    }

    notes.push({
      id,
      lane,
      time: SONG_LEAD_IN + moment.time,
      frequency: LEAD_NOTES[lane] ?? LEAD_NOTES[0],
      judged: false,
      hit: false,
    });
    id += 1;
    previousLane = lane;
  }

  return {
    title,
    bpm,
    beatSeconds,
    totalTime: SONG_LEAD_IN + buffer.duration + 1.5,
    notes,
    events: [],
  };
}

function createSongChart(seed: number): SongChart {
  const random = createSeededRandom(seed);
  const bpm = 84 + Math.floor(random() * 9) * 2;
  const beatSeconds = 60 / bpm;
  const measureCount = 8;
  const progression = pickRandom(PROGRESSIONS, random);
  const openingRiff = pickRandom(OPENING_RIFFS, random);
  const notes: Note[] = [];
  const events: SongEvent[] = [];
  let previousLane = 0;
  let id = 0;

  for (let measure = 0; measure < measureCount; measure += 1) {
    const chordIndex = progression[measure % progression.length] ?? 0;
    const chord = CHORD_LIBRARY[chordIndex] ?? CHORD_LIBRARY[0];

    for (let beat = 0; beat < 4; beat += 1) {
      const beatTime = SONG_LEAD_IN + (measure * 4 + beat) * beatSeconds;
      events.push({
        time: beatTime,
        kind: "chord",
        frequencies: chord,
        duration: beat === 0 ? 0.42 : 0.3,
        gain: beat === 0 ? 0.12 : 0.085,
        waveform: "triangle",
      });
      events.push({
        time: beatTime,
        kind: beat % 2 === 0 ? "kick" : "snare",
        frequency: beat % 2 === 0 ? 110 : 210,
        duration: beat % 2 === 0 ? 0.1 : 0.06,
        gain: beat % 2 === 0 ? 0.08 : 0.05,
        waveform: beat % 2 === 0 ? "triangle" : "square",
      });
    }

    for (let slot = 0; slot < 8; slot += 1) {
      const beatPosition = measure * 4 + slot * 0.5;
      const noteTime = SONG_LEAD_IN + beatPosition * beatSeconds;
      const isQuarterBeat = slot % 2 === 0;
      const openingLane =
        measure === 0 && isQuarterBeat ? openingRiff[Math.floor(slot / 2)] : undefined;
      const shouldPlaceNote =
        openingLane !== undefined ||
        random() < (isQuarterBeat ? 0.72 : 0.32) ||
        (measure === measureCount - 1 && slot === 6);

      if (!shouldPlaceNote) {
        continue;
      }

      const lane =
        openingLane ?? chooseLaneForChord(chordIndex, previousLane, random);
      const frequency = LEAD_NOTES[lane] ?? LEAD_NOTES[0];

      notes.push({
        id,
        lane,
        time: noteTime,
        frequency,
        judged: false,
        hit: false,
      });
      events.push({
        time: noteTime,
        kind: "lead",
        frequency,
        duration: isQuarterBeat ? 0.16 : 0.12,
        gain: isQuarterBeat ? 0.07 : 0.05,
        waveform: "sawtooth",
      });
      id += 1;
      previousLane = lane;
    }
  }

  events.sort((left, right) => left.time - right.time);

  return {
    title: createSongTitle(random),
    bpm,
    beatSeconds,
    totalTime: SONG_LEAD_IN + measureCount * 4 * beatSeconds + 2,
    notes,
    events,
  };
}

function createGameState(song: SongChart = createPreviewSongChart()): GameState {
  return {
    mode: "intro",
    song,
    notes: cloneSongNotes(song.notes),
    songTime: 0,
    score: 0,
    combo: 0,
    streak: 0,
    multiplier: 1,
    flash: null,
    celebrationNotes: [],
    message: "Create a beat and start the camera game.",
    nextSongEventIndex: 0,
  };
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawStatusChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
) {
  ctx.save();
  ctx.font = "600 14px var(--font-geist-sans)";
  const width = ctx.measureText(label).width + 28;
  drawRoundedRect(ctx, x, y, width, 34, 17);
  ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
  ctx.fill();
  ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
  ctx.fillText(label, x + 14, y + 22);
  ctx.restore();
}

function drawQuadPath(
  ctx: CanvasRenderingContext2D,
  leftTopX: number,
  rightTopX: number,
  topY: number,
  rightBottomX: number,
  leftBottomX: number,
  bottomY: number,
) {
  ctx.beginPath();
  ctx.moveTo(leftTopX, topY);
  ctx.lineTo(rightTopX, topY);
  ctx.lineTo(rightBottomX, bottomY);
  ctx.lineTo(leftBottomX, bottomY);
  ctx.closePath();
}

function drawMusicNote(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  color: string,
  rotation: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(scale, scale);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(-4, 10, 10, 7, -0.36, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(2, -26, 5, 34);
  ctx.beginPath();
  ctx.moveTo(7, -26);
  ctx.quadraticCurveTo(23, -18, 20, -4);
  ctx.quadraticCurveTo(16, -10, 7, -12);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function makeMotionCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 72;
  return canvas;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const trackingFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<AudioRig | null>(null);
  const songAudioRef = useRef<HTMLAudioElement | null>(null);
  const songDuckTimeoutRef = useRef<number | null>(null);
  const currentSongAssetRef = useRef<SongAsset>(DEFAULT_SONG_ASSET);
  const loadedSongRef = useRef<{ key: string; chart: SongChart } | null>(null);
  const songChartPromiseRef = useRef<{ key: string; promise: Promise<SongChart> } | null>(null);
  const generatedSongUrlRef = useRef<string | null>(null);
  const generatedSongSignatureRef = useRef<string | null>(null);
  const songPlaybackRequestedRef = useRef(false);
  const handLandmarkerRef = useRef<HandLandmarkerLike | null>(null);
  const motionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const motionFrameRef = useRef<Uint8Array | null>(null);
  const motionLevelRef = useRef(0);
  const gameStateRef = useRef<GameState>(createGameState());
  const cameraStateRef = useRef<CameraState>("idle");
  const trackerStatusRef = useRef<TrackerStatus>("idle");
  const cameraControlModeRef = useRef<CameraControlMode>("none");
  const controlRef = useRef<ControlState>({
    lane: 0,
    x: 0.5,
    y: 0.5,
    source: "keyboard",
    handVisible: false,
    pinch: false,
  });
  const trackerCooldownRef = useRef(0);
  const lastTimestampRef = useRef(0);
  const lastRenderRef = useRef(0);
  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [trackerStatus, setTrackerStatus] = useState<TrackerStatus>("idle");
  const [cameraControlMode, setCameraControlMode] =
    useState<CameraControlMode>("none");
  const [trackerMessage, setTrackerMessage] = useState(
    "Make a song, then move your hand to play it.",
  );
  const [setupError, setSetupError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isGeneratingSong, setIsGeneratingSong] = useState(false);
  const [songGenerationError, setSongGenerationError] = useState<string | null>(null);
  const [songForm, setSongForm] = useState<SongFormState>(DEFAULT_SONG_FORM);
  const [currentSongLabel, setCurrentSongLabel] = useState(DEFAULT_SONG_ASSET.title);
  const [currentSongSummary, setCurrentSongSummary] = useState(DEFAULT_SONG_ASSET.summary);
  const [currentSongLyrics, setCurrentSongLyrics] = useState<string[]>(DEFAULT_SONG_ASSET.lyrics);
  const [hudTick, setHudTick] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setHudTick((value) => value + 1);
    }, 120);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    return () => {
      if (generatedSongUrlRef.current) {
        URL.revokeObjectURL(generatedSongUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    cameraStateRef.current = cameraState;
    trackerStatusRef.current = trackerStatus;
    cameraControlModeRef.current = cameraControlMode;
    drawScene();
  }, [cameraControlMode, cameraState, trackerStatus]);

  const resizeCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  };

  const ensureAudio = async () => {
    if (!audioRef.current) {
      const ctx = new window.AudioContext();
      const master = ctx.createGain();
      master.gain.value = 0.18;
      master.connect(ctx.destination);
      audioRef.current = { ctx, master };
    }

    if (audioRef.current.ctx.state === "suspended") {
      await audioRef.current.ctx.resume();
    }

    return audioRef.current;
  };

  const getCurrentSongAsset = () => currentSongAssetRef.current;

  const setCurrentSongAsset = (asset: SongAsset) => {
    const previousGeneratedUrl = generatedSongUrlRef.current;
    const previousAsset = currentSongAssetRef.current;

    currentSongAssetRef.current = asset;
    setCurrentSongLabel(asset.title);
    setCurrentSongSummary(asset.summary);
    setCurrentSongLyrics(asset.lyrics);
    loadedSongRef.current = null;
    songChartPromiseRef.current = null;
    stopSongPlayback();

    if (songAudioRef.current) {
      songAudioRef.current.pause();
      songAudioRef.current.src = "";
      songAudioRef.current = null;
    }

    if (
      previousGeneratedUrl &&
      previousGeneratedUrl !== asset.src &&
      previousAsset.generated
    ) {
      URL.revokeObjectURL(previousGeneratedUrl);
      generatedSongUrlRef.current = null;
    }

    if (asset.generated) {
      generatedSongUrlRef.current = asset.src;
    }
  };

  const ensureSongAudio = async () => {
    const asset = getCurrentSongAsset();

    if (!songAudioRef.current || songAudioRef.current.dataset.songKey !== asset.key) {
      const audio = new Audio(asset.src);
      audio.preload = "auto";
      audio.setAttribute("playsinline", "true");
      audio.dataset.songKey = asset.key;
      songAudioRef.current = audio;
    }

    const audio = songAudioRef.current;

    await new Promise<void>((resolve, reject) => {
      if (!audio) {
        reject(new Error("Song audio element is unavailable."));
        return;
      }

      if (audio.readyState >= 1) {
        resolve();
        return;
      }

      const onLoaded = () => {
        audio.removeEventListener("loadedmetadata", onLoaded);
        audio.removeEventListener("error", onError);
        resolve();
      };
      const onError = () => {
        audio.removeEventListener("loadedmetadata", onLoaded);
        audio.removeEventListener("error", onError);
        reject(new Error("Song file could not be loaded."));
      };

      audio.addEventListener("loadedmetadata", onLoaded, { once: true });
      audio.addEventListener("error", onError, { once: true });
      audio.load();
    });

    return audio;
  };

  const loadCurrentSongChart = async () => {
    const asset = getCurrentSongAsset();

    if (loadedSongRef.current?.key === asset.key) {
      return loadedSongRef.current.chart;
    }

    if (songChartPromiseRef.current?.key !== asset.key) {
      songChartPromiseRef.current = {
        key: asset.key,
        promise: (async () => {
        try {
          const audio = await ensureSongAudio();
          const ownsContext = !audioRef.current;
          const context = audioRef.current?.ctx ?? new window.AudioContext();
          const response = await fetch(asset.src);
          const data = await response.arrayBuffer();
          const buffer = await context.decodeAudioData(data.slice(0));
          const chart = buildSongChartFromAudioBuffer(buffer, asset.title);
          chart.title = asset.title;
          chart.bpm = asset.bpmHint ?? chart.bpm;
          chart.totalTime = SONG_LEAD_IN + (audio.duration || buffer.duration) + 1.5;
          if (ownsContext) {
            void context.close();
          }
          loadedSongRef.current = { key: asset.key, chart };
          return chart;
        } catch {
          const fallback = createSongChart(1337);
          fallback.title = asset.title;
          fallback.bpm = asset.bpmHint ?? fallback.bpm;
          loadedSongRef.current = { key: asset.key, chart: fallback };
          return fallback;
        }
      })(),
      };
    }

    return songChartPromiseRef.current.promise;
  };

  const stopSongPlayback = () => {
    const audio = songAudioRef.current;
    songPlaybackRequestedRef.current = false;

     if (songDuckTimeoutRef.current !== null) {
      window.clearTimeout(songDuckTimeoutRef.current);
      songDuckTimeoutRef.current = null;
    }

    if (!audio) {
      return;
    }

    audio.pause();
    audio.currentTime = 0;
    audio.volume = 0.64;
  };

  const updateSongForm = <K extends keyof SongFormState>(key: K, value: SongFormState[K]) => {
    setSongForm((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const generateSongAsset = async () => {
    setSongGenerationError(null);
    setIsGeneratingSong(true);

    try {
      const response = await fetch("/api/generate-song", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(songForm),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Song generation failed.");
      }

      const payload = (await response.json()) as {
        title?: string;
        bpm?: number;
        summary?: string;
        mimeType?: string;
        audioBase64?: string;
        lyrics?: string[];
      };

      if (!payload.audioBase64) {
        throw new Error("Generated song response did not include audio.");
      }

      const mimeType = payload.mimeType || "audio/mpeg";
      const binary = atob(payload.audioBase64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      const blob = new Blob([bytes], { type: mimeType });
      const title = payload.title || "Gemini Star Beat";
      const bpmHint = Number(payload.bpm ?? 120);
      const summary = payload.summary || "Fresh song";
      const objectUrl = URL.createObjectURL(blob);
      const asset: SongAsset = {
        key: `generated-${Date.now()}`,
        title,
        src: objectUrl,
        summary,
        lyrics: payload.lyrics ?? [],
        bpmHint,
        generated: true,
      };

      setCurrentSongAsset(asset);
      generatedSongSignatureRef.current = JSON.stringify(songForm);
      const chart = await loadCurrentSongChart();
      if (gameStateRef.current.mode === "intro") {
        gameStateRef.current = createGameState(chart);
        gameStateRef.current.message = `${asset.title} is ready. Start the camera game.`;
        drawScene();
      }
      return asset;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Song generation failed.";
      setSongGenerationError(message);
      throw error;
    } finally {
      setIsGeneratingSong(false);
    }
  };

  const playVoice = (
    audio: AudioRig,
    frequency: number,
    duration: number,
    gain: number,
    type: OscillatorType,
  ) => {
    const now = audio.ctx.currentTime;
    const oscillator = audio.ctx.createOscillator();
    const voiceGain = audio.ctx.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    voiceGain.gain.setValueAtTime(0.0001, now);
    voiceGain.gain.exponentialRampToValueAtTime(gain, now + 0.01);
    voiceGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(voiceGain);
    voiceGain.connect(audio.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  };

  const playLeadGuitar = (
    audio: AudioRig,
    frequency: number,
    accuracy: number,
  ) => {
    const now = audio.ctx.currentTime;
    const output = audio.ctx.createGain();
    const filter = audio.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1800 + accuracy * 1400, now);
    filter.Q.setValueAtTime(4.8, now);

    output.gain.setValueAtTime(0.0001, now);
    output.gain.exponentialRampToValueAtTime(0.44 + accuracy * 0.16, now + 0.008);
    output.gain.exponentialRampToValueAtTime(0.16, now + 0.1);
    output.gain.exponentialRampToValueAtTime(0.0001, now + 0.62);

    const frequencies = [frequency, frequency * 1.5, frequency * 2, frequency * 0.5];
    const types: OscillatorType[] = ["sawtooth", "triangle", "square", "triangle"];
    const gains = [1, 0.42, 0.22, 0.18];

    for (let index = 0; index < frequencies.length; index += 1) {
      const oscillator = audio.ctx.createOscillator();
      const voiceGain = audio.ctx.createGain();
      oscillator.type = types[index]!;
      oscillator.frequency.setValueAtTime(frequencies[index]!, now);
      oscillator.detune.setValueAtTime(
        index === 0 ? -5 : index === 1 ? 8 : index === 2 ? 14 : -12,
        now,
      );
      voiceGain.gain.setValueAtTime(gains[index]!, now);
      oscillator.connect(voiceGain);
      voiceGain.connect(filter);
      oscillator.start(now);
      oscillator.stop(now + 0.64);
    }

    filter.connect(output);
    output.connect(audio.master);

    const pluckNoise = audio.ctx.createBufferSource();
    const pluckBuffer = audio.ctx.createBuffer(1, Math.floor(audio.ctx.sampleRate * 0.08), audio.ctx.sampleRate);
    const data = pluckBuffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * (1 - index / data.length);
    }
    const noiseGain = audio.ctx.createGain();
    const noiseFilter = audio.ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(2100, now);
    noiseFilter.Q.setValueAtTime(0.9, now);
    noiseGain.gain.setValueAtTime(0.18, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    pluckNoise.buffer = pluckBuffer;
    pluckNoise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(audio.master);
    pluckNoise.start(now);
    pluckNoise.stop(now + 0.1);
  };

  const duckBackingTrack = (targetVolume: number, durationMs: number) => {
    const audio = songAudioRef.current;
    if (!audio) {
      return;
    }

    if (songDuckTimeoutRef.current !== null) {
      window.clearTimeout(songDuckTimeoutRef.current);
    }

    audio.volume = targetVolume;
    songDuckTimeoutRef.current = window.setTimeout(() => {
      audio.volume = 0.64;
      songDuckTimeoutRef.current = null;
    }, durationMs);
  };

  const playSongEvent = (event: SongEvent) => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (event.kind === "chord" && event.frequencies) {
      playVoice(audio, event.frequencies[0] / 2, event.duration, event.gain, event.waveform);
      playVoice(audio, event.frequencies[1], event.duration * 0.72, event.gain * 0.45, "sine");
      playVoice(audio, event.frequencies[2], event.duration * 0.72, event.gain * 0.38, "sine");
      return;
    }

    if (event.frequency) {
      playVoice(audio, event.frequency, event.duration, event.gain, event.waveform);
    }
  };

  const hitLane = (lane: number) => {
    const state = gameStateRef.current;
    if (state.mode !== "playing") {
      return;
    }

    const note = state.notes.find(
      (candidate) =>
        !candidate.judged &&
        candidate.lane === lane &&
        Math.abs(candidate.time - state.songTime) <= HIT_WINDOW,
    );

    if (note) {
      note.judged = true;
      note.hit = true;
      state.combo += 1;
      state.streak = Math.max(state.streak, state.combo);
      state.multiplier = 1 + Math.min(3, Math.floor(state.combo / 8));
      const accuracy = Math.max(
        0,
        1 - Math.abs(note.time - state.songTime) / HIT_WINDOW,
      );
      state.score += Math.round((100 + accuracy * 150) * state.multiplier);
      state.message = `${LANE_LABELS[lane]} lane nailed.`;
      state.flash = { lane, ttl: FLASH_SECONDS, kind: "hit" };
      state.celebrationNotes = [
        ...state.celebrationNotes.filter((effect) => effect.ttl > 0.08),
        ...createCelebrationNotes(lane),
      ];

      if (audioRef.current) {
        playLeadGuitar(audioRef.current, note.frequency, accuracy);
      }
      duckBackingTrack(0.14, 260);
      return;
    }

    state.combo = 0;
    state.multiplier = 1;
    state.message = `Missed the ${LANE_LABELS[lane]} lane.`;
    state.flash = { lane, ttl: FLASH_SECONDS, kind: "miss" };
  };

  const setLaneFromNormalizedX = (
    normalizedX: number,
    normalizedY: number,
    source: ControlState["source"],
  ) => {
    const lane = clamp(Math.floor(normalizedX * LANE_COUNT), 0, LANE_COUNT - 1);
    controlRef.current = {
      ...controlRef.current,
      lane,
      x: normalizedX,
      y: normalizedY,
      source,
      handVisible: source === "camera" ? true : controlRef.current.handVisible,
    };
  };

  const step = (deltaMs: number) => {
    const state = gameStateRef.current;
    const dt = Math.min(0.05, Math.max(0, deltaMs / 1000));

    if (state.mode === "playing") {
      const songAudio = songAudioRef.current;

      if (
        !songPlaybackRequestedRef.current &&
        state.songTime >= SONG_LEAD_IN &&
        songAudio
      ) {
        songPlaybackRequestedRef.current = true;
        songAudio.currentTime = 0;
        void songAudio.play().catch(() => {
          songPlaybackRequestedRef.current = false;
        });
      }

      if (songAudio && songPlaybackRequestedRef.current && !songAudio.paused) {
        state.songTime = SONG_LEAD_IN + songAudio.currentTime;
      } else {
        state.songTime += dt;
      }

      while (
        state.nextSongEventIndex < state.song.events.length &&
        state.songTime >= state.song.events[state.nextSongEventIndex]!.time
      ) {
        playSongEvent(state.song.events[state.nextSongEventIndex]!);
        state.nextSongEventIndex += 1;
      }

      for (const note of state.notes) {
        if (!note.judged && state.songTime - note.time > MISS_WINDOW) {
          note.judged = true;
          note.hit = false;
          state.combo = 0;
          state.multiplier = 1;
          state.message = `${LANE_LABELS[note.lane]} lane slipped away.`;
          state.flash = { lane: note.lane, ttl: FLASH_SECONDS, kind: "miss" };
        }
      }

      if (state.flash) {
        state.flash.ttl = Math.max(0, state.flash.ttl - dt);
        if (state.flash.ttl === 0) {
          state.flash = null;
        }
      }

      state.celebrationNotes = state.celebrationNotes
        .map((effect) => ({
          ...effect,
          ttl: Math.max(0, effect.ttl - dt),
        }))
        .filter((effect) => effect.ttl > 0);

      if (state.songTime >= state.song.totalTime || songAudio?.ended) {
        state.mode = "gameover";
        state.message = `${state.song.title} is over. Tap restart to replay the track.`;
        stopSongPlayback();
      }
    }

    trackerCooldownRef.current = Math.max(0, trackerCooldownRef.current - dt);
  };

  const drawScene = () => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const scale = canvas.width / BASE_WIDTH;
    const width = canvas.width / scale;
    const height = canvas.height / scale;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (video && video.readyState >= 2) {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(video, -width, 0, width, height);
      ctx.restore();
    } else {
      const backdrop = ctx.createLinearGradient(0, 0, 0, height);
      backdrop.addColorStop(0, "#081826");
      backdrop.addColorStop(1, "#02060a");
      ctx.fillStyle = backdrop;
      ctx.fillRect(0, 0, width, height);
    }

    const haze = ctx.createLinearGradient(0, 0, width, height);
    haze.addColorStop(0, "rgba(5, 14, 20, 0.42)");
    haze.addColorStop(0.5, "rgba(8, 16, 24, 0.74)");
    haze.addColorStop(1, "rgba(2, 8, 12, 0.92)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, width, height);

    const state = gameStateRef.current;
    const neckCenterX = width * 0.53;
    const neckTopY = height * 0.11;
    const neckBottomY = height * 0.9;
    const neckTopWidth = Math.min(width * 0.16, 210);
    const neckBottomWidth = Math.min(width * 0.42, 540);
    const fretTopInset = 18;
    const fretBottomInset = 26;
    const hitLineY = height * 0.79;
    const buttonY = height * 0.865;
    const boardLeftAt = (t: number) =>
      lerp(neckCenterX - neckTopWidth / 2, neckCenterX - neckBottomWidth / 2, t);
    const boardRightAt = (t: number) =>
      lerp(neckCenterX + neckTopWidth / 2, neckCenterX + neckBottomWidth / 2, t);
    const innerLeftAt = (t: number) => boardLeftAt(t) + lerp(fretTopInset, fretBottomInset, t);
    const innerRightAt = (t: number) =>
      boardRightAt(t) - lerp(fretTopInset, fretBottomInset, t);
    const laneCenterAt = (lane: number, t: number) =>
      lerp(innerLeftAt(t), innerRightAt(t), (lane + 0.5) / LANE_COUNT);
    const yAt = (t: number) => lerp(neckTopY, neckBottomY, t);

    const leftSpotlight = ctx.createRadialGradient(width * 0.2, height * 0.16, 40, width * 0.2, height * 0.16, width * 0.34);
    leftSpotlight.addColorStop(0, "rgba(255, 142, 196, 0.34)");
    leftSpotlight.addColorStop(1, "rgba(255, 142, 196, 0)");
    ctx.fillStyle = leftSpotlight;
    ctx.fillRect(0, 0, width, height);

    const rightSpotlight = ctx.createRadialGradient(width * 0.82, height * 0.18, 40, width * 0.82, height * 0.18, width * 0.3);
    rightSpotlight.addColorStop(0, "rgba(255, 103, 85, 0.28)");
    rightSpotlight.addColorStop(1, "rgba(255, 103, 85, 0)");
    ctx.fillStyle = rightSpotlight;
    ctx.fillRect(0, 0, width, height);

    const floorGlow = ctx.createLinearGradient(0, height * 0.58, 0, height);
    floorGlow.addColorStop(0, "rgba(0, 0, 0, 0)");
    floorGlow.addColorStop(1, "rgba(8, 3, 4, 0.54)");
    ctx.fillStyle = floorGlow;
    ctx.fillRect(0, height * 0.58, width, height * 0.42);

    const drawSpeakerStack = (x: number, y: number, scaleFactor: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scaleFactor, scaleFactor);
      for (let row = 0; row < 3; row += 1) {
        drawRoundedRect(ctx, 0, row * 92, 88, 82, 12);
        ctx.fillStyle = "rgba(12, 12, 16, 0.76)";
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
        ctx.lineWidth = 2;
        ctx.stroke();
        for (let speaker = 0; speaker < 2; speaker += 1) {
          const speakerY = row * 92 + 22 + speaker * 26;
          ctx.beginPath();
          ctx.arc(44, speakerY, 14, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(33, 33, 42, 0.9)";
          ctx.fill();
          ctx.beginPath();
          ctx.arc(44, speakerY, 6, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(108, 108, 124, 0.95)";
          ctx.fill();
        }
      }
      ctx.restore();
    };

    drawSpeakerStack(width * 0.04, height * 0.43, 1.08);
    drawSpeakerStack(width * 0.88, height * 0.36, 0.92);

    ctx.save();
    ctx.translate(neckCenterX, neckTopY - 64);
    ctx.rotate(-0.12);
    drawRoundedRect(ctx, -38, -12, 76, 104, 18);
    const headstockGradient = ctx.createLinearGradient(0, -12, 0, 92);
    headstockGradient.addColorStop(0, "rgba(121, 34, 27, 0.95)");
    headstockGradient.addColorStop(1, "rgba(39, 8, 8, 0.94)");
    ctx.fillStyle = headstockGradient;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    for (let peg = 0; peg < 4; peg += 1) {
      ctx.beginPath();
      ctx.arc(peg < 2 ? -18 : 18, 18 + (peg % 2) * 32, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    drawQuadPath(
      ctx,
      boardLeftAt(0),
      boardRightAt(0),
      neckTopY,
      boardRightAt(1),
      boardLeftAt(1),
      neckBottomY,
    );
    const borderGradient = ctx.createLinearGradient(neckCenterX, neckTopY, neckCenterX, neckBottomY);
    borderGradient.addColorStop(0, "rgba(211, 218, 225, 0.42)");
    borderGradient.addColorStop(0.5, "rgba(58, 70, 84, 0.7)");
    borderGradient.addColorStop(1, "rgba(181, 190, 201, 0.46)");
    ctx.fillStyle = borderGradient;
    ctx.fill();
    ctx.restore();

    ctx.save();
    drawQuadPath(
      ctx,
      innerLeftAt(0),
      innerRightAt(0),
      neckTopY + 4,
      innerRightAt(1),
      innerLeftAt(1),
      neckBottomY - 4,
    );
    const fretboardGradient = ctx.createLinearGradient(neckCenterX, neckTopY, neckCenterX, neckBottomY);
    fretboardGradient.addColorStop(0, "rgba(57, 20, 32, 0.92)");
    fretboardGradient.addColorStop(0.54, "rgba(20, 9, 18, 0.94)");
    fretboardGradient.addColorStop(1, "rgba(63, 13, 12, 0.94)");
    ctx.fillStyle = fretboardGradient;
    ctx.fill();
    ctx.clip();

    for (let vein = -8; vein < 18; vein += 1) {
      const startX = innerLeftAt(0) + vein * 38;
      const endX = innerLeftAt(1) + vein * 54;
      ctx.strokeStyle = vein % 2 === 0 ? "rgba(255,255,255,0.028)" : "rgba(255,180,160,0.022)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(startX, neckTopY + 8);
      ctx.lineTo(endX, neckBottomY - 8);
      ctx.stroke();
    }

    for (let fret = 0; fret <= 11; fret += 1) {
      const t = fret / 11;
      const y = yAt(t);
      ctx.strokeStyle = fret === 0 ? "rgba(255, 255, 255, 0.38)" : "rgba(255, 255, 255, 0.14)";
      ctx.lineWidth = fret === 0 ? 5 : 3;
      ctx.beginPath();
      ctx.moveTo(innerLeftAt(t), y);
      ctx.lineTo(innerRightAt(t), y);
      ctx.stroke();

      if ([2, 4, 6, 8, 10].includes(fret) && fret < 11) {
        const markerT = Math.min(1, t + 0.045);
        const markerX = lerp(innerLeftAt(markerT), innerRightAt(markerT), 0.5);
        ctx.beginPath();
        ctx.arc(markerX, yAt(markerT), lerp(4, 9, markerT), 0, Math.PI * 2);
        ctx.fillStyle = "rgba(248, 228, 169, 0.18)";
        ctx.fill();
      }
    }

    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const laneRatio = (lane + 0.5) / LANE_COUNT;
      const stringTopX = lerp(innerLeftAt(0), innerRightAt(0), laneRatio);
      const stringBottomX = lerp(innerLeftAt(1), innerRightAt(1), laneRatio);
      ctx.strokeStyle =
        lane === controlRef.current.lane
          ? "rgba(255, 255, 255, 0.88)"
          : "rgba(242, 242, 242, 0.44)";
      ctx.lineWidth = lane === controlRef.current.lane ? 3.6 : 2.2;
      ctx.beginPath();
      ctx.moveTo(stringTopX, neckTopY);
      ctx.lineTo(stringBottomX, neckBottomY);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(255, 246, 224, 0.92)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(innerLeftAt(0.86), hitLineY);
    ctx.lineTo(innerRightAt(0.86), hitLineY);
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
    drawRoundedRect(
      ctx,
      innerLeftAt(0.86),
      hitLineY - 16,
      innerRightAt(0.86) - innerLeftAt(0.86),
      32,
      10,
    );
    ctx.fill();
    ctx.restore();

    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const buttonX = laneCenterAt(lane, 1);
      const isActiveLane = lane === controlRef.current.lane;
      ctx.save();
      ctx.translate(buttonX, buttonY);
      ctx.scale(1.08, 0.78);
      ctx.shadowColor = CANVAS_NOTE_COLORS[lane];
      ctx.shadowBlur = isActiveLane ? 30 : 18;
      ctx.beginPath();
      ctx.arc(0, 0, isActiveLane ? 28 : 24, 0, Math.PI * 2);
      const buttonGradient = ctx.createLinearGradient(0, -28, 0, 28);
      buttonGradient.addColorStop(0, "#ffffff");
      buttonGradient.addColorStop(0.42, CANVAS_NOTE_COLORS[lane]);
      buttonGradient.addColorStop(1, "rgba(0,0,0,0.85)");
      ctx.fillStyle = buttonGradient;
      ctx.fill();
      ctx.lineWidth = isActiveLane ? 7 : 5;
      ctx.strokeStyle = isActiveLane ? "rgba(255,255,255,0.82)" : "rgba(255,255,255,0.3)";
      ctx.stroke();
      ctx.restore();
    }

    if (state.flash) {
      const flashX = laneCenterAt(state.flash.lane, 1);
      const alpha = state.flash.ttl / FLASH_SECONDS;
      ctx.save();
      ctx.strokeStyle =
        state.flash.kind === "hit"
          ? `rgba(255, 255, 255, ${0.92 * alpha})`
          : `rgba(255, 98, 118, ${0.92 * alpha})`;
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.ellipse(
        flashX,
        buttonY,
        42 + (1 - alpha) * 22,
        30 + (1 - alpha) * 18,
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      ctx.restore();
    }

    for (const effect of state.celebrationNotes) {
      const progress = 1 - effect.ttl / effect.totalTtl;
      const sideAnchorX = effect.side === "left" ? width * 0.2 : width * 0.8;
      const sideAnchorY = height * 0.84;
      const x =
        sideAnchorX +
        effect.driftX * progress +
        Math.sin(progress * Math.PI * 2) * effect.sway;
      const y = sideAnchorY + effect.driftY * progress;
      const alpha = 1 - progress;
      const laneColor = CANVAS_NOTE_COLORS[effect.lane] ?? "#ffffff";
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = laneColor;
      ctx.shadowBlur = 20;
      drawMusicNote(
        ctx,
        x,
        y,
        effect.size * (0.9 + progress * 0.22),
        laneColor,
        effect.spin * (1 + progress),
      );
      ctx.restore();
    }

    const notes = state.notes.filter((note) => {
      const delta = note.time - state.songTime;
      return delta <= APPROACH_SECONDS && delta >= -0.35 && !note.hit;
    });

    for (const note of notes) {
      const progress = clamp(
        1 - (note.time - state.songTime) / APPROACH_SECONDS,
        0,
        1.12,
      );
      const boardT = clamp(progress * 0.92, 0, 1);
      const noteX = laneCenterAt(note.lane, boardT);
      const noteY = lerp(neckTopY + 34, hitLineY + 24, progress);
      const noteRadius = lerp(11, 29, boardT);
      const color = CANVAS_NOTE_COLORS[note.lane];

      ctx.save();
      ctx.translate(noteX, noteY);
      ctx.scale(1.12, 0.78);
      ctx.shadowColor = color;
      ctx.shadowBlur = 30;
      ctx.beginPath();
      ctx.arc(0, 0, noteRadius, 0, Math.PI * 2);
      const noteGradient = ctx.createLinearGradient(0, -noteRadius, 0, noteRadius);
      noteGradient.addColorStop(0, "#ffffff");
      noteGradient.addColorStop(0.35, color);
      noteGradient.addColorStop(1, "rgba(20, 20, 30, 0.92)");
      ctx.fillStyle = noteGradient;
      ctx.fill();
      ctx.lineWidth = Math.max(2, noteRadius * 0.16);
      ctx.strokeStyle = "rgba(255,255,255,0.42)";
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(-noteRadius * 0.28, -noteRadius * 0.24, noteRadius * 0.24, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fill();
      ctx.restore();
    }

    const pickX = laneCenterAt(controlRef.current.lane, 1);
    ctx.save();
    ctx.translate(pickX, buttonY + 58);
    ctx.rotate(controlRef.current.source === "camera" ? -0.08 : 0.08);
    ctx.shadowColor = "rgba(255,255,255,0.54)";
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.moveTo(0, -20);
    ctx.quadraticCurveTo(-18, -6, -10, 18);
    ctx.quadraticCurveTo(0, 28, 10, 18);
    ctx.quadraticCurveTo(18, -6, 0, -20);
    ctx.closePath();
    const pickGradient = ctx.createLinearGradient(0, -20, 0, 20);
    pickGradient.addColorStop(0, "#fffdf5");
    pickGradient.addColorStop(1, "#cfd8de");
    ctx.fillStyle = pickGradient;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();

    if (state.mode === "playing" && state.songTime < SONG_LEAD_IN) {
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffffff";
      ctx.font = "800 104px var(--font-geist-sans)";
      const countdown = Math.max(1, Math.ceil(SONG_LEAD_IN - state.songTime));
      ctx.fillText(String(countdown), width / 2, height * 0.32);
      ctx.font = "600 18px var(--font-geist-sans)";
      ctx.fillText(
        cameraControlModeRef.current === "motion"
          ? "Move side to side, then snap your arm for the hit."
          : "Find a lane and pinch on the beat.",
        width / 2,
        height * 0.38,
      );
      ctx.textAlign = "start";
    }

    if (state.mode === "paused") {
      ctx.fillStyle = "rgba(3, 9, 14, 0.76)";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#ffffff";
      ctx.font = "700 52px var(--font-geist-sans)";
      ctx.fillText("Paused", width / 2 - 84, height / 2);
    }

    if (state.mode === "gameover") {
      ctx.fillStyle = "rgba(2, 6, 10, 0.78)";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#ffffff";
      ctx.font = "700 64px var(--font-geist-sans)";
      ctx.fillText("Encore Complete", width / 2 - 240, height / 2 - 20);
      ctx.font = "600 24px var(--font-geist-sans)";
      ctx.fillText(
        `Final score ${state.score}  •  longest streak ${state.streak}`,
        width / 2 - 200,
        height / 2 + 24,
      );
    }
  };

  const renderTextState = () => {
    const state = gameStateRef.current;
    const visibleNotes = state.notes
      .filter((note) => {
        const delta = note.time - state.songTime;
        return delta <= APPROACH_SECONDS && delta >= -0.35 && !note.hit;
      })
      .slice(0, 10)
      .map((note) => ({
        lane: note.lane,
        eta: Number((note.time - state.songTime).toFixed(2)),
        judged: note.judged,
      }));

    return JSON.stringify({
      mode: state.mode,
      coordinateSystem: "origin top-left, x right, y down, lanes 0-3 left to right",
      songTitle: state.song.title,
      songBpm: state.song.bpm,
      score: state.score,
      combo: state.combo,
      multiplier: state.multiplier,
      celebrationCount: state.celebrationNotes.length,
      songTime: Number(state.songTime.toFixed(2)),
      countdown: Number(Math.max(0, SONG_LEAD_IN - state.songTime).toFixed(2)),
      activeLane: controlRef.current.lane,
      controlSource: controlRef.current.source,
      handVisible: controlRef.current.handVisible,
      pinch: controlRef.current.pinch,
      cameraState: cameraStateRef.current,
      trackerStatus: trackerStatusRef.current,
      cameraControlMode: cameraControlModeRef.current,
      visibleNotes,
    });
  };

  const resetGame = async (message: string) => {
    await ensureAudio();
    const song = await loadCurrentSongChart();
    const songAudio = await ensureSongAudio();
    songAudio.volume = 0.64;
    try {
      songAudio.volume = 0;
      await songAudio.play();
      songAudio.pause();
      songAudio.currentTime = 0;
    } catch {
      // Ignore autoplay priming failures in headless/blocking environments.
    } finally {
      songAudio.volume = 0.64;
    }
    stopSongPlayback();
    gameStateRef.current = {
      ...createGameState(song),
      mode: "playing",
      message: `${song.title} is live. ${message}`,
    };
    trackerCooldownRef.current = 0;
    lastTimestampRef.current = performance.now();
    drawScene();
  };

  const togglePause = () => {
    const state = gameStateRef.current;
    if (state.mode === "playing") {
      state.mode = "paused";
      songAudioRef.current?.pause();
      state.message = "Set paused. Resume when ready.";
    } else if (state.mode === "paused") {
      state.mode = "playing";
      if (
        songAudioRef.current &&
        state.songTime >= SONG_LEAD_IN &&
        state.songTime < state.song.totalTime
      ) {
        void songAudioRef.current.play().catch(() => {});
        songPlaybackRequestedRef.current = true;
      }
      state.message = "Back in time. Stay on the beat.";
      lastTimestampRef.current = performance.now();
    }
    drawScene();
  };

  const ensureVideoPlaying = async (video: HTMLVideoElement) => {
    await new Promise<void>((resolve) => {
      if (video.readyState >= 2) {
        resolve();
        return;
      }

      const onLoaded = () => {
        video.removeEventListener("loadedmetadata", onLoaded);
        resolve();
      };

      video.addEventListener("loadedmetadata", onLoaded, { once: true });
    });

    await video.play();
  };

  const createHandTracker = async () => {
    const vision = await import("@mediapipe/tasks-vision");
    const filesetResolver = await vision.FilesetResolver.forVisionTasks(
      "/mediapipe/wasm",
    );
    const baseOptions = {
      modelAssetPath: "/mediapipe/hand_landmarker.task",
    };

    try {
      return await vision.HandLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          ...baseOptions,
          delegate: "GPU",
        },
        numHands: 1,
        runningMode: "VIDEO",
      });
    } catch {
      return await vision.HandLandmarker.createFromOptions(filesetResolver, {
        baseOptions,
        numHands: 1,
        runningMode: "VIDEO",
      });
    }
  };

  const startCameraMode = async () => {
    setIsStarting(true);
    setSetupError(null);
    setTrackerStatus("loading");
    setTrackerMessage("Requesting camera access...");

    try {
      await ensureAudio();

      if (!streamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        streamRef.current = stream;
      }

      const video = videoRef.current;
      if (!video) {
        throw new Error("Video element is not ready.");
      }

      video.srcObject = streamRef.current;
      await ensureVideoPlaying(video);
      setCameraState("ready");
      setTrackerMessage("Camera live. Loading hand tracker...");

      if (!handLandmarkerRef.current) {
        try {
          handLandmarkerRef.current = await createHandTracker();
          setCameraControlMode("hand");
          setTrackerStatus("ready");
          setTrackerMessage(
            "Hand tracker live. Move left and right to choose a lane, pinch to hit.",
          );
        } catch {
          setCameraControlMode("motion");
          setTrackerStatus("ready");
          setTrackerMessage(
            "Hand tracker could not start on this device. Motion control is active instead.",
          );
        }
      } else {
        setCameraControlMode("hand");
        setTrackerStatus("ready");
        setTrackerMessage(
          "Hand tracker live. Move left and right to choose a lane, pinch to hit.",
        );
      }

      await resetGame(
        handLandmarkerRef.current
          ? `Play the beat of ${getCurrentSongAsset().title} with your hand or whole body.`
          : "Motion mode is live. Move side to side, then swipe to strum.",
      );
    } catch {
      setCameraState("blocked");
      setTrackerStatus("error");
      setCameraControlMode("none");
      setSetupError(
        "Camera access failed or was blocked. Allow camera permission, then try again.",
      );
      setTrackerMessage("Camera mode is unavailable until permission is granted.");
    } finally {
      setIsStarting(false);
    }
  };

  const generateSongAndStartCamera = async () => {
    try {
      const currentSignature = JSON.stringify(songForm);
      if (
        !getCurrentSongAsset().generated ||
        generatedSongSignatureRef.current !== currentSignature
      ) {
        await generateSongAsset();
      }
      await startCameraMode();
    } catch {
      // Error state is already shown in the launch panel.
    }
  };

  const startFallbackMode = async () => {
    setSetupError(null);
    setCameraState("blocked");
    setTrackerStatus("error");
    setCameraControlMode("none");
    setTrackerMessage("Camera mode skipped. Keyboard and mouse controls are active.");
    await resetGame("Fallback controls are active. Play the beat with mouse or keyboard.");
  };

  const analyzeMotionFrame = useEffectEvent((video: HTMLVideoElement) => {
    const bufferCanvas = motionCanvasRef.current ?? makeMotionCanvas();
    motionCanvasRef.current = bufferCanvas;
    const bufferContext = bufferCanvas.getContext("2d", {
      willReadFrequently: true,
    });

    if (!bufferContext) {
      return false;
    }

    bufferContext.drawImage(video, 0, 0, bufferCanvas.width, bufferCanvas.height);
    const pixels = bufferContext.getImageData(
      0,
      0,
      bufferCanvas.width,
      bufferCanvas.height,
    );
    const currentFrame = new Uint8Array(bufferCanvas.width * bufferCanvas.height);
    let totalMotion = 0;
    let weightedX = 0;
    let weightedY = 0;

    for (let pixelIndex = 0; pixelIndex < currentFrame.length; pixelIndex += 1) {
      const dataIndex = pixelIndex * 4;
      const luminance =
        pixels.data[dataIndex] * 0.299 +
        pixels.data[dataIndex + 1] * 0.587 +
        pixels.data[dataIndex + 2] * 0.114;
      currentFrame[pixelIndex] = luminance;

      const previousFrame = motionFrameRef.current?.[pixelIndex];
      if (previousFrame === undefined) {
        continue;
      }

      const diff = Math.abs(luminance - previousFrame);
      if (diff < 18) {
        continue;
      }

      const x = pixelIndex % bufferCanvas.width;
      const y = Math.floor(pixelIndex / bufferCanvas.width);
      totalMotion += diff;
      weightedX += x * diff;
      weightedY += y * diff;
    }

    motionFrameRef.current = currentFrame;

    if (totalMotion === 0) {
      motionLevelRef.current = 0;
      return false;
    }

    const normalizedMotion = totalMotion / currentFrame.length;
    const previousLevel = motionLevelRef.current;
    motionLevelRef.current = normalizedMotion;

    if (normalizedMotion > 5) {
      const x = 1 - weightedX / totalMotion / (bufferCanvas.width - 1);
      const y = weightedY / totalMotion / (bufferCanvas.height - 1);
      setLaneFromNormalizedX(clamp(x, 0, 1), clamp(y, 0, 1), "camera");
      controlRef.current = {
        ...controlRef.current,
        pinch: false,
        handVisible: true,
      };

      if (
        normalizedMotion > 14 &&
        previousLevel < normalizedMotion * 0.6 &&
        trackerCooldownRef.current === 0
      ) {
        hitLane(controlRef.current.lane);
        trackerCooldownRef.current = 0.26;
      }

      return true;
    }

    return false;
  });

  const hitLaneEvent = useEffectEvent((lane: number) => {
    hitLane(lane);
  });

  const primeCurrentSongChart = useEffectEvent(async () => {
    const chart = await loadCurrentSongChart();
    if (gameStateRef.current.mode === "intro") {
      gameStateRef.current = createGameState(chart);
      drawScene();
    }
  });

  const resetGameFromEffect = useEffectEvent(async (message: string) => {
    await resetGame(message);
  });

  const togglePauseFromEffect = useEffectEvent(() => {
    togglePause();
  });

  const stepEvent = useEffectEvent((deltaMs: number) => {
    step(deltaMs);
  });

  useEffect(() => {
    void primeCurrentSongChart();
  }, []);

  useEffect(() => {
    resizeCanvas();
    drawScene();

    const onResize = () => {
      resizeCanvas();
      drawScene();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key in KEY_TO_LANE) {
        const lane = KEY_TO_LANE[key];
        setLaneFromNormalizedX((lane + 0.5) / LANE_COUNT, 0.88, "keyboard");
        hitLaneEvent(lane);
        drawScene();
        return;
      }

      if (key === "arrowleft") {
        controlRef.current = {
          ...controlRef.current,
          lane: clamp(controlRef.current.lane - 1, 0, LANE_COUNT - 1),
          source: "keyboard",
          handVisible: controlRef.current.handVisible,
        };
        drawScene();
        return;
      }

      if (key === "arrowright") {
        controlRef.current = {
          ...controlRef.current,
          lane: clamp(controlRef.current.lane + 1, 0, LANE_COUNT - 1),
          source: "keyboard",
          handVisible: controlRef.current.handVisible,
        };
        drawScene();
        return;
      }

      if (key === " " || key === "enter") {
        event.preventDefault();
        hitLaneEvent(controlRef.current.lane);
        drawScene();
        return;
      }

      if (key === "p") {
        togglePauseFromEffect();
        return;
      }

      if (key === "r" && gameStateRef.current.mode === "gameover") {
        void resetGameFromEffect("Restarted. Stay on the beat.");
        return;
      }

      if (key === "f") {
        if (document.fullscreenElement) {
          void document.exitFullscreen();
        } else {
          void document.documentElement.requestFullscreen();
        }
      }
    };

    const tick = (timestamp: number) => {
      if (lastTimestampRef.current === 0) {
        lastTimestampRef.current = timestamp;
      }
      const delta = timestamp - lastTimestampRef.current;
      lastTimestampRef.current = timestamp;
      stepEvent(delta);
      drawScene();
      animationFrameRef.current = window.requestAnimationFrame(tick);
    };

    animationFrameRef.current = window.requestAnimationFrame(tick);
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKeyDown);

    window.render_game_to_text = renderTextState;
    window.advanceTime = (ms: number) => {
      const steps = Math.max(1, Math.round(ms / (1000 / 60)));
      for (let index = 0; index < steps; index += 1) {
        stepEvent(ms / steps);
      }
      drawScene();
    };

    return () => {
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown);
      stopSongPlayback();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      handLandmarkerRef.current?.close?.();
      void audioRef.current?.ctx.close();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const normalizedX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      const normalizedY = clamp((event.clientY - rect.top) / rect.height, 0, 1);
      setLaneFromNormalizedX(normalizedX, normalizedY, "mouse");
      drawScene();
    };

    const onPointerDown = () => {
      hitLaneEvent(controlRef.current.lane);
      drawScene();
    };

    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerdown", onPointerDown);

    return () => {
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  useEffect(() => {
    const trackCameraControls = () => {
      const video = videoRef.current;
      let hasCameraControl = false;

      if (
        video &&
        video.readyState >= 2 &&
        cameraStateRef.current === "ready"
      ) {
        if (handLandmarkerRef.current) {
          const result = handLandmarkerRef.current.detectForVideo(
            video,
            performance.now(),
          );
          const landmarks = result.landmarks?.[0];

          if (landmarks) {
            const indexTip = landmarks[8];
            const thumbTip = landmarks[4];
            const screenX = 1 - indexTip.x;
            const screenY = indexTip.y;
            const pinchDistance = Math.hypot(
              thumbTip.x - indexTip.x,
              thumbTip.y - indexTip.y,
            );

            setLaneFromNormalizedX(screenX, screenY, "camera");
            controlRef.current = {
              ...controlRef.current,
              pinch: pinchDistance < 0.06,
              handVisible: true,
            };

            if (cameraControlModeRef.current !== "hand") {
              setCameraControlMode("hand");
              setTrackerMessage(
                "Hand tracker locked on. Move side to side and pinch to hit.",
              );
            }

            if (pinchDistance < 0.06 && trackerCooldownRef.current === 0) {
              hitLaneEvent(controlRef.current.lane);
              trackerCooldownRef.current = 0.24;
            }

            hasCameraControl = true;
          }
        }

        if (!hasCameraControl) {
          const motionDetected = analyzeMotionFrame(video);
          if (motionDetected) {
            hasCameraControl = true;
            if (cameraControlModeRef.current !== "motion") {
              setCameraControlMode("motion");
              setTrackerMessage(
                "Motion control is active. Move side to side and make a quick swipe to strum.",
              );
            }
          }
        }
      }

      if (!hasCameraControl) {
        controlRef.current = {
          ...controlRef.current,
          pinch: false,
          handVisible: false,
        };
      }

      if (performance.now() - lastRenderRef.current > 32) {
        drawScene();
        lastRenderRef.current = performance.now();
      }

      trackingFrameRef.current = window.requestAnimationFrame(trackCameraControls);
    };

    trackingFrameRef.current = window.requestAnimationFrame(trackCameraControls);
    return () => {
      if (trackingFrameRef.current) {
        window.cancelAnimationFrame(trackingFrameRef.current);
      }
    };
  }, []);

  const snapshot = gameStateRef.current;
  const isIntro = snapshot.mode === "intro";
  const showGameHud = !isIntro;
  void hudTick;

  return (
    <main className="app-shell">
      <video
        ref={videoRef}
        className="camera-feed"
        playsInline
        muted
        autoPlay
      />
      <canvas
        ref={canvasRef}
        className="game-canvas"
        aria-label="Air Guitar Hero game canvas"
      />

      {isIntro ? (
        <section className="overlay launch-panel">
          <p className="eyebrow">make your song</p>
          <h1>Air Guitar Hero</h1>
          <div className="song-maker">
            <label className="song-field song-field-textarea">
              <span>Idea</span>
              <textarea
                value={songForm.details}
                onChange={(event) => updateSongForm("details", event.target.value)}
                maxLength={180}
                placeholder="space lasers, superhero finish, sparkly synths..."
              />
            </label>
            <div className="song-preview">
              <p className="song-preview-label">Current track</p>
              <p className="song-preview-title">{currentSongLabel}</p>
              <p className="song-preview-copy">{currentSongSummary}</p>
              {currentSongLyrics.length > 0 ? (
                <div className="lyrics-preview">
                  <p className="song-preview-label">Lyrics preview</p>
                  {currentSongLyrics.slice(0, 3).map((line) => (
                    <p key={line} className="lyrics-line">
                      {line}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <div className="launch-actions">
            <button
              id="start-btn"
              type="button"
              onClick={() => void generateSongAndStartCamera()}
              disabled={isStarting || isGeneratingSong}
            >
              {isGeneratingSong
                ? "Making Song..."
                : isStarting
                  ? "Starting Camera..."
                  : "Make Song And Start Camera"}
            </button>
            <button
              id="fallback-btn"
              type="button"
              className="secondary"
              onClick={() => void startFallbackMode()}
              disabled={isStarting}
              hidden
              aria-hidden="true"
              aria-label="Play Without Camera"
              tabIndex={-1}
            />
          </div>
          <div className="launch-status">
            <p className="status-pill">camera {cameraState}</p>
            <p className="status-pill">
              {getCurrentSongAsset().generated ? "custom song ready" : "sample song loaded"}
            </p>
          </div>
          {songGenerationError ? <p className="error-copy">{songGenerationError}</p> : null}
          {setupError ? <p className="error-copy">{setupError}</p> : null}
        </section>
      ) : null}

      {showGameHud ? (
        <>
          <section className="overlay hud-panel hud-panel-left">
            <p className="eyebrow">live set</p>
            <p className="panel-copy">
              {snapshot.song.title} • {snapshot.song.bpm} BPM
            </p>
            <div className="hud-stats">
              <div>
                <p className="stat-label">Score</p>
                <p className="stat-value">{snapshot.score}</p>
              </div>
              <div>
                <p className="stat-label">Combo</p>
                <p className="stat-value">{snapshot.combo}</p>
              </div>
              <div>
                <p className="stat-label">Lane</p>
                <p className="stat-value">{LANE_LABELS[controlRef.current.lane]}</p>
              </div>
            </div>
            <div className="hud-actions">
              <button
                type="button"
                onClick={() => {
                  if (snapshot.mode === "gameover") {
                    void resetGame("Restarted. Stay on the beat.");
                  } else {
                    togglePause();
                  }
                }}
              >
                {snapshot.mode === "gameover"
                  ? "Restart"
                  : snapshot.mode === "paused"
                    ? "Resume"
                    : "Pause"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  stopSongPlayback();
                  gameStateRef.current = createGameState();
                  drawScene();
                }}
              >
                Return To Menu
              </button>
            </div>
          </section>

          <section className="overlay hud-panel hud-panel-right">
            <div className="status-row">
              <p className="status-pill">camera {cameraState}</p>
              <p className="status-pill">tracker {trackerStatus}</p>
              <p className="status-pill">control {cameraControlMode}</p>
            </div>
            <p className="tracker-copy">{trackerMessage}</p>
            {setupError ? <p className="error-copy">{setupError}</p> : null}
          </section>
        </>
      ) : null}
    </main>
  );
}

declare global {
  interface Window {
    advanceTime?: (ms: number) => void;
    render_game_to_text?: () => string;
  }
}
