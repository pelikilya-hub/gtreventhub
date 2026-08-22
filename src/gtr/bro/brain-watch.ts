// Сторож мозга BOSS: замечает падение раньше, чем его заметит гость.
//
// История, ради которой это написано: адрес мозга протух, продукт молча
// откатился на разбор правилами, и пять дней никто не знал — пока BOSS
// не спросил «что с мозгом бро?». Отказ был не громкий, а тихий, и
// тихий отказ живёт ровно столько, сколько на него не смотрят.
//
// Поэтому здесь не «перезапустить» (до сервера воркер не дотянется), а
// «сказать вслух»: переход в падение и обратно попадает в очередь пульта,
// которую Claude читает каждый час.

/** Состояние наблюдения. Живёт в KV между прогонами крона. */
export type BrainWatch = {
  /** Тревога поднята: о падении уже сообщено. */
  down: boolean;
  /** Сколько проб подряд не удались. */
  fails: number;
  /** Когда установилось текущее состояние, epoch ms. */
  since: number;
  /** Последняя удачная проба, epoch ms. 0 — удачных ещё не было. */
  lastOk: number;
};

/** Сколько неудачных проб подряд считаем падением.
 *
 *  Одна проба — это не диагноз: сеть между Cloudflare и Hetzner моргает,
 *  а холодный инференс после простоя отвечает не мгновенно. Две подряд
 *  при шаге крона в 15 минут — это полчаса молчания, тут уже не помеха. */
export const FAILS_TO_ALARM = 2;

/** Что произошло на этом шаге: «упал», «поднялся» или ничего нового. */
export type Alarm = "down" | "up" | null;

export type WatchStep = { next: BrainWatch; alarm: Alarm };

/** Шаг наблюдения. Чистая функция: состояние на входе, состояние и
 *  событие на выходе — ни KV, ни сети, ни часов внутри.
 *
 *  Тревога поднимается и снимается ровно один раз на переход: пока мозг
 *  лежит, сторож молчит. Сторож, который повторяет одно и то же каждые
 *  пятнадцать минут, обучает не чинить, а не читать. */
export function stepWatch(
  prev: BrainWatch | null,
  probeOk: boolean,
  now: number,
): WatchStep {
  if (probeOk) {
    const recovered = Boolean(prev?.down);
    return {
      next: {
        down: false,
        fails: 0,
        since: recovered || !prev ? now : prev.since,
        lastOk: now,
      },
      alarm: recovered ? "up" : null,
    };
  }
  const fails = (prev?.fails ?? 0) + 1;
  const alarm: Alarm = !prev?.down && fails >= FAILS_TO_ALARM ? "down" : null;
  return {
    next: {
      down: prev?.down || fails >= FAILS_TO_ALARM,
      fails,
      since: alarm ? now : (prev?.since ?? now),
      lastOk: prev?.lastOk ?? 0,
    },
    alarm,
  };
}

/** Человеческий текст тревоги для очереди пульта.
 *
 *  Пишем длительность, а не голый факт: «лежит 40 минут» и «лежит сутки» —
 *  разные задачи, и решать это должен читающий, а не сторож. */
export function alarmText(alarm: Exclude<Alarm, null>, w: BrainWatch, now: number): string {
  if (alarm === "down") {
    const seen = w.lastOk ? `последний удачный ответ ${ago(now - w.lastOk)} назад` : "удачных ответов ещё не было";
    return `Мозг BOSS не отвечает: ${w.fails} пробы подряд мимо, ${seen}. Проверь VPS: контейнер brain, адрес в setting:brain.`;
  }
  return `Мозг BOSS снова отвечает. Лежал ${ago(now - w.since)}.`;
}

/** Грубая длительность по-русски: сторожу хватает порядка величины. */
export const ago = (ms: number): string => {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} мин`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} ч`;
  return `${Math.round(h / 24)} сут`;
};
