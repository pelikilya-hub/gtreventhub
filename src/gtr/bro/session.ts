// Голосовая петля GTR BRO: WebRTC напрямую к Realtime.
//
// Почему WebRTC, а не сокет с кусками аудио: перебивание. Пользователь
// должен иметь возможность оборвать помощника на полуслове, и звук должен
// замолчать мгновенно. По WebRTC это делает сам транспорт — мы гасим
// удалённый трек локально, не дожидаясь, пока модель узнает о перебивании.
//
// Ключа здесь нет и быть не может: браузер получает эфемерный секрет от
// нашего сервера и живёт с ним минуты.

export type BroState =
  | "idle"
  | "requesting_permission"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "running_tool"
  | "awaiting_confirmation"
  | "reconnecting"
  | "error"
  | "closed";

export type BroVoice = "cedar" | "marin" | "ash";
export type BroPersona = "concierge" | "bro" | "unhinged";

export type BroCard =
  | { kind: "event"; data: Record<string, unknown> }
  | { kind: "venue"; data: Record<string, unknown> }
  | { kind: "route"; data: Record<string, unknown> }
  | { kind: "navigate"; data: { route: string; entityId?: string } };

export type BroLine = { who: "user" | "bro"; text: string; at: number };

export type BroEvents = {
  onState?: (s: BroState, detail?: string) => void;
  onLine?: (l: BroLine) => void;
  onCard?: (c: BroCard) => void;
  onLevel?: (v: number) => void;
  /** Счётчик для аналитики. Только имя события, без содержания разговора. */
  onMetric?: (name: string) => void;
  /** Подтверждение действия. Возвращает решение пользователя, сделанное
   *  в интерфейсе — голосовое «да» сюда не приходит и приходить не должно. */
  onConfirm?: (ask: { tool: string; summary: string }) => Promise<boolean>;
};

/** Инструменты, требующие подтверждения в интерфейсе перед выполнением:
 *  покупка, бронь, приглашения, передача геолокации третьей стороне,
 *  заказ транспорта. В MVP таких инструментов нет — набор пуст намеренно,
 *  и это защёлка на будущее: новый write-инструмент нельзя выпустить,
 *  не решив, что именно показать человеку перед выполнением. */
export const NEEDS_CONFIRM: Record<string, string> = {};

export type BroStart = {
  voice: BroVoice;
  personaMode: BroPersona;
  district?: string;
  screen?: string;
  partySize?: number;
};

const SESSION_URL = "/api/gtr-bro-session";
const TOOL_URL = "/api/gtr-bro-tool";
// Сессия не должна жить вечно: Realtime тарифицируется по времени, а
// забытый в кармане телефон — это счёт без пользы.
const IDLE_MS = 90_000;
const MAX_MS = 8 * 60_000;

export class BroSession {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private mic: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private ctxAudio: AudioContext | null = null;
  private raf = 0;
  private idleTimer = 0;
  private maxTimer = 0;
  private ev: BroEvents;
  private state: BroState = "idle";
  private closed = false;
  private startedAt = 0;

  constructor(ev: BroEvents) {
    this.ev = ev;
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

  async start(opts: BroStart) {
    if (this.pc) return;
    this.closed = false;
    try {
      // Микрофон запрашиваем только здесь — после явного нажатия. Никакого
      // фонового прослушивания в продукте нет.
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
    this.set("connecting");
    let secret: string;
    try {
      const r = await fetch(SESSION_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(opts),
        signal: AbortSignal.timeout(12_000),
      });
      const data = (await r.json()) as { clientSecret?: string; error?: string; reason?: string };
      if (!r.ok || !data.clientSecret) {
        this.set("error", data.reason ?? data.error ?? String(r.status));
        this.releaseMic();
        return;
      }
      secret = data.clientSecret;
    } catch {
      this.set("error", "network");
      this.releaseMic();
      return;
    }

    const pc = new RTCPeerConnection();
    this.pc = pc;

    this.audio = document.createElement("audio");
    this.audio.autoplay = true;
    pc.ontrack = (e) => {
      if (this.audio) this.audio.srcObject = e.streams[0];
    };
    for (const track of this.mic!.getTracks()) pc.addTrack(track, this.mic!);

    const dc = pc.createDataChannel("oai-events");
    this.dc = dc;
    dc.onmessage = (e) => this.onServerEvent(e.data as string);
    dc.onopen = () => {
      this.set("listening");
      this.touch();
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const r = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/sdp" },
        body: offer.sdp,
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) throw new Error(String(r.status));
      await pc.setRemoteDescription({ type: "answer", sdp: await r.text() });
    } catch {
      this.set("error", "webrtc");
      this.stop("error");
      return;
    }

    this.startedAt = Date.now();
    this.ev.onMetric?.("bro.session.connected");
    this.meter();
    this.maxTimer = window.setTimeout(() => this.stop("max-duration"), MAX_MS);
  }

  /** Перебивание. Гасим звук локально сразу — ждать, пока модель узнает
   *  о перебивании, значит оставить хвост в полсекунды, который человек
   *  слышит как «он меня не слушает». */
  bargeIn() {
    if (this.audio?.srcObject instanceof MediaStream) {
      for (const t of this.audio.srcObject.getAudioTracks()) t.enabled = false;
      setTimeout(() => {
        if (this.audio?.srcObject instanceof MediaStream)
          for (const t of this.audio.srcObject.getAudioTracks()) t.enabled = true;
      }, 120);
    }
    this.send({ type: "response.cancel" });
    this.ev.onMetric?.("bro.bargein");
    this.set("listening");
  }

  mute(on: boolean) {
    for (const t of this.mic?.getAudioTracks() ?? []) t.enabled = !on;
  }

