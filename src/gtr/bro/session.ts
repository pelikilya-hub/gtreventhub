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
  | { kind: "taxi"; data: Record<string, unknown> }
  | { kind: "confirm"; data: Record<string, unknown> }
  // Музыка живёт снаружи: Spotify, SoundCloud, YouTube. Открывать её
  // «навигацией по приложению» нельзя — там её нет, и человек уезжает
  // в случайный раздел вместо сета, который просил.
  | { kind: "music"; data: Record<string, unknown> }
  | { kind: "navigate"; data: { route: string; entityId?: string } };

export type BroLine = { who: "user" | "bro"; text: string; at: number };

export type BroEvents = {
  onState?: (s: BroState, detail?: string) => void;
  onLine?: (l: BroLine) => void;
  onCard?: (c: BroCard) => void;
  onLevel?: (v: number) => void;
  /** Счётчик для аналитики. Только имя события, без содержания разговора. */
  onMetric?: (name: string) => void;
  /** Строка на табло: шаги соединения и ошибки как есть. */
  onLog?: (line: string) => void;
  /** Кусок расшифровки по мере произнесения — для эффекта печати. */
  onPartial?: (who: "user" | "bro", delta: string) => void;
  /** Подтверждение действия. Возвращает решение пользователя, сделанное
   *  в интерфейсе — голосовое «да» сюда не приходит и приходить не должно. */
  onConfirm?: (ask: { tool: string; summary: string }) => Promise<boolean>;
};

/** Инструменты, требующие подтверждения в интерфейсе перед выполнением.
 *  Источник — WRITE_TOOLS в tools.ts: новый пишущий инструмент нельзя
 *  выпустить, не решив, что именно показать человеку перед выполнением. */
import { LoudOut, routeAudio } from "./audio-out";
import { WRITE_TOOLS } from "./write-tools";
export const NEEDS_CONFIRM: Record<string, string> = WRITE_TOOLS;

export type BroStart = {
  // Сервер валидирует голос сам; узкий тип здесь мешал общему интерфейсу
  // с транспортом Gemini.
  voice: string;
  personaMode: BroPersona;
  district?: string;
  screen?: string;
  partySize?: number;
  /** Рация: микрофон открыт только пока держат кнопку. Отпустил — реплика
   *  ушла целиком, и модель отвечает. В шумном клубе это единственный
   *  честный режим: авто-детектор речи там слышит толпу, а не человека. */
  ptt?: boolean;
};

