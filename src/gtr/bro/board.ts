// Склейка строк табло BRO.
//
// Вынесено из оверлея отдельным модулем ради одного: это чистая логика, и
// она уже один раз подвела молча. Реплики гостя и BRO перемежаются — BRO
// начинает отвечать, не дожидаясь конца фразы, — поэтому «последняя строка»
// почти никогда не равна «моей строке». Оба обработчика обязаны искать свою
// недопечатанную строку назад по списку, иначе речь рвётся на осколки и
// табло показывает не то, что человек сказал, хотя расслышано верно.

/** Строка табло. sys — служебные сообщения, они всегда законченные. */
export type BoardRow = {
  who: "user" | "bro" | "sys";
  text: string;
  done: boolean;
  wait?: boolean;
};

/** Сколько строк держим в памяти: табло — не архив, а бегущая лента. */
const KEEP = 60;
const KEEP_DONE = 120;

/** Индекс последней недопечатанной строки автора; -1 — своей строки нет. */
const openRowOf = (rows: BoardRow[], who: BoardRow["who"]): number => {
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].who === who && !rows[i].done) return i;
  return -1;
};

/** Кусок распознавания — в свою недопечатанную строку, иначе новая строка. */
export function appendPartial(
  rows: BoardRow[],
  who: BoardRow["who"],
  chunk: string,
): BoardRow[] {
  if (!chunk) return rows;
  const at = openRowOf(rows, who);
  if (at < 0) return [...rows.slice(-KEEP), { who, text: chunk, done: false }];
  const next = [...rows];
  next[at] = { ...next[at], text: next[at].text + chunk };
  return next;
}

/** Финал распознавания заменяет свою недопечатанную строку целиком: у
 *  сервера итоговый текст точнее склейки кусков — в нём есть пунктуация и
 *  правки по контексту всей фразы. */
export function sealLine(rows: BoardRow[], who: BoardRow["who"], text: string): BoardRow[] {
  const at = openRowOf(rows, who);
  if (at < 0) return [...rows.slice(-KEEP), { who, text, done: true }];
  const next = [...rows];
  next[at] = { who, text, done: true };
  return next.slice(-KEEP_DONE);
}
