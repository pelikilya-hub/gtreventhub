// Масштаб продукта: щипок двумя пальцами больше ничего не растягивает,
// увеличение живёт на трёх пальцах.
//
// Почему так. Экран плотный: ленты идут от края до края, знаки крупные,
// кнопки прижаты к стенкам. Случайный щипок двумя пальцами при таком
// раскладе ловится постоянно — палец соскользнул на прокрутке, и вёрстка
// уехала. Убрать увеличение совсем нельзя: кому-то нужно рассмотреть
// афишу или мелкий текст. Поэтому жест разведён по числу пальцев —
// два больше не масштабируют, три масштабируют.
//
// Системного «зума тремя пальцами» в вебе нет, поэтому он собран здесь
// руками: трансформируется только колонка контента, а шапка, плеер и
// нижняя панель остаются на своих местах в исходном масштабе — иначе
// в увеличенном виде до навигации было бы не дотянуться.
//
// Карта — исключение: у Leaflet свой щипок двумя пальцами, и отбирать
// его нельзя, там это основной способ работы.

const MIN = 1;
const MAX = 3;
const SNAP = 1.04; // ниже этого при отпускании возвращаемся в единицу

type Pt = { x: number; y: number };

const centroid = (ts: TouchList): Pt => {
  let x = 0;
  let y = 0;
  for (let i = 0; i < ts.length; i++) {
    x += ts[i].clientX;
    y += ts[i].clientY;
  }
  return { x: x / ts.length, y: y / ts.length };
};

// Средний радиус разлёта пальцев от их общего центра. Для трёх и более
// точек это честнее, чем расстояние между двумя крайними: жест остаётся
// устойчивым, даже если один палец подрагивает.
const spread = (ts: TouchList): number => {
  const c = centroid(ts);
  let s = 0;
  for (let i = 0; i < ts.length; i++) {
    s += Math.hypot(ts[i].clientX - c.x, ts[i].clientY - c.y);
  }
  return Math.max(1, s / ts.length);
};

const inMap = (t: EventTarget | null): boolean =>
  t instanceof Element && !!t.closest(".leaflet-container");

export const installZoom = (): (() => void) => {
  if (typeof document === "undefined") return () => {};

  let main: HTMLElement | null = null;
  let k = 1;
  let tx = 0;
  let ty = 0;

  let startK = 1;
  let startSpread = 0;
  let startC: Pt = { x: 0, y: 0 };
  let active = false;

  const paint = (smooth: boolean) => {
    if (!main) return;
    main.style.transition = smooth ? "transform 0.22s cubic-bezier(0.32, 0.72, 0, 1)" : "none";
    main.style.transformOrigin = "0 0";
    main.style.transform = k === 1 && tx === 0 && ty === 0 ? "" : `translate(${tx}px, ${ty}px) scale(${k})`;
    main.style.willChange = k === 1 ? "" : "transform";
  };

  // По горизонтали увеличенная колонка не должна оголять фон, по
  // вертикали ограничиваем мягче: страница длинная и всё равно
  // прокручивается обычным способом.
  const clamp = () => {
    if (!main) return;
    const w = main.offsetWidth;
    const minX = w - w * k;
    tx = Math.min(0, Math.max(minX, tx));
    const h = main.offsetHeight;
    ty = Math.min(0, Math.max(h - h * k, ty));
  };

  const onStart = (e: TouchEvent) => {
    if (inMap(e.target)) return;
    if (e.touches.length < 3) return;
    main = document.querySelector<HTMLElement>(".gtr-main");
    if (!main) return;
    active = true;
    startK = k;
    startSpread = spread(e.touches);
    startC = centroid(e.touches);
    e.preventDefault();
  };

  const onMove = (e: TouchEvent) => {
    if (inMap(e.target)) return;

    // Щипок двумя пальцами гасим: именно он уводил вёрстку случайно.
    if (e.touches.length === 2 && e.cancelable) {
      e.preventDefault();
      return;
    }
    if (!active || e.touches.length < 3 || !main) return;
    e.preventDefault();

    const c = centroid(e.touches);
    const next = Math.min(MAX, Math.max(MIN, (startK * spread(e.touches)) / startSpread));

    // Точка под центром жеста остаётся на месте: масштаб «тянется» из-под
    // пальцев, а не из угла экрана.
    const r = main.getBoundingClientRect();
    const cx = startC.x - r.left + tx;
    const cy = startC.y - r.top + ty;
    tx += cx - (cx * next) / k;
    ty += cy - (cy * next) / k;
    k = next;

    // Пальцы поехали — вместе с ними едет и содержимое.
    tx += c.x - startC.x;
    ty += c.y - startC.y;
    startC = c;

    clamp();
    paint(false);
  };

  const onEnd = (e: TouchEvent) => {
    if (!active || e.touches.length >= 3) return;
    active = false;
    if (k <= SNAP) {
      k = 1;
      tx = 0;
      ty = 0;
      paint(true);
    }
  };

  // iOS Safari ведёт свой собственный счёт жестов и не смотрит на
  // user-scalable: без этих трёх обработчиков щипок всё равно растянет
  // страницу целиком, поверх нашей математики.
  const stopGesture = (e: Event) => {
    if (inMap(e.target)) return;
    e.preventDefault();
  };

  // Переход на другой экран возвращает масштаб в единицу: увеличение —
  // это «рассмотреть вот это здесь», а не режим, в котором живёшь. Иначе
  // пользователь уходит в раздел и получает его в двукратном виде, не
  // понимая, почему.
  const reset = () => {
    if (k === 1 && tx === 0 && ty === 0) return;
    main = main ?? document.querySelector<HTMLElement>(".gtr-main");
    k = 1;
    tx = 0;
    ty = 0;
    paint(false);
  };
  // Слушать перерисовку колонки нельзя: на момент установки её в дереве
  // ещё нет — экраны приезжают лениво. Поэтому ловим сам переход:
  // pushState для обычной навигации, popstate для «назад».
  const onNav = () => queueMicrotask(reset);
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function (...a: Parameters<typeof origPush>) {
    const r = origPush.apply(this, a);
    onNav();
    return r;
  };
  history.replaceState = function (...a: Parameters<typeof origReplace>) {
    const r = origReplace.apply(this, a);
    onNav();
    return r;
  };
  window.addEventListener("popstate", onNav);

  document.addEventListener("touchstart", onStart, { passive: false });
  document.addEventListener("touchmove", onMove, { passive: false });
  document.addEventListener("touchend", onEnd);
  document.addEventListener("touchcancel", onEnd);
  document.addEventListener("gesturestart", stopGesture as EventListener, { passive: false });
  document.addEventListener("gesturechange", stopGesture as EventListener, { passive: false });
  document.addEventListener("gestureend", stopGesture as EventListener, { passive: false });

  return () => {
    history.pushState = origPush;
    history.replaceState = origReplace;
    window.removeEventListener("popstate", onNav);
    document.removeEventListener("touchstart", onStart);
    document.removeEventListener("touchmove", onMove);
    document.removeEventListener("touchend", onEnd);
    document.removeEventListener("touchcancel", onEnd);
    document.removeEventListener("gesturestart", stopGesture as EventListener);
    document.removeEventListener("gesturechange", stopGesture as EventListener);
    document.removeEventListener("gestureend", stopGesture as EventListener);
    if (main) {
      main.style.transform = "";
      main.style.transition = "";
      main.style.willChange = "";
    }
  };
};
