// Слой правок контента GTR Event: тексты, прайсы, фото (замена/кадр/экспозиция)
// и документы — поверх базовых данных площадок. Правки хранятся в абстрактном
// сторе (сейчас localStorage; далее — Supabase без изменения экранов).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// Неразрушающая правка фото: замена URL + кадр (зум/сдвиг) + экспозиция.
export type PhotoEdit = {
  url?: string; // если задан — заменяет исходное фото
  scale: number; // 1..3 зум
  x: number; // -50..50 сдвиг по X, %
  y: number; // -50..50 сдвиг по Y, %
  brightness: number; // %
  contrast: number; // %
  saturate: number; // %
  temp: number; // -100..100 тёплость (тёплее/холоднее)
};

export const DEFAULT_PHOTO: PhotoEdit = {
  scale: 1,
  x: 0,
  y: 0,
  brightness: 100,
  contrast: 100,
  saturate: 100,
  temp: 0,
};

export const photoFilter = (p: PhotoEdit) => {
  const warm =
    p.temp > 0
      ? `sepia(${p.temp}%) saturate(${100 + p.temp / 3}%)`
      : p.temp < 0
        ? `sepia(${-p.temp}%) hue-rotate(180deg)`
        : "";
  return `brightness(${p.brightness}%) contrast(${p.contrast}%) saturate(${p.saturate}%) ${warm}`.trim();
};

export const photoTransform = (p: PhotoEdit) => `translate(${p.x}%, ${p.y}%) scale(${p.scale})`;

export type VenueDoc = { name: string; url: string };

// Правки одной площадки. Любое поле опционально — накладывается на базу.
export type VenueContent = {
  texts?: Record<string, string>; // name, type, concept, events, facilities, capacity, music, phone, email …
  feeThb?: number | null; // приватная аренда / мин. спенд, THB
  roomFees?: Record<string, number>; // прайс по залам (ключ — id зала)
  hero?: PhotoEdit;
  gallery?: string[]; // доп. URL к галерее
  docs?: VenueDoc[];
};

type ContentState = Record<string, VenueContent>;

type ContentStore = {
  editMode: boolean;
  setEditMode: (on: boolean) => void;
  overrides: ContentState;
  contentOf: (vid: string) => VenueContent;
  setVenue: (vid: string, patch: Partial<VenueContent>) => void;
  setHero: (vid: string, patch: Partial<PhotoEdit>) => void;
  resetHero: (vid: string) => void;
};

const KEY = "gtr-content-v1";
const Ctx = createContext<ContentStore | null>(null);

const load = (): ContentState => {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || "{}") as ContentState;
  } catch {
    return {};
  }
};

export function ContentProvider({ children }: { children: ReactNode }) {
  const [overrides, setOverrides] = useState<ContentState>({});
  const [editMode, setEditMode] = useState(false);

  useEffect(() => {
    setOverrides(load());
  }, []);

  const commit = useCallback((next: ContentState) => {
    setOverrides(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // квота — некритично на этапе разработки
    }
  }, []);

  const value = useMemo<ContentStore>(
    () => ({
      editMode,
      setEditMode,
      overrides,
      contentOf: (vid) => overrides[vid] ?? {},
      setVenue: (vid, patch) =>
        commit({ ...overrides, [vid]: { ...(overrides[vid] ?? {}), ...patch } }),
      setHero: (vid, patch) => {
        const cur = overrides[vid]?.hero ?? DEFAULT_PHOTO;
        commit({ ...overrides, [vid]: { ...(overrides[vid] ?? {}), hero: { ...cur, ...patch } } });
      },
      resetHero: (vid) => {
        const { hero: _drop, ...rest } = overrides[vid] ?? {};
        commit({ ...overrides, [vid]: rest });
      },
    }),
    [overrides, editMode, commit],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useContent = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useContent вне ContentProvider");
  return v;
};
