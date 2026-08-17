// Разговор живёт три минуты после последней реплики. Вернулся раньше —
// продолжаешь с того же места: человек вышел посмотреть карту и пришёл
// обратно. Вернулся позже — это уже другой разговор, и тащить в него
// вчерашний поиск и чужие карточки незачем.
//
// Отметка лежит в localStorage, а не в памяти компонента: перезагрузка
// страницы и повторный вход в приложение должны считаться так же.
export const CHAT_TTL_MS = 3 * 60_000;
const TOUCH_KEY = "gtr.bro.lastAt";

export const touchChat = () => {
  try {
    localStorage.setItem(TOUCH_KEY, String(Date.now()));
  } catch {
    // приватный режим Safari: без отметки разговор просто всегда свежий
  }
};

export const chatStale = (): boolean => {
  try {
    const t = Number(localStorage.getItem(TOUCH_KEY));
    return !t || Date.now() - t > CHAT_TTL_MS;
  } catch {
    return false;
  }
};
