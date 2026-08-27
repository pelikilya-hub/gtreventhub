// Подготовка постера к загрузке — в браузере, до отправки.
//
// Афиши приходят от площадок как есть: снимок экрана с ретины, экспорт из
// фотошопа, кадр из сторис на четыре мегабайта. Такое нельзя класть в KV
// (лимит значения) и незачем гнать гостю в ленту. Сжимаем на клиенте: длинная
// сторона до 1200 точек, JPEG с падающим качеством, пока не влезет в лимит.
//
// Файл клиентский: DOM здесь используется намеренно, на воркере он не нужен.

/** Предел размера base64-строки, который принимает afishaPosterFn. */
export const POSTER_UPLOAD_LIMIT = 1_400_000;

const MAX_SIDE = 1200;
const QUALITY = [0.86, 0.74, 0.62, 0.5, 0.4];

const readImage = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("read"));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode"));
      img.onload = () => resolve(img);
      img.src = String(fr.result);
    };
    fr.readAsDataURL(file);
  });

/** Файл → data-URL, готовый для afishaPosterFn. Бросает, если даже на
 *  минимальном качестве картинка не влезает в лимит. */
export async function shrinkPoster(file: File): Promise<string> {
  const img = await readImage(file);
  const k = Math.min(1, MAX_SIDE / Math.max(1, img.width, img.height));
  const w = Math.max(1, Math.round(img.width * k));
  const h = Math.max(1, Math.round(img.height * k));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) throw new Error("canvas");
  // Афиши часто с прозрачностью; JPEG её не знает — подкладываем чёрное
  // поле продукта, иначе прозрачные места станут белыми пятнами.
  g.fillStyle = "#0A0B0D";
  g.fillRect(0, 0, w, h);
  g.drawImage(img, 0, 0, w, h);
  for (const q of QUALITY) {
    const url = c.toDataURL("image/jpeg", q);
    const b64 = url.slice(url.indexOf(",") + 1);
    if (b64.length <= POSTER_UPLOAD_LIMIT) return url;
  }
  throw new Error("too-big");
}
