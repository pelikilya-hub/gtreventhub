import { afterEach, describe, expect, it, vi } from "vitest";

import { elevenReady, elevenSpeak, isVoiceId, VOICE_KEY } from "../eleven";

const kv = (store: Record<string, string>) => ({
  get: async (k: string) => store[k] ?? null,
  put: async (k: string, v: string) => {
    store[k] = v;
  },
  delete: async (k: string) => {
    delete store[k];
  },
  list: async () => ({ keys: [], list_complete: true }),
});

describe("гибрид ElevenLabs", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("id голоса — только буквы и цифры: он идёт в путь запроса", () => {
    expect(isVoiceId("21m00Tcm4TlvDq8ikWAM")).toBe(true);
    expect(isVoiceId("../v1/user")).toBe(false);
    expect(isVoiceId("abc")).toBe(false);
    expect(isVoiceId(undefined)).toBe(false);
  });

  it("гибрид не готов без ключа или без клона", async () => {
    const store: Record<string, string> = {};
    const ns = kv(store) as never;
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    store[VOICE_KEY] = JSON.stringify({ voiceId: "21m00Tcm4TlvDq8ikWAM" });
    expect(await elevenReady(ns)).toBe(false);
    vi.stubEnv("ELEVENLABS_API_KEY", "k");
    expect(await elevenReady(ns)).toBe(true);
    delete store[VOICE_KEY];
    expect(await elevenReady(ns)).toBe(false);
  });

  it("запрос: потоковый эндпоинт, ключ в заголовке, быстрая модель по умолчанию", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response("mp3", { status: 200 });
    });
    const r = await elevenSpeak("Йо", { voiceId: "21m00Tcm4TlvDq8ikWAM" }, "secret");
    expect(r.ok).toBe(true);
    expect(seen[0].url).toContain("/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM/stream");
    expect((seen[0].init.headers as Record<string, string>)["xi-api-key"]).toBe("secret");
    const body = JSON.parse(String(seen[0].init.body)) as { model_id: string; text: string };
    expect(body.model_id).toBe("eleven_flash_v2_5");
    expect(body.text).toBe("Йо");
  });

  it("кривой id не уходит наружу вовсе", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(elevenSpeak("x", { voiceId: "../../admin" }, "k")).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
});
