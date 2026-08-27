// Стабильная голосовая полоса GTR BRO.
//
// Слух — Web Speech API браузера, мысли — наш текстовый каскад
// (/api/gtr-bro-text: Gemini Flash → Qwen на GPU GTR), голос —
// speechSynthesis. Три шага независимы: распознавание и озвучка живут
// в самом телефоне, а мозг и так задублирован. Поэтому эта полоса
// отвечает даже в ночь, когда у голосового провайдера легла сеть, —
// именно ради таких ночей она и написана.
//
// Интерфейс — тот же, что у GemSession и BroSession: оверлей не знает,
// какая полоса под ним. Бонус, который премиальным полосам недоступен:
// ответы идут через текстовый мозг, а значит со всей базой знаний и
// теми же инструментами (афиша, брони, маршруты) без отдельной сверки
// голосового промпта.

import { fixHeardNames } from "./heard-names";
import type { BroCard, BroEvents, BroPersona, BroState } from "./session";
import { loadLang, speechLocale, type BroLang } from "./lang";
import { callBroTool, rulesReply } from "./voice-rules";

export type LocalStart = {
  voice: string;
  /** Язык разговора: им же слушаем и им же отвечаем. */
  lang?: BroLang;
  personaMode: BroPersona;
  district?: string;
  screen?: string;
  ptt?: boolean;
};

const TEXT_URL = "/api/gtr-bro-text";
const IDLE_MS = 90_000;
const MAX_MS = 8 * 60_000;

/** Длинный ответ режем по предложениям: одна огромная реплика в Chrome
 *  замолкает на полуслове (старый баг таймера озвучки), а мелкие куски
 *  вдобавок мгновенно глохнут при перебивании. */
export const ttsChunks = (text: string, max = 200): string[] => {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return [];
  const sentences = flat.match(/[^.!?…]+[.!?…]*\s*/g) ?? [flat];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && cur.length + s.length > max) {
      out.push(cur.trim());
      cur = s;
    } else cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};

type SpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult:
    | ((e: {
        results: { length: number; [i: number]: { isFinal: boolean; 0: { transcript: string } } };
      }) => void)
    | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechRec;
  webkitSpeechRecognition?: new () => SpeechRec;
};

