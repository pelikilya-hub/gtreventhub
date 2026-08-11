import { useRef, useState, type CSSProperties } from "react";

import { DEFAULT_PHOTO, photoFilter, photoTransform, useContent, type PhotoEdit } from "./content";
import { Eyebrow } from "./ui";

// Фото площадки с неразрушающими правками (кадр + экспозиция) и, в режиме
// редактирования, панелью замены/настройки. Используется на всех геро-блоках.
export function EditableImage({
  vid,
  fallback,
  alt,
  style,
  overlay,
  rounded = 0,
}: {
  vid: string;
  fallback?: string;
  alt: string;
  style?: CSSProperties; // стили контейнера (позиционирование, размеры)
  overlay?: CSSProperties["background"]; // затемняющий градиент поверх
  rounded?: number;
}) {
  const { editMode, contentOf, setHero, resetHero } = useContent();
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const c = contentOf(vid);
  const photo: PhotoEdit = c.hero ?? DEFAULT_PHOTO;
  const src = photo.url || fallback;

  const onFile = (f: File | undefined) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setHero(vid, { url: String(reader.result) });
    reader.readAsDataURL(f);
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        borderRadius: rounded,
        ...style,
      }}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          draggable={false}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: photoTransform(photo),
            filter: photoFilter(photo),
            transition: "transform .12s, filter .12s",
          }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "rgba(255,255,255,.14)",
            font: "500 11px/1 'JetBrains Mono',monospace",
            // фирменный паттерн из бренд-кита вместо пустого прямоугольника
            background:
              "linear-gradient(rgba(10,11,13,.82), rgba(10,11,13,.82)), url(/brand/GTR_pattern_dark.svg) center / 480px auto",
          }}
        >
          нет фото
        </div>
      )}
      {overlay ? <div style={{ position: "absolute", inset: 0, background: overlay }} /> : null}

      {editMode ? (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              zIndex: 3,
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 9px",
              borderRadius: 0,
              cursor: "pointer",
              border: "1px solid rgba(229,35,27,.6)",
              background: "rgba(10,11,13,.8)",
              color: "#fff",
              font: "600 10px/1 'Golos Text',sans-serif",
              backdropFilter: "blur(4px)",
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#E5231B"
              strokeWidth="2"
            >
              <path d="M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
            </svg>
            Фото
          </button>

          {open ? (
            <PhotoPanel
              photo={photo}
              onPick={() => fileRef.current?.click()}
              onChange={(patch) => setHero(vid, patch)}
              onReset={() => {
                resetHero(vid);
                setOpen(false);
              }}
              onClose={() => setOpen(false)}
            />
          ) : null}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </>
      ) : null}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: "grid", gap: 4 }}>
      <span style={{ display: "flex", justifyContent: "space-between" }}>
        <Eyebrow style={{ fontSize: 8.5 }}>{label}</Eyebrow>
        <span
          className="gtr-mono"
          style={{ font: "600 9px/1 'JetBrains Mono',monospace", color: "var(--gtr-t2)" }}
        >
          {value}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: "#E5231B", cursor: "pointer" }}
      />
    </label>
  );
}

function PhotoPanel({
  photo,
  onPick,
  onChange,
  onReset,
  onClose,
}: {
  photo: PhotoEdit;
  onPick: () => void;
  onChange: (patch: Partial<PhotoEdit>) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        top: 74,
        right: 24,
        zIndex: 1000,
        width: 264,
        maxWidth: "calc(100vw - 32px)",
        maxHeight: "calc(100vh - 96px)",
        overflowY: "auto",
        padding: 14,
        borderRadius: 0,
        background: "rgba(12,13,16,.97)",
        border: "1px solid rgba(255,255,255,.14)",
        boxShadow: "0 18px 40px rgba(0,0,0,.6)",
        backdropFilter: "blur(8px)",
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Eyebrow>РЕДАКТИРОВАНИЕ ФОТО</Eyebrow>
        <button
          onClick={onClose}
          style={{
            marginLeft: "auto",
            border: "none",
            background: "transparent",
            color: "rgba(255,255,255,.5)",
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          ×
        </button>
      </div>

      <button className="gtr-btn gtr-btn-red" style={{ width: "100%" }} onClick={onPick}>
        Заменить фото…
      </button>

      <Eyebrow style={{ fontSize: 8.5, marginTop: 2 }}>КАДР</Eyebrow>
      <Slider
        label="Зум"
        value={photo.scale}
        min={1}
        max={3}
        step={0.05}
        suffix="×"
        onChange={(v) => onChange({ scale: v })}
      />
      <Slider
        label="Сдвиг X"
        value={photo.x}
        min={-50}
        max={50}
        suffix="%"
        onChange={(v) => onChange({ x: v })}
      />
      <Slider
        label="Сдвиг Y"
        value={photo.y}
        min={-50}
        max={50}
        suffix="%"
        onChange={(v) => onChange({ y: v })}
      />

      <Eyebrow style={{ fontSize: 8.5, marginTop: 2 }}>ЭКСПОЗИЦИЯ</Eyebrow>
      <Slider
        label="Яркость"
        value={photo.brightness}
        min={40}
        max={160}
        suffix="%"
        onChange={(v) => onChange({ brightness: v })}
      />
      <Slider
        label="Контраст"
        value={photo.contrast}
        min={40}
        max={160}
        suffix="%"
        onChange={(v) => onChange({ contrast: v })}
      />
      <Slider
        label="Насыщенность"
        value={photo.saturate}
        min={0}
        max={200}
        suffix="%"
        onChange={(v) => onChange({ saturate: v })}
      />
      <Slider
        label="Тёплость"
        value={photo.temp}
        min={-100}
        max={100}
        onChange={(v) => onChange({ temp: v })}
      />

      <button className="gtr-btn" style={{ width: "100%", marginTop: 2 }} onClick={onReset}>
        Сбросить к исходному
      </button>
    </div>
  );
}