// Результат инструмента голосовая модель читает как текст, и пауза перед
// первым словом растёт с каждым лишним килобайтом. Карточки на табло
// строятся из полного результата ДО этой обрезки — модели же нужны только
// названия и факты для одной-двух фраз. Постеры, служебные статусы и
// идентификаторы площадок из речи всё равно не звучат — вырезаем.
export const toolOutputForVoice = (name: string, result: unknown): string => {
  const r = result as { ok?: boolean; data?: Record<string, unknown> };
  if (r?.ok && r.data && name === "search_events") {
    const d = r.data;
    const slim = (e: Record<string, unknown>) => ({
      event_id: e.event_id,
      title: e.title,
      venue: e.venue,
      start_at: e.start_at,
      genre: e.genre,
      distance_km: e.distance_km,
    });
    return JSON.stringify({
      ok: true,
      data: {
        events: Array.isArray(d.events) ? (d.events as Record<string, unknown>[]).map(slim) : [],
        total: d.total,
        nearest: d.nearest,
        note: d.note,
      },
    }).slice(0, 2500);
  }
  return JSON.stringify(result).slice(0, 2500);
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
  private outCtx: AudioContext | null = null;
  private out: LoudOut | null = null;
  private raf = 0;
  private idleTimer = 0;
  private maxTimer = 0;
  private ev: BroEvents;
  private state: BroState = "idle";
  private closed = false;
  private startedAt = 0;
  private ptt = false;
  private holdAt = 0;
  // Пик уровня микрофона за время удержания кнопки: по нему отличаем
  // реплику от случайного нажатия в шумном зале.
  private holdPeak = 0;

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

  async start(opts: BroStart) {
    if (this.pc) return;
    this.closed = false;
    this.ptt = Boolean(opts.ptt);
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
      this.log(`сеанс создан · голос ${opts.voice} · ${opts.ptt ? "рация" : "свободный"}`);
    } catch {
      this.set("error", "network");
      this.log("сеанс: сеть не ответила");
      this.releaseMic();
      return;
    }

    const pc = new RTCPeerConnection();
    this.pc = pc;

    this.audio = document.createElement("audio");
    this.audio.autoplay = true;
    // iOS не покажет звук без этого атрибута и попробует открыть плеер.
    this.audio.setAttribute("playsinline", "");
    routeAudio("play-and-record");
    pc.ontrack = (e) => {
      if (!this.audio) return;
      this.audio.srcObject = e.streams[0];
      // Голос идёт вторым путём — через Web Audio с компрессором и
      // усилением. Сам элемент глушим, иначе получим двойной звук.
      try {
        const ctx = new AudioContext();
        this.outCtx = ctx;
        const out = new LoudOut(ctx);
        this.out = out;
        ctx.createMediaStreamSource(e.streams[0]).connect(out.input);
        this.audio.volume = 0;
      } catch {
        // Не поднялся Web Audio — пусть звучит элемент, тихо, но живо.
        this.audio.volume = 1;
      }
    };
    for (const track of this.mic!.getTracks()) pc.addTrack(track, this.mic!);

    const dc = pc.createDataChannel("oai-events");
    this.dc = dc;
    dc.onmessage = (e) => this.onServerEvent(e.data as string);
    dc.onopen = () => {
      // Рация: детектор речи выключен ещё при создании сессии на сервере.
      // Здесь только держим микрофон закрытым до нажатия. И сразу просим
      // громкий динамик: в play-and-record iOS считает разговор звонком и
      // приглушает звук — та самая жалоба «голос становится тише».
      if (this.ptt) {
        this.mute(true);
        routeAudio("playback");
      }
      this.log("канал открыт — эфир");
      this.set("listening");
      this.touch();
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      // Обмен SDP — через наш воркер: прямой запрос к провайдеру из
      // мобильного браузера падал молча, а так статус ошибки доезжает
      // до табло.
      const r = await fetch("/api/gtr-bro-sdp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ secret, sdp: offer.sdp }),
        signal: AbortSignal.timeout(20_000),
      });
      const data = (await r.json()) as { ok?: boolean; sdp?: string; status?: number; error?: string };
      if (!data.ok || !data.sdp) {
        this.log(`SDP отвергнут · ${data.status ?? r.status} · ${String(data.error ?? "").slice(0, 160)}`);
        throw new Error("sdp");
      }
      await pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
      this.log("SDP принят, жду канал");
    } catch (err) {
      if (!(err instanceof Error && err.message === "sdp")) this.log("WebRTC: обмен не состоялся");
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

  /** Нажал кнопку: если BRO говорит — он замолкает, микрофон открывается. */
  holdStart() {
    if (this.dc?.readyState !== "open") return;
    if (this.state === "speaking" || this.state === "thinking") this.bargeIn();
    // Запись нужна только пока палец на кнопке — просим у iOS режим
    // записи ровно на это время.
    routeAudio("play-and-record");
    this.send({ type: "input_audio_buffer.clear" });
    this.mute(false);
    this.holdAt = Date.now();
    this.holdPeak = 0;
    this.set("listening");
    this.touch();
  }

  /** Отпустил кнопку: реплика ушла, ждём ответ. Совсем короткое касание —
   *  это промах пальцем, а не реплика: пустой буфер не отправляем, иначе
   *  модель ответит на тишину. */
  holdEnd() {
    if (this.dc?.readyState !== "open") return;
    this.mute(true);
    // Кнопка отпущена — ответ должен звучать громко, из медиа-динамика.
    routeAudio("playback");
    if (Date.now() - this.holdAt < 250) {
      this.send({ type: "input_audio_buffer.clear" });
      return;
    }
    // Тихий эфир: кнопку держали, но речи не было — шорох пальца, карман,
    // случайный зажим. Не отправляем: модель, получив шум, отвечает на
    // него, и это выглядит как «BRO реагирует непонятно на что».
    if (this.holdPeak < 0.09) {
      this.send({ type: "input_audio_buffer.clear" });
      this.log("в эфире тишина — реплику не отправил");
      this.set("listening");
      return;
    }
    this.send({ type: "input_audio_buffer.commit" });
    this.send({ type: "response.create" });
    this.log("реплика ушла");
    this.set("thinking");
    this.touch();
  }

  get isPtt(): boolean {
    return this.ptt;
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
  /** Громкость голоса: 1 — как есть, 6 — предел без каши. */
  setGain(v: number) {
    this.out?.setGain(v);
  }

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

    if (type === "conversation.item.input_audio_transcription.delta")
      this.ev.onPartial?.("user", String(e.delta ?? ""));
    else if (type === "response.output_audio_transcript.delta")
      this.ev.onPartial?.("bro", String(e.delta ?? ""));
    else if (type === "input_audio_buffer.speech_started") this.bargeIn();
    else if (type === "response.created") this.set("thinking");
    else if (type === "response.output_audio.delta") this.set("speaking");
    else if (type === "response.done") this.set("listening");
    else if (type === "conversation.item.input_audio_transcription.completed")
      this.ev.onLine?.({ who: "user", text: String(e.transcript ?? ""), at: Date.now() });
    else if (type === "response.output_audio_transcript.done")
      this.ev.onLine?.({ who: "bro", text: String(e.transcript ?? ""), at: Date.now() });
    else if (type === "response.function_call_arguments.done") await this.runTool(e);
    else if (type === "error") {
      const er = e.error as { code?: string; message?: string } | undefined;
      this.ev.onMetric?.("bro.error.api");
      this.log(`ошибка API · ${er?.code ?? ""} ${String(er?.message ?? "").slice(0, 140)}`);
      this.set("error", String(er?.code ?? "api"));
    }
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
    this.log(`инструмент: ${name}`);
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
      else if (name === "open_music" || name === "get_artist_profile")
        this.ev.onCard?.({ kind: "music", data });
      else if (name === "open_in_app")
        this.ev.onCard?.({ kind: "navigate", data: data as { route: string; entityId?: string } });
    }

    this.send({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: callId, output: toolOutputForVoice(name, result) },
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
        const level = Math.min(1, sum / buf.length / 90);
        // Пока микрофон открыт (кнопка зажата), запоминаем пик — holdEnd
        // по нему решит, была ли речь вообще.
        if (this.mic?.getAudioTracks().some((t) => t.enabled))
          this.holdPeak = Math.max(this.holdPeak, level);
        this.ev.onLevel?.(level);
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
    // Микрофона больше нет — вернуть системе обычный громкий маршрут.
    routeAudio("playback");
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
    this.log(`сессия закрыта · ${reason}`);
    this.ev.onMetric?.(`bro.session.stop.${reason.replace(/[^a-z-]/g, "")}`);
    if (this.startedAt)
      this.ev.onMetric?.(
        `bro.session.dur.${Math.min(8, Math.floor((Date.now() - this.startedAt) / 60000))}m`,
      );
    this.set("closed", reason);
  }
}