const recCtor = (): (new () => SpeechRec) | null => {
  const w = window as SpeechWindow;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export class LocalVoiceSession {
  private rec: SpeechRec | null = null;
  private ev: BroEvents;
  private state: BroState = "idle";
  private closed = false;
  private ptt = false;
  private holdAt = 0;
  private startedAt = 0;
  private idleTimer = 0;
  private maxTimer = 0;
  private lang: BroLang = "ru";
  private locale = "ru-RU";
  // История для мозга — только завершённые реплики, как в текстовом чате.
  private hist: { who: "user" | "bro"; text: string }[] = [];
  // Сколько символов текущей расшифровки уже напечатано на табло.
  private shown = 0;
  private finalText = "";
  // Флаг «реплика ушла» — onend решает, отправлять ли собранный текст.
  private commit = false;
  private speakingN = 0;

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

  async start(opts: LocalStart) {
    if (this.startedAt) return;
    this.closed = false;
    this.ptt = Boolean(opts.ptt);
    this.lang = opts.lang ?? loadLang();
    this.locale = speechLocale(this.lang);

    if (!recCtor()) {
      // Firefox: распознавания нет. Озвучка ответов на набранный текст
      // всё равно работает — но честно говорим, что слуха здесь нет.
      this.ev.onMetric?.("bro.local.nostt");
      this.set("error", "stt-unsupported");
      return;
    }

    // Разрешение на микрофон спрашиваем явно и сразу, как другие полосы:
    // отказ должен быть виден до первого нажатия рации, а не посреди
    // реплики.
    try {
      this.set("requesting_permission");
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const t of s.getTracks()) t.stop();
    } catch {
      this.ev.onMetric?.("bro.mic.denied");
      this.set("error", "mic-denied");
      return;
    }

    this.ev.onMetric?.("bro.session.start");
    this.ev.onMetric?.("bro.provider.local");
    this.startedAt = Date.now();
    this.log(`стабильная полоса · слух ${this.locale} · ${this.ptt ? "рация" : "свободный"}`);
    this.set("listening");
    this.touch();
    this.maxTimer = window.setTimeout(() => this.stop("max-duration"), MAX_MS);
    if (!this.ptt) this.listen();
  }

  /** Поднять распознавание. PTT: одна реплика на удержание. Свободный
   *  режим: слушаем постоянно, на время озвучки закрываем уши — иначе
   *  BRO начнёт отвечать сам себе. */
  private listen() {
    const C = recCtor();
    if (!C || this.closed) return;
    const rec = new C();
    this.rec = rec;
    rec.lang = this.locale;
    rec.continuous = !this.ptt;
    rec.interimResults = true;
    this.shown = 0;
    this.finalText = "";
    this.commit = !this.ptt;
    rec.onresult = (e) => {
      let full = "";
      let fin = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        full += r[0].transcript;
        if (r.isFinal) fin += r[0].transcript;
      }
      this.finalText = fin.trim();
      const delta = full.slice(this.shown);
      if (delta) {
        this.shown = full.length;
        this.ev.onPartial?.("user", delta);
      }
      this.touch();
      // Свободный режим: закончилось предложение — отправляем, не
      // дожидаясь паузы длиной в вечность.
      if (!this.ptt && this.finalText) {
        rec.abort();
        void this.dispatch();
      }
    };
    rec.onerror = (e) => {
      const kind = String(e.error ?? "");
      if (kind === "not-allowed") {
        this.ev.onMetric?.("bro.mic.denied");
        this.set("error", "mic-denied");
        return;
      }
      // no-speech и aborted — быт, а не сбой.
      if (kind !== "no-speech" && kind !== "aborted") this.log(`слух: ${kind}`);
    };
    rec.onend = () => {
      if (this.rec === rec) this.rec = null;
      if (this.closed) return;
      if (this.ptt) {
        if (this.commit) {
          this.commit = false;
          void this.dispatch();
        }
      } else if (this.state === "listening") this.listen();
    };
    try {
      rec.start();
    } catch {
      /* повторный start — переживём */
    }
  }

  /** Собранная реплика уходит в мозг. Пустая — тишина в эфире, промах. */
  private async dispatch() {
    // «кетч бич клаб» → Catch Beach Club: мозг ищет по написанию из баз,
    // и на табло реплика тоже уходит в каноническом виде.
    const text = fixHeardNames(this.finalText.trim());
    this.finalText = "";
    this.shown = 0;
    if (!text) {
      this.log("в эфире тишина — реплику не отправил");
      this.set("listening");
      if (!this.ptt) this.listen();
      return;
    }
    this.ev.onLine?.({ who: "user", text, at: Date.now() });
    await this.ask(text, true);
  }

  /** Вопрос мозгу. show=false — служебная инструкция (визитка), её не
   *  печатаем как реплику человека и не кладём в историю. */
  private async ask(text: string, show: boolean) {
    this.set("thinking");
    this.touch();
    const history = this.hist.slice(-6);
    if (show) this.hist.push({ who: "user", text });
    let reply = "";
    let cards: BroCard[] = [];
    try {
      const r = await fetch(TEXT_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ text, history }),
        signal: AbortSignal.timeout(30_000),
      });
      const data = (await r.json()) as { ok?: boolean; reply?: string; cards?: BroCard[]; error?: string };
      if (data.ok && data.reply) {
        reply = data.reply;
        cards = data.cards ?? [];
        this.ev.onMetric?.("bro.local.brain");
      } else this.ev.onMetric?.(`bro.local.fail.${String(data.error ?? "empty").replace(/[^a-z0-9_.-]/gi, "")}`);
    } catch {
      this.ev.onMetric?.("bro.local.fail.timeout");
    }
    if (this.closed) return;
    // Каскад молчит — не капитулируем: афиша и база площадок лежат в
    // нашем KV и достаются инструментами без всякой модели. Отвечаем
    // правилами, и только если и они пусты — признаёмся честно.
    if (!reply) {
      const byRules = await rulesReply(text, callBroTool, this.lang).catch(() => null);
      if (this.closed) return;
      if (byRules) {
        this.ev.onMetric?.("bro.local.rules");
        reply = byRules.say;
        cards = byRules.cards;
      }
    }
    if (!reply)
      reply = this.lang === "ru"
        ? "Мозг сейчас не отвечает — дай минуту и спроси ещё раз."
        : "My brain is not answering right now — give it a minute and ask again.";
    this.hist.push({ who: "bro", text: reply });
    this.ev.onLine?.({ who: "bro", text: reply, at: Date.now() });
    for (const c of cards.slice(0, 4)) this.ev.onCard?.(c);
    this.speak(reply);
  }

  /** Озвучка ответа кусками. Голос подбираем по языку самого текста:
   *  кириллица — русский, остальное — язык слуха. */
  private speak(text: string) {
    const chunks = ttsChunks(text);
    if (!chunks.length || !("speechSynthesis" in window)) {
      this.afterSpeech();
      return;
    }
    const langPrefix = /[а-яё]/i.test(text) ? "ru" : this.lang;
    const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(langPrefix));
    const voice = voices.find((v) => v.localService) ?? voices[0] ?? null;
    this.set("speaking");
    this.speakingN = chunks.length;
    for (const chunk of chunks) {
      const u = new SpeechSynthesisUtterance(chunk);
      if (voice) u.voice = voice;
      u.lang = voice?.lang ?? (langPrefix === "ru" ? "ru-RU" : this.locale);
      u.rate = 1.04;
      const doneOne = () => {
        this.speakingN--;
        if (this.speakingN <= 0) this.afterSpeech();
      };
      u.onend = doneOne;
      u.onerror = doneOne;
      speechSynthesis.speak(u);
    }
    this.touch();
  }

  private afterSpeech() {
    if (this.closed) return;
    this.set("listening");
    this.touch();
    if (!this.ptt) this.listen();
  }

  /** Перебивание: глушим озвучку мгновенно и слушаем дальше. */
  bargeIn() {
    try {
      speechSynthesis.cancel();
    } catch {
      /* нет синтеза — нечего глушить */
    }
    this.speakingN = 0;
    this.ev.onMetric?.("bro.bargein");
    this.set("listening");
  }

  mute(on: boolean) {
    if (on) this.rec?.abort();
    else if (!this.ptt && this.state === "listening") this.listen();
  }

  holdStart() {
    if (this.closed) return;
    if (this.state === "speaking" || this.state === "thinking") this.bargeIn();
    this.holdAt = Date.now();
    this.set("listening");
    this.touch();
    this.listen();
  }

  holdEnd() {
    if (this.closed || !this.rec) return;
    // Совсем короткое касание — промах пальцем, а не реплика.
    if (Date.now() - this.holdAt < 250) {
      this.commit = false;
      this.rec.abort();
      return;
    }
    this.commit = true;
    this.log("реплика ушла");
    this.set("thinking");
    this.rec.stop();
  }

  /** Служебная реплика от интерфейса (визитка): в мозг, но не на табло
   *  от имени человека. */
  say(text: string) {
    void this.ask(text, false);
  }

  /** Voice Lab: произнести дословно, без мозга. */
  speakVerbatim(text: string) {
    this.speak(text);
  }

  /** Громкость крутит Web Audio премиальных полос; у системной озвучки
   *  штатный уровень и так максимальный — ручка здесь ничего не делает. */
  setGain(_v: number) {
    /* намеренно пусто */
  }

  stop(reason = "user") {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.idleTimer);
    clearTimeout(this.maxTimer);
    try {
      this.rec?.abort();
    } catch {
      /* слух мог закрыться сам */
    }
    this.rec = null;
    try {
      speechSynthesis.cancel();
    } catch {
      /* нет синтеза */
    }
    this.log(`сессия закрыта · ${reason}`);
    this.ev.onMetric?.(`bro.session.stop.${reason.replace(/[^a-z-]/g, "")}`);
    if (this.startedAt)
      this.ev.onMetric?.(
        `bro.session.dur.${Math.min(8, Math.floor((Date.now() - this.startedAt) / 60000))}m`,
      );
    this.set("closed", reason);
  }
}