  say(text: string) {
    this.send({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
    });
    this.send({ type: "response.create" });
    this.touch();
  }

  /** Voice Lab: заставить голос произнести реплику дословно.
   *  Нужен именно verbatim — иначе сравниваются тексты, а не голоса. */
  speakVerbatim(text: string) {
    this.send({
      type: "response.create",
      response: {
        instructions: `Произнеси дословно, ничего не добавляя и не меняя: ${text}`,
        output_modalities: ["audio"],
      },
    });
    this.touch();
  }

  get current(): BroState {
    return this.state;
  }

  private send(o: unknown) {
    if (this.dc?.readyState === "open") this.dc.send(JSON.stringify(o));
  }

  private async onServerEvent(raw: string) {
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = String(e.type ?? "");
    this.touch();

    if (type === "input_audio_buffer.speech_started") this.bargeIn();
    else if (type === "response.created") this.set("thinking");
    else if (type === "response.output_audio.delta") this.set("speaking");
    else if (type === "response.done") this.set("listening");
    else if (type === "conversation.item.input_audio_transcription.completed")
      this.ev.onLine?.({ who: "user", text: String(e.transcript ?? ""), at: Date.now() });
    else if (type === "response.output_audio_transcript.done")
      this.ev.onLine?.({ who: "bro", text: String(e.transcript ?? ""), at: Date.now() });
    else if (type === "response.function_call_arguments.done") await this.runTool(e);
    else if (type === "error") this.ev.onMetric?.("bro.error.api"), this.set("error", String((e.error as { code?: string })?.code ?? "api"));
  }

  private async runTool(e: Record<string, unknown>) {
    const name = String(e.name ?? "");
    const callId = String(e.call_id ?? "");
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(String(e.arguments ?? "{}")) as Record<string, unknown>;
    } catch {
      args = {};
    }
    this.ev.onMetric?.(`bro.tool.${name}`);

    // Граница подтверждений. Инструмент, который что-то меняет во внешнем
    // мире, не выполняется до явного нажатия в интерфейсе.
    const needs = NEEDS_CONFIRM[name];
    if (needs) {
      this.set("awaiting_confirmation", name);
      const okd = await (this.ev.onConfirm?.({ tool: name, summary: needs }) ?? Promise.resolve(false));
      this.ev.onMetric?.(okd ? "bro.confirm.yes" : "bro.confirm.no");
      if (!okd) {
        this.send({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify({ ok: false, error: "user-declined", retryable: false }),
          },
        });
        this.send({ type: "response.create" });
        this.set("thinking");
        return;
      }
    }

    this.set("running_tool", name);

    let result: unknown = { ok: false, error: "tool-failed", retryable: true };
    try {
      const r = await fetch(TOOL_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ name, args, callId }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = (await r.json()) as { result?: unknown };
      if (data.result) result = data.result;
    } catch {
      // остаётся нормализованная ошибка выше
    }

    // Карточки строим только из типизированного результата инструмента,
    // а не из произнесённого текста: разбор речи обратно в сущности —
    // прямой путь показать пользователю несуществующее событие.
    const ok = (result as { ok?: boolean }).ok;
    const data = (result as { data?: Record<string, unknown> }).data;
    if (ok && data) {
      if (name === "search_events" && Array.isArray(data.events))
        for (const ev of (data.events as Record<string, unknown>[]).slice(0, 3))
          this.ev.onCard?.({ kind: "event", data: ev });
      else if (name === "get_event_details") this.ev.onCard?.({ kind: "venue", data });
      else if (name === "build_night_route") this.ev.onCard?.({ kind: "route", data });
      else if (name === "open_in_app")
        this.ev.onCard?.({ kind: "navigate", data: data as { route: string; entityId?: string } });
    }

    this.send({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: callId, output: JSON.stringify(result).slice(0, 6000) },
    });
    this.send({ type: "response.create" });
    this.set("thinking");
  }

  /** Уровень микрофона для визуализатора. Аудио никуда не пишется и не
   *  уходит: считаем громкость и сразу забываем. */
  private meter() {
    if (!this.mic) return;
    try {
      const ctx = new AudioContext();
      this.ctxAudio = ctx;
      const src = ctx.createMediaStreamSource(this.mic);
      const an = ctx.createAnalyser();
      an.fftSize = 256;
      src.connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      const tick = () => {
        an.getByteFrequencyData(buf);
        let sum = 0;
        for (const v of buf) sum += v;
        this.ev.onLevel?.(Math.min(1, sum / buf.length / 90));
        this.raf = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // визуализатор — украшение, без него петля работает
    }
  }

  private releaseMic() {
    for (const t of this.mic?.getTracks() ?? []) t.stop();
    this.mic = null;
  }

  stop(reason = "user") {
    if (this.closed) return;
    this.closed = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.idleTimer);
    clearTimeout(this.maxTimer);
    try {
      this.dc?.close();
    } catch {
      /* канал мог закрыться сам */
    }
    try {
      this.pc?.getSenders().forEach((s) => s.track?.stop());
      this.pc?.close();
    } catch {
      /* соединение мог оборвать транспорт */
    }
    void this.ctxAudio?.close().catch(() => {});
    this.releaseMic();
    if (this.audio) {
      this.audio.srcObject = null;
      this.audio = null;
    }
    this.pc = null;
    this.dc = null;
    this.ev.onMetric?.(`bro.session.stop.${reason.replace(/[^a-z-]/g, "")}`);
    if (this.startedAt)
      this.ev.onMetric?.(
        `bro.session.dur.${Math.min(8, Math.floor((Date.now() - this.startedAt) / 60000))}m`,
      );
    this.set("closed", reason);
  }
}
