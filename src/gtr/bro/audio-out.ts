// Громкий выход GTR BRO.
//
// Три причины, по которым голос в клубе звучит шёпотом, и все лечатся
// здесь, а не ручкой громкости телефона:
//
// 1. Маршрут. Пока страница держит микрофон, iOS считает разговор
//    телефонным и уводит звук в разговорный динамик у уха — тот самый
//    «сломанный динамик». Safari 16.4+ разрешает сказать системе, чего
//    мы хотим, через navigator.audioSession: в режиме рации микрофон
//    нужен только пока палец на кнопке, всё остальное время просим
//    «playback» — и звук возвращается на громкий динамик.
// 2. Уровень. Модель отдаёт спокойный студийный сигнал; в помещении с
//    музыкой этого мало. Поднимаем усилением.
// 3. Пики. Простое усиление режет по клиппингу и превращает речь в
//    хрип. Поэтому сначала компрессор, потом усиление — громко и без
//    песка.

type SessionType = "playback" | "play-and-record" | "auto";

type AudioSessionNav = Navigator & { audioSession?: { type: SessionType } };

/** Сказать iOS, куда вести звук. На других платформах — тихо мимо. */
export const routeAudio = (mode: SessionType): void => {
  try {
    const n = navigator as AudioSessionNav;
    if (n.audioSession) n.audioSession.type = mode;
  } catch {
    // Ни одна попытка настроить маршрут не должна ронять разговор.
  }
};

/** Пределы: тише единицы смысла нет, выше шести начинается каша. */
export const GAIN_MIN = 1;
export const GAIN_MAX = 6;
const KEY = "gtr-bro-gain";

export const loadGain = (): number => {
  try {
    const v = Number(localStorage.getItem(KEY));
    return v >= GAIN_MIN && v <= GAIN_MAX ? v : 3;
  } catch {
    return 3;
  }
};

export const saveGain = (v: number): void => {
  try {
    localStorage.setItem(KEY, String(v));
  } catch {
    // приватный режим — переживём, останется значение по умолчанию
  }
};

/** Тракт: компрессор ровняет пики, усилитель поднимает всё целиком. */
export class LoudOut {
  readonly input: GainNode;
  private gainNode: GainNode;

  constructor(private ctx: AudioContext, gain = loadGain()) {
    this.input = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    // Речь, а не мастеринг: жмём рано и сильно, чтобы тихие места
    // подтянулись к громким, но атака осталась живой.
    comp.threshold.value = -26;
    comp.knee.value = 24;
    comp.ratio.value = 12;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    this.gainNode = ctx.createGain();
    this.gainNode.gain.value = gain;
    this.input.connect(comp);
    comp.connect(this.gainNode);
    this.gainNode.connect(ctx.destination);
  }

  setGain(v: number): void {
    const g = Math.max(GAIN_MIN, Math.min(GAIN_MAX, v));
    // Плавно: скачок усиления слышен щелчком.
    this.gainNode.gain.setTargetAtTime(g, this.ctx.currentTime, 0.05);
    saveGain(g);
  }

  get gain(): number {
    return this.gainNode.gain.value;
  }
}
