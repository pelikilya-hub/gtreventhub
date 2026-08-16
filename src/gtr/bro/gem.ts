// Голосовая петля GTR BRO поверх Gemini Live API.
//
// Отличие от связки с Realtime — транспорт: вместо WebRTC здесь
// WebSocket, звук мы носим сами. Микрофон читается через Web Audio,
// прижимается к PCM 16 кГц и уходит кусками; ответ приходит кусками
// PCM 24 кГц и расписывается в очередь воспроизведения. Перебивание —
// это просто мгновенная очистка этой очереди: звук замолкает на нашей
// стороне, не спрашивая сеть.
//
// Ключа здесь нет: браузер получает от нашего сервера эфемерный токен
// и живёт с ним минуты. Всё остальное — события, метрики, границы
// подтверждений — то же, что в петле Realtime: интерфейс не знает,
// какой провайдер под ним.

import type { BroCard, BroEvents, BroPersona, BroState } from "./session";
import { NEEDS_CONFIRM } from "./session";

export type GemStart = {
  voice: string;
  personaMode: BroPersona;
  district?: string;
  screen?: string;
  ptt?: boolean;
};

const SESSION_URL = "/api/gtr-bro-gem";
const TOOL_URL = "/api/gtr-bro-tool";
// Эфемерные токены живут на отдельном endpoint'е Constrained — обычный
// BidiGenerateContent их не принимает вовсе (выяснено перебором с прода:
// сервер сам подсказал «pass it in an access_token»).
const WS_BASE =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";
const IDLE_MS = 90_000;
const MAX_MS = 8 * 60_000;
const IN_RATE = 16_000;
const OUT_RATE = 24_000;

const b64 = (a: Int16Array): string => {
  const u = new Uint8Array(a.buffer);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};

const unb64 = (s: string): Int16Array => {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Int16Array(u.buffer);
};

export class GemSession {
  private ws: WebSocket | null = null;
  private mic: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private proc: ScriptProcessorNode | null = null;
  private playing = new Set<AudioBufferSourceNode>();
  private playT = 0;
  private sending = false;
  private ptt = false;
  private holdAt = 0;
  private bufUser = "";
  private bufBro = "";
  private idleTimer = 0;
  private maxTimer = 0;
  private startedAt = 0;
  private ev: BroEvents;
  private state: BroState = "idle";
  private closed = false;

  constructor(ev: BroEvents) {
    this.ev = ev;
  }

  private log(line: string) {
    this.ev.onLog?.(line);
  }

  private set(s: BroState, detail?: string) {
    if (this.state === s) return;
    this.state = s;
    this.ev.onState?.(s, detail);
  }

