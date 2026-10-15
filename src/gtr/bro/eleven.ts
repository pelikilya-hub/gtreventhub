// Голос BRO через ElevenLabs — гибридная полоса.
//
// Думает наш текстовый каскад (Gemini с инструментами), говорит
// ElevenLabs клоном голоса BOSS. Готовые голосовые движки (Gemini Live,
// Realtime) дают только свои стандартные голоса — клон в них не
// вставить, поэтому голос отделён от мозга.
//
// Ключ живёт секретом воркера ELEVENLABS_API_KEY и наружу не выходит;
// какой голос и какой моделью — в KV `setting:voice`, чтобы сменить клон
// без выката.

import type { KvNs } from "../kv-ns";
import { kvGetJson } from "../kv-ns";

export const VOICE_KEY = "setting:voice";

/** Модель по умолчанию: Flash — самая быстрая из многоязычных, русский
 *  понимает. Для разговора важнее первая доля секунды, чем студийность. */
export const DEFAULT_ELEVEN_MODEL = "eleven_flash_v2_5";

export type VoiceCfg = {
  voiceId?: string;
  model?: string;
  /** 0..1: ниже — живее и разнообразнее, выше — ровнее. */
  stability?: number;
  /** 0..1: насколько держаться тембра клона. */
  similarity?: number;
};

export const elevenKey = (): string =>
  (typeof process !== "undefined" ? process.env?.ELEVENLABS_API_KEY : undefined) ?? "";

export const voiceCfg = async (ns: KvNs): Promise<VoiceCfg> =>
  (await kvGetJson<VoiceCfg>(ns, VOICE_KEY)) ?? {};

/** Гибрид готов, когда есть и ключ, и выбранный голос. */
export const elevenReady = async (ns: KvNs): Promise<boolean> =>
  Boolean(elevenKey() && (await voiceCfg(ns)).voiceId);

const clamp01 = (v: unknown, d: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d;

/** id голоса ElevenLabs — буквы и цифры, ничего больше. Проверка нужна:
 *  id подставляется в путь запроса. */
export const isVoiceId = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9]{8,40}$/.test(v);

/** Озвучить текст. Возвращает потоковый ответ ElevenLabs (audio/mpeg)
 *  как есть — браузер начинает играть с первых килобайт. */
export const elevenSpeak = async (
  text: string,
  cfg: VoiceCfg,
  key: string,
  signal?: AbortSignal,
): Promise<Response> => {
  const voiceId = cfg.voiceId ?? "";
  if (!isVoiceId(voiceId)) throw new Error("bad-voice-id");
  return fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({
        text,
        model_id: cfg.model || DEFAULT_ELEVEN_MODEL,
        voice_settings: {
          stability: clamp01(cfg.stability, 0.45),
          similarity_boost: clamp01(cfg.similarity, 0.85),
        },
      }),
      signal,
    },
  );
};
