// Полноэкранный просмотр фото: свайпы и safe-area для iOS, стрелки и
// клавиатура для десктопа. Без библиотек — один оверлей на портале стилей.
import { useCallback, useEffect, useRef, useState } from "react";

export function GtrLightbox({
  images,
  index,
  onClose,
  credit,
}: {
  images: string[];
  index: number;
  onClose: () => void;
  credit?: string;
}) {
  const [i, setI] = useState(index);
  const [drag, setDrag] = useState(0);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const prev = useCallback(() => setI((x) => (x - 1 + images.length) % images.length), [images.length]);
  const next = useCallback(() => setI((x) => (x + 1) % images.length), [images.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, prev, next]);

  return (
    <div
      className="gtr-lightbox"
      onClick={onClose}
      onTouchStart={(e) => {
        touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }}
      onTouchMove={(e) => {
        if (touch.current) setDrag(e.touches[0].clientX - touch.current.x);
      }}
      onTouchEnd={(e) => {
        const t = touch.current;
        touch.current = null;
        setDrag(0);
        if (!t) return;
        const dx = e.changedTouches[0].clientX - t.x;
        const dy = e.changedTouches[0].clientY - t.y;
        if (Math.abs(dy) > 90 && Math.abs(dy) > Math.abs(dx)) return onClose(); // свайп вниз — закрыть
        if (dx < -50) next();
        else if (dx > 50) prev();
      }}
    >
      <img
        key={images[i]}
        src={images[i]}
        alt=""
        className="gtr-lightbox-img"
        style={{ transform: drag ? `translateX(${drag}px)` : undefined }}
        onClick={(e) => e.stopPropagation()}
      />
      <button className="gtr-lightbox-x" onClick={onClose} aria-label="Закрыть">
        ✕
      </button>
      {images.length > 1 ? (
        <>
          <button
            className="gtr-lightbox-nav"
            style={{ left: 0 }}
            onClick={(e) => {
              e.stopPropagation();
              prev();
            }}
            aria-label="Назад"
          >
            ‹
          </button>
          <button
            className="gtr-lightbox-nav"
            style={{ right: 0 }}
            onClick={(e) => {
              e.stopPropagation();
              next();
            }}
            aria-label="Вперёд"
          >
            ›
          </button>
        </>
      ) : null}
      <div className="gtr-lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span className="gtr-mono" style={{ font: "600 12px/1 'JetBrains Mono',monospace" }}>
          {i + 1} / {images.length}
        </span>
        {credit ? (
          <span
            className="gtr-mono"
            style={{ font: "500 11px/1.45 'JetBrains Mono',monospace", opacity: 0.55, marginLeft: 10 }}
          >
            {credit}
          </span>
        ) : null}
      </div>
    </div>
  );
}