  private touch() {
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => this.stop("idle"), IDLE_MS);
  }

  get current(): BroState {
    return this.state;
  }

  get isPtt(): boolean {
    return this.ptt;
  }

  async start(opts: GemStart) {
    if (this.ws) return;
    this.closed = false;
    this.ptt = Boolean(opts.ptt);
    try {
      this.set("requesting_permission");
      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      this.ev.onMetric?.("bro.mic.denied");
      this.set("error", "mic-denied");
      return;
    }

    this.ev.onMetric?.("bro.session.start");
    this.ev.onMetric?.("bro.provider.gemini");
    this.set("connecting");

    let token = "";
    let model = "";
    let instructions = "";
    let tools: unknown[] = [];
    try {
      const r = await fetch(SESSION_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(opts),
        signal: AbortSignal.timeout(15_000),
      });
      const data = (await r.json()) as {
        token?: string;
        model?: string;
        instructions?: string;
        tools?: unknown[];
        error?: string;
        reason?: string;
        detail?: string;
      };
      if (!r.ok || !data.token) {
        this.log(`сеанс: ${data.reason ?? data.error ?? r.status} ${String(data.detail ?? "").slice(0, 160)}`);
        this.set("error", data.reason ?? data.error ?? String(r.status));
        this.releaseMic();
        return;
      }
      token = data.token;
      model = data.model ?? "";
      instructions = data.instructions ?? "";
      tools = data.tools ?? [];
      this.log(`сеанс создан · ${model} · голос ${opts.voice} · ${this.ptt ? "рация" : "свободный"}`);
    } catch {
      this.log("сеанс: сеть не ответила");
      this.set("error", "network");
      this.releaseMic();
      return;
    }

    // Эфемерный токен Google принимает как access_token; на всякий случай
    // второй попыткой пробуем как key — обе видно на табло.
    const connected = await this.connect(`${WS_BASE}?access_token=${encodeURIComponent(token)}`, opts, model, instructions, tools);
    if (!connected) {
      this.log("повтор через параметр key");
      const ok2 = await this.connect(`${WS_BASE}?key=${encodeURIComponent(token)}`, opts, model, instructions, tools);
      if (!ok2) {
        this.set("error", "ws");
        this.stop("error");
        return;
      }
    }

    this.startedAt = Date.now();
    this.ev.onMetric?.("bro.session.connected");
    this.startCapture();
    this.maxTimer = window.setTimeout(() => this.stop("max-duration"), MAX_MS);
  }

  private connect(url: string, opts: GemStart, model: string, instructions: string, tools: unknown[]): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok: boolean) => {
        if (!settled) {
          settled = true;
          resolve(ok);
        }
      };
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        done(false);
        return;
      }
      const guard = window.setTimeout(() => {
        if (!settled) {
          try {
            ws.close();
          } catch {
            /* уже закрыт */
          }
          done(false);
        }
      }, 15_000);

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            setup: {
              model: `models/${model}`,
              generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                  languageCode: "ru-RU",
                  voiceConfig: { prebuiltVoiceConfig: { voiceName: opts.voice } },
                },
              },
              systemInstruction: { parts: [{ text: instructions }] },
              tools: [{ functionDeclarations: tools }],
              // Рация: авто-детектор речи выключен, конец реплики
              // определяет палец на кнопке.
              ...(this.ptt ? { realtimeInputConfig: { automaticActivityDetection: { disabled: true } } } : {}),
              outputAudioTranscription: {},
              inputAudioTranscription: {},
            },
          }),
        );
      };
      ws.onmessage = (e) => {
        void (async () => {
          const text = typeof e.data === "string" ? e.data : await (e.data as Blob).text();
          let m: Record<string, unknown>;
          try {
            m = JSON.parse(text) as Record<string, unknown>;
          } catch {
            return;
          }
          if (m.setupComplete !== undefined && !settled) {
            window.clearTimeout(guard);
            this.ws = ws;
            ws.onclose = (ev2) => {
              this.log(`канал закрылся · ${ev2.code}`);
              if (!this.closed) this.stop("ws-close");
            };
            this.log("канал открыт — эфир");
            this.sending = !this.ptt;
            this.set("listening");
            this.touch();
            done(true);
            return;
          }
          this.onServer(m);
        })();
      };
      ws.onerror = () => {
        if (!settled) {
          window.clearTimeout(guard);
          done(false);
        }
      };
      ws.onclose = (ev2) => {
        if (!settled) {
          window.clearTimeout(guard);
          this.log(`подключение отклонено · ${ev2.code} ${String(ev2.reason ?? "").slice(0, 120)}`);
          done(false);
        }
      };
    });
  }

  // ---------------------------------------------------------- звук туда

  private startCapture() {
    if (!this.mic) return;
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      const src = ctx.createMediaStreamSource(this.mic);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      this.proc = proc;
      const ratio = ctx.sampleRate / IN_RATE;
      proc.onaudioprocess = (e) => {
        const inp = e.inputBuffer.getChannelData(0);
        // Уровень для визуализатора — и он же честный индикатор записи.
        let sum = 0;
        for (let i = 0; i < inp.length; i += 8) sum += Math.abs(inp[i]);
        this.ev.onLevel?.(Math.min(1, (sum / (inp.length / 8)) * 6));
        if (!this.sending || this.ws?.readyState !== WebSocket.OPEN) return;
        const out = new Int16Array(Math.floor(inp.length / ratio));
        for (let i = 0; i < out.length; i++) {
          const v = inp[Math.floor(i * ratio)];
          out[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
        }
        this.send({ realtimeInput: { audio: { data: b64(out), mimeType: `audio/pcm;rate=${IN_RATE}` } } });
      };
      src.connect(proc);
      proc.connect(ctx.destination);
    } catch {
      this.log("микрофонный тракт не поднялся");
    }
  }

  // --------------------------------------------------------- звук оттуда

  private playChunk(dataB64: string) {
    const ctx = this.ctx;
    if (!ctx) return;
    const pcm = unb64(dataB64);
    const buf = ctx.createBuffer(1, pcm.length, OUT_RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const srcNode = ctx.createBufferSource();
    srcNode.buffer = buf;
    srcNode.connect(ctx.destination);
    const at = Math.max(ctx.currentTime + 0.02, this.playT);
    srcNode.start(at);
    this.playT = at + buf.duration;
    this.playing.add(srcNode);
    srcNode.onended = () => this.playing.delete(srcNode);
  }

  private silence() {
    for (const s of this.playing) {
      try {
        s.stop();
      } catch {
        /* уже остановлен */
      }
    }
    this.playing.clear();
    this.playT = 0;
  }

  // ------------------------------------------------------------- события

  private onServer(m: Record<string, unknown>) {
    this.touch();
    const sc = m.serverContent as Record<string, unknown> | undefined;

    if (sc) {
      const it = (sc.inputTranscription as { text?: string } | undefined)?.text;
      if (it) {
        this.bufUser += it;
        this.ev.onPartial?.("user", it);
      }
      const ot = (sc.outputTranscription as { text?: string } | undefined)?.text;
      if (ot) {
        this.bufBro += ot;
        this.ev.onPartial?.("bro", ot);
      }
      const turn = sc.modelTurn as { parts?: { inlineData?: { data?: string } }[] } | undefined;
      if (turn?.parts) {
        for (const p of turn.parts) if (p.inlineData?.data) this.playChunk(p.inlineData.data);
        this.set("speaking");
      }
      if (sc.interrupted) {
        this.silence();
        this.ev.onMetric?.("bro.bargein");
        this.finalize();
        this.set("listening");
      }
      if (sc.turnComplete) {
        this.finalize();
        this.set("listening");
      }
      return;
    }

    const tc = m.toolCall as { functionCalls?: { id?: string; name?: string; args?: Record<string, unknown> }[] } | undefined;
    if (tc?.functionCalls?.length) {
      void this.runTools(tc.functionCalls);
      return;
    }

    if (m.goAway !== undefined) this.log("сервер прощается (goAway)");
  }

  private finalize() {
    if (this.bufUser.trim()) this.ev.onLine?.({ who: "user", text: this.bufUser.trim(), at: Date.now() });
    if (this.bufBro.trim()) this.ev.onLine?.({ who: "bro", text: this.bufBro.trim(), at: Date.now() });
    this.bufUser = "";
    this.bufBro = "";
  }

  private async runTools(calls: { id?: string; name?: string; args?: Record<string, unknown> }[]) {
    const responses: { id?: string; name?: string; response: Record<string, unknown> }[] = [];
    for (const c of calls.slice(0, 4)) {
      const name = String(c.name ?? "");
      this.log(`инструмент: ${name}`);
      this.ev.onMetric?.(`bro.tool.${name}`);

      // Граница подтверждений — та же защёлка, что и в петле Realtime.
      const needs = NEEDS_CONFIRM[name];
      if (needs) {
        this.set("awaiting_confirmation", name);
        const okd = await (this.ev.onConfirm?.({ tool: name, summary: needs }) ?? Promise.resolve(false));
        this.ev.onMetric?.(okd ? "bro.confirm.yes" : "bro.confirm.no");
        if (!okd) {
          responses.push({ id: c.id, name: c.name, response: { ok: false, error: "user-declined" } });
          continue;
        }
      }

      this.set("running_tool", name);
      let result: unknown = { ok: false, error: "tool-failed", retryable: true };
      try {
        const r = await fetch(TOOL_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ name, args: c.args ?? {}, callId: c.id ?? "" }),
          signal: AbortSignal.timeout(10_000),
        });
        const data = (await r.json()) as { result?: unknown };
        if (data.result) result = data.result;
      } catch {
        /* нормализованная ошибка выше */
      }

      // Карточки — только из типизированных результатов.
      const ok = (result as { ok?: boolean }).ok;
      const data = (result as { data?: Record<string, unknown> }).data;
      if (ok && data) {
        if (name === "search_events" && Array.isArray(data.events))
          for (const ev of (data.events as Record<string, unknown>[]).slice(0, 3))
            this.ev.onCard?.({ kind: "event", data: ev } as BroCard);
        else if (name === "get_event_details") this.ev.onCard?.({ kind: "venue", data });
        else if (name === "build_night_route") this.ev.onCard?.({ kind: "route", data });
        else if (name === "open_in_app")
          this.ev.onCard?.({ kind: "navigate", data: data as { route: string; entityId?: string } });
      }

      responses.push({ id: c.id, name: c.name, response: (result ?? {}) as Record<string, unknown> });
    }
    this.send({ toolResponse: { functionResponses: responses } });
    this.set("thinking");
    this.touch();
  }

  // ------------------------------------------------------------ управление

  private send(o: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(o));
  }

  bargeIn() {
    this.silence();
    this.ev.onMetric?.("bro.bargein");
    this.set("listening");
  }

  mute(on: boolean) {
    if (!this.ptt) this.sending = !on;
    for (const t of this.mic?.getAudioTracks() ?? []) t.enabled = this.ptt ? true : !on;
  }

  holdStart() {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    if (this.state === "speaking" || this.state === "thinking") this.bargeIn();
    this.send({ realtimeInput: { activityStart: {} } });
    this.sending = true;
    this.holdAt = Date.now();
    this.set("listening");
    this.touch();
  }

  holdEnd() {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.sending = false;
    if (Date.now() - this.holdAt < 250) return;
    this.send({ realtimeInput: { activityEnd: {} } });
    this.log("реплика ушла");
    this.set("thinking");
    this.touch();
  }

  say(text: string) {
    this.send({
      clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: true },
    });
    this.touch();
  }

  /** Voice Lab: дословное произнесение — сравниваются голоса, не тексты. */
  speakVerbatim(text: string) {
    this.say(`Произнеси дословно, ничего не добавляя и не меняя: ${text}`);
  }

  private releaseMic() {
    for (const t of this.mic?.getTracks() ?? []) t.stop();
    this.mic = null;
  }

  stop(reason = "user") {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.idleTimer);
    clearTimeout(this.maxTimer);
    this.silence();
    try {
      this.proc?.disconnect();
    } catch {
      /* тракт мог не подняться */
    }
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    try {
      this.ws?.close();
    } catch {
      /* уже закрыт */
    }
    this.ws = null;
    this.releaseMic();
    this.log(`сессия закрыта · ${reason}`);
    this.ev.onMetric?.(`bro.session.stop.${reason.replace(/[^a-z-]/g, "")}`);
    if (this.startedAt)
      this.ev.onMetric?.(
        `bro.session.dur.${Math.min(8, Math.floor((Date.now() - this.startedAt) / 60000))}m`,
      );
    this.set("closed", reason);
  }
}
