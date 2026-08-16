// Танцор GTR — тот самый жилец из Winamp, только это BOSS.
//
// Выходит сбоку, когда включают плеер, и уходит за край, когда его
// останавливают. Танцует от реального баса трека: плеер кладёт его в
// --gtr-pulse, ту же величину использует свечение шапки. Фигуру можно
// перетащить куда угодно, и она там останется — место помнится между
// заходами.
//
// Во время перетаскивания ничего не перерисовывается: позиция пишется
// прямо в стиль внутри одного кадра. Тот же приём, что в свайпе брони,
// и по той же причине — на слабом телефоне иначе теряются кадры.
import { useEffect, useRef } from "react";

const SPOT = "gtr-dancer-spot";

export function GtrDancer() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const posRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<{ id: number; ox: number; oy: number } | null>(null);
  const rafRef = useRef(0);

  // где стоял в прошлый раз
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SPOT);
      if (raw) posRef.current = JSON.parse(raw) as { x: number; y: number };
    } catch {
      /* место не вспомнилось — встанет по умолчанию */
    }
    paint();
  }, []);

  const paint = () => {
    const el = rootRef.current;
    if (!el) return;
    const { x, y } = posRef.current;
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  };

  const onDown = (e: React.PointerEvent) => {
    const el = rootRef.current;
    if (!el) return;
    dragRef.current = { id: e.pointerId, ox: e.clientX - posRef.current.x, oy: e.clientY - posRef.current.y };
    el.setPointerCapture(e.pointerId);
    el.classList.add("dragging");
  };

  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    posRef.current = { x: e.clientX - d.ox, y: e.clientY - d.oy };
    if (!rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        paint();
      });
  };

  const onUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    dragRef.current = null;
    rootRef.current?.classList.remove("dragging");
    try {
      localStorage.setItem(SPOT, JSON.stringify(posRef.current));
    } catch {
      /* приватный режим — просто не запомним */
    }
  };

  return (
    <div
      ref={rootRef}
      className="gtr-dancer"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      aria-hidden
    >
      <div className="gtr-dancer-slide">
        <div className="gtr-dancer-pulse">
          <img className="gtr-dancer-img" src="/brand/dancer.png" alt="" draggable={false} />
        </div>
      </div>
    </div>
  );
}
