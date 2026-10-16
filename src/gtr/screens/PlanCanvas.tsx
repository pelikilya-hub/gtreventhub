// Холст «План»: граф события поверх чертежа площадки.
//
// Карточный граф хорош на большом мониторе, но на телефоне это стена
// прямоугольников 196×104, которую не охватить взглядом. Здесь блок — значок
// с подписью, холст двигается одним пальцем и масштабируется двумя, а под
// значки можно положить планировку зала: тогда граф отвечает не только «кто
// с кем связан», но и «кто где стоит».
//
// Координаты. Мир плана — 1000 единиц в ширину (высота — по пропорции
// чертежа). Позиции на плане (px/py) хранятся отдельно от x/y карточного
// графа: раскладка «по смыслу» и раскладка «по залу» — разные вещи, и
// перетаскивание в одной не должно ломать другую. Узел без px/py стоит там,
// в автоматической сетке, пока его не перетащат.
//
// Значки и связи рисуются в экранных координатах поверх масштабируемого
// слоя с чертежом: при отдалении план мельчает, а значки остаются размером
// с палец — как метки на карте.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  KINDS,
  linkStatus,
  nodeStatus,
  STATUS_COLOR,
  type GraphLink,
  type GraphNode,
} from "../data/app-data";
import { kindArt, UI_IC } from "../kind-art";
import { Icon } from "../ui";

export const PLAN_W = 1000;
export type PlanImage = { src: string; w: number; h: number; inv?: boolean };

// Узлы, которые ещё не ставили на план, раскладываются сеткой: площадка,
// за ней залы, потом остальное по типу. Колонок — по форме экрана: на
// телефоне три, чтобы значки читались без щипка, на мониторе пять.
const KIND_ORDER = [
  "venue", "room", "slot", "artist", "sound", "light", "decor", "gear",
  "interactive", "content", "staff", "promo", "money", "doc", "tech",
];
export const autoLayout = (
  nodes: GraphNode[],
  cols: number,
  top = 70,
  anchored: Record<string, unknown> = {},
) => {
  const free = nodes
    .filter((n) => (n.px == null || n.py == null) && !anchored[n.id])
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  const out = new Map<string, { x: number; y: number }>();
  free.forEach((n, i) => {
    out.set(n.id, { x: 80 + (i % cols) * 150, y: top + Math.floor(i / cols) * 140 });
  });
  return out;
};

type View = { s: number; tx: number; ty: number };
type Gesture =
  | { mode: "node"; id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean }
  | { mode: "wire"; id: string }
  | { mode: "pan"; sx: number; sy: number; v: View; moved: boolean; link?: string }
  | { mode: "pinch"; d0: number; cx: number; cy: number; v: View }
  | null;

const S_MIN = 0.15;
const S_MAX = 4;
const clampS = (s: number) => Math.min(S_MAX, Math.max(S_MIN, s));
const HIT = 34; // радиус попадания пальцем по значку, экранные px

export function PlanCanvas({
  nodes,
  links,
  plan,
  anchors = {},
  sel,
  linkFrom,
  fitKey,
  kidsOf,
  tr,
  onTap,
  onMove,
  onLink,
  onOpen,
  onHold,
  selLink = null,
  onLinkTap,
  fresh = null,
  centerRef,
  tools,
}: {
  nodes: GraphNode[];
  links: GraphLink[];
  plan?: PlanImage;
  /** где стоит значок, пока его не перетащили: залы — в центре своего зала на схеме */
  anchors?: Record<string, { x: number; y: number }>;
  sel: string;
  linkFrom: string | null;
  /** смена ключа (вошли в зал, сменили чертёж) — заново вписать в экран */
  fitKey: string;
  kidsOf: (id: string) => GraphNode[];
  tr: (s?: string | null) => string;
  onTap: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  onLink: (from: string, to: string) => void;
  onOpen: (id: string) => void;
  onHold: (id: string) => void;
  /** выбранная связь «from>to» и нажатие на связь */
  selLink?: string | null;
  onLinkTap?: (from: string, to: string) => void;
  /** только что добавленный блок — вспыхивает, чтобы его было видно */
  fresh?: string | null;
  /** сюда холст пишет центр экрана в координатах мира: новый блок ставится туда, куда смотрят */
  centerRef?: React.MutableRefObject<{ x: number; y: number } | null>;
  /** дополнительные кнопки в столбике управления (отменить, разложить) */
  tools?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ s: 1, tx: 0, ty: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const gest = useRef<Gesture>(null);
  const hold = useRef<number | null>(null);
  const lastTap = useRef<{ id: string; ts: number } | null>(null);
  const [wire, setWire] = useState<{ from: string; x: number; y: number } | null>(null);
  // во время перетаскивания позиция живёт локально, в граф пишется на отпускании
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);

  const planH = plan ? Math.round((PLAN_W * plan.h) / Math.max(1, plan.w)) : 0;
  const cols = size.w && size.w < 640 ? 3 : 5;
  const freeKey = nodes.filter((n) => n.px == null).map((n) => n.id).join(",");
  // с чертежом нерасставленные блоки ждут под ним, а не поверх залов
  const autoTop = plan ? planH + 90 : 70;
  const anchorKey = Object.keys(anchors).join(",");
  const auto = useMemo(
    () => autoLayout(nodes, cols, autoTop, anchors),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [freeKey, cols, autoTop, anchorKey],
  );
  const posBase = (n: GraphNode) =>
    n.px != null && n.py != null
      ? { x: n.px, y: n.py }
      : (anchors[n.id] ?? auto.get(n.id) ?? { x: 80, y: 70 });
  const posOf = (n: GraphNode) => (drag && drag.id === n.id ? { x: drag.x, y: drag.y } : posBase(n));
  const toScreen = (p: { x: number; y: number }, v = view) => ({ x: p.x * v.s + v.tx, y: p.y * v.s + v.ty });
  const local = (e: { clientX: number; clientY: number }) => {
    const r = boxRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  // ---------- размер и «вписать» ----------
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    if (!size.w || !size.h) return;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const n of nodes) {
      const p = posBase(n);
      xs.push(p.x);
      ys.push(p.y);
    }
    if (plan) {
      xs.push(0, PLAN_W);
      ys.push(0, planH);
    }
    if (!xs.length) {
      setView({ s: 1, tx: size.w / 2, ty: size.h / 2 });
      return;
    }
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    // поля под подписи значков: 60 по бокам, 50 сверху, 70 снизу
    const s = clampS(
      Math.min((size.w - 120) / Math.max(1, maxX - minX), (size.h - 120) / Math.max(1, maxY - minY), 1.6),
    );
    setView({
      s,
      tx: size.w / 2 - ((minX + maxX) / 2) * s,
      ty: size.h / 2 - ((minY + maxY) / 2) * s + 10,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h, fitKey, plan?.src, planH, nodes.length > 0, cols, anchorKey]);
  useEffect(fit, [fit]);

  useEffect(() => {
    if (!centerRef || !size.w) return;
    centerRef.current = { x: (size.w / 2 - view.tx) / view.s, y: (size.h / 2 - view.ty) / view.s };
  }, [centerRef, view, size.w, size.h]);

  const zoomAt = (cx: number, cy: number, k: number, v = viewRef.current) => {
    const s = clampS(v.s * k);
    const r = s / v.s;
    setView({ s, tx: cx - (cx - v.tx) * r, ty: cy - (cy - v.ty) * r });
  };

  // колесо: щипок трекпада (ctrl+колесо) — масштаб; обычная прокрутка
  // остаётся странице, иначе холст ловит скролл и страницу не пролистать
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const p = local(e);
      zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.01));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ---------- жесты ----------
  const nodeAt = (p: { x: number; y: number }, skip?: string) => {
    let best: { id: string; d: number } | null = null;
    for (const n of nodes) {
      if (n.id === skip) continue;
      const q = toScreen(posBase(n));
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < HIT && (!best || d < best.d)) best = { id: n.id, d };
    }
    return best?.id ?? null;
  };
  const clearHold = () => {
    if (hold.current) window.clearTimeout(hold.current);
    hold.current = null;
  };

  const onDown = (e: React.PointerEvent) => {
    const el = boxRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    const p = local(e);
    pts.current.set(e.pointerId, p);

    if (pts.current.size === 2) {
      // второй палец: всё прежнее отменяется, начинается щипок
      clearHold();
      setDrag(null);
      setWire(null);
      const [a, b] = [...pts.current.values()];
      gest.current = {
        mode: "pinch",
        d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
        v: viewRef.current,
      };
      return;
    }
    if (pts.current.size > 2) return;

    const target = e.target as HTMLElement;
    const port = target.closest<HTMLElement>("[data-port]");
    if (port) {
      const id = port.dataset.port!;
      gest.current = { mode: "wire", id };
      setWire({ from: id, x: p.x, y: p.y });
      return;
    }
    const tok = target.closest<HTMLElement>("[data-node]");
    if (tok) {
      const id = tok.dataset.node!;
      const n = nodes.find((x) => x.id === id);
      if (!n) return;
      const o = posBase(n);
      gest.current = { mode: "node", id, sx: p.x, sy: p.y, ox: o.x, oy: o.y, moved: false };
      clearHold();
      hold.current = window.setTimeout(() => {
        hold.current = null;
        const g = gest.current;
        if (g?.mode === "node" && !g.moved) {
          gest.current = null;
          setDrag(null);
          onHold(id);
        }
      }, 520);
      return;
    }
    const lk = target.closest<SVGElement>("[data-link]")?.dataset.link;
    gest.current = { mode: "pan", sx: p.x, sy: p.y, v: viewRef.current, moved: false, link: lk };
  };

  const onMoveP = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return;
    const p = local(e);
    pts.current.set(e.pointerId, p);
    const g = gest.current;
    if (!g) return;
    if (g.mode === "pinch") {
      const [a, b] = [...pts.current.values()];
      if (!a || !b) return;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const s = clampS(g.v.s * (d / g.d0));
      const r = s / g.v.s;
      // точка под пальцами остаётся под пальцами, плюс сдвиг центра щипка
      setView({ s, tx: cx - (g.cx - g.v.tx) * r, ty: cy - (g.cy - g.v.ty) * r });
      return;
    }
    if (g.mode === "pan") {
      const dx = p.x - g.sx;
      const dy = p.y - g.sy;
      if (!g.moved && Math.hypot(dx, dy) < 5) return;
      g.moved = true;
      setView({ ...g.v, tx: g.v.tx + dx, ty: g.v.ty + dy });
      return;
    }
    if (g.mode === "wire") {
      setWire({ from: g.id, x: p.x, y: p.y });
      return;
    }
    // node
    const dx = p.x - g.sx;
    const dy = p.y - g.sy;
    if (!g.moved && Math.hypot(dx, dy) < 6) return;
    if (!g.moved) clearHold();
    g.moved = true;
    const s = viewRef.current.s;
    setDrag({ id: g.id, x: Math.round(g.ox + dx / s), y: Math.round(g.oy + dy / s) });
  };

  const onUp = (e: React.PointerEvent) => {
    const p = local(e);
    pts.current.delete(e.pointerId);
    const g = gest.current;
    clearHold();
    if (!g) return;
    if (g.mode === "pinch") {
      // после щипка оставшийся палец не должен внезапно тащить холст
      if (pts.current.size === 0) gest.current = null;
      else {
        const [rest] = [...pts.current.values()];
        gest.current = { mode: "pan", sx: rest.x, sy: rest.y, v: viewRef.current, moved: true };
      }
      return;
    }
    gest.current = null;
    if (g.mode === "pan") {
      if (g.moved) return;
      if (g.link && onLinkTap) {
        const [from, to] = g.link.split(">");
        onLinkTap(from, to);
      } else onTap(null);
      return;
    }
    if (g.mode === "wire") {
      setWire(null);
      const to = nodeAt(p, g.id);
      if (to) onLink(g.id, to);
      return;
    }
    // node
    if (g.moved && drag) {
      onMove(g.id, Math.max(0, drag.x), Math.max(0, drag.y));
      setDrag(null);
      return;
    }
    setDrag(null);
    const now = Date.now();
    const twice = lastTap.current && lastTap.current.id === g.id && now - lastTap.current.ts < 320;
    lastTap.current = { id: g.id, ts: now };
    const n = nodes.find((x) => x.id === g.id);
    if (twice && n?.kind === "room") onOpen(g.id);
    else onTap(g.id);
  };

  const onCancel = (e: React.PointerEvent) => {
    pts.current.delete(e.pointerId);
    clearHold();
    gest.current = null;
    setDrag(null);
    setWire(null);
  };

  // ---------- отрисовка ----------
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const wireFrom = wire ? byId.get(wire.from) : undefined;
  const wireHit = wire ? nodeAt({ x: wire.x, y: wire.y }, wire.from) : null;

  // Отдалили — значки мельчают, подписи прячутся (кроме выбранного), как
  // метки на карте: иначе на телефоне схема площадки — каша из надписей.
  const ts = Math.min(1, Math.max(0.6, view.s * 1.6));

  return (
    <div
      ref={boxRef}
      className="gtr-plan"
      data-plan={plan ? "" : undefined}
      data-compact={ts < 0.8 || undefined}
      style={{ "--ts": ts } as React.CSSProperties}
      onPointerDown={onDown}
      onPointerMove={onMoveP}
      onPointerUp={onUp}
      onPointerCancel={onCancel}
      onContextMenu={(e) => e.preventDefault()}
    >
      {plan ? (
        <div
          className="gtr-plan-layer"
          style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.s})` }}
        >
          <img src={plan.src} alt="" draggable={false} width={PLAN_W} height={planH} data-inv={plan.inv || undefined} />
        </div>
      ) : null}

      <svg className="gtr-plan-links" aria-hidden="true">
        {links.map((l, i) => {
          const a = byId.get(l.from);
          const b = byId.get(l.to);
          if (!a || !b) return null;
          const p1 = toScreen(posOf(a));
          const p2 = toScreen(posOf(b));
          // лёгкий изгиб, чтобы встречные связи не сливались в одну линию
          const mx = (p1.x + p2.x) / 2 - (p2.y - p1.y) * 0.12;
          const my = (p1.y + p2.y) / 2 + (p2.x - p1.x) * 0.12;
          const ls = linkStatus(a, b);
          const d = `M${p1.x} ${p1.y} Q${mx} ${my} ${p2.x} ${p2.y}`;
          // подложка связи + бегущий поток поверх: видно, что связь живая
          // и в какую сторону она идёт
          return (
            <g
              key={i}
              className="gtr-link"
              data-st={ls}
              data-on={selLink === `${l.from}>${l.to}` || undefined}
              style={{ "--lc": STATUS_COLOR[ls] } as React.CSSProperties}
            >
              <path className="gtr-link-base" d={d} />
              <path className="gtr-link-flow" d={d} />
              {/* широкая невидимая полоса: по тонкой линии пальцем не попасть */}
              <path className="gtr-link-hit" d={d} data-link={`${l.from}>${l.to}`} />
            </g>
          );
        })}
        {wire && wireFrom ? (
          <line
            className="gtr-link-wire"
            x1={toScreen(posOf(wireFrom)).x}
            y1={toScreen(posOf(wireFrom)).y}
            x2={wire.x}
            y2={wire.y}
          />
        ) : null}
      </svg>

      {nodes.map((n, i) => {
        const K = KINDS[n.kind];
        const p = toScreen(posOf(n));
        const st = nodeStatus(n);
        const on = sel === n.id;
        const kids = n.kind === "room" ? kidsOf(n.id) : [];
        const target = (linkFrom && linkFrom !== n.id) || (wire && wire.from !== n.id);
        return (
          <div
            key={n.id}
            data-node={n.id}
            className="gtr-tok"
            data-kind={n.kind}
            data-on={on || undefined}
            data-target={target || undefined}
            data-hit={wireHit === n.id || undefined}
            data-drag={drag?.id === n.id || undefined}
            data-st={st.status}
            data-fresh={fresh === n.id || undefined}
            style={
              {
                left: p.x,
                top: p.y,
                "--k": K[1],
                "--st": STATUS_COLOR[st.status],
                "--i": Math.min(i, 14),
              } as React.CSSProperties
            }
            title={`${tr(K[0])} · ${tr(n.title)}`}
          >
            <span className="gtr-tok-orb">
              <img src={kindArt(n.kind)} alt="" draggable={false} />
              {st.status !== "ok" ? <span className="gtr-tok-st" /> : null}
              {kids.length ? <span className="gtr-tok-n">{kids.length}</span> : null}
            </span>
            <span className="gtr-tok-label">{tr(n.title)}</span>
            {on ? (
              <span className="gtr-tok-port" data-port={n.id} title={t("Потяните к другому блоку")}>
                <Icon d={UI_IC.link} size={15} />
              </span>
            ) : null}
          </div>
        );
      })}

      <div className="gtr-plan-ctl" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" className="gtr-ibtn" aria-label={t("Приблизить")} title={t("Приблизить")} onClick={() => zoomAt(size.w / 2, size.h / 2, 1.3)}>
          <Icon d={UI_IC.plus} size={18} />
        </button>
        <button type="button" className="gtr-ibtn" aria-label={t("Отдалить")} title={t("Отдалить")} onClick={() => zoomAt(size.w / 2, size.h / 2, 1 / 1.3)}>
          <Icon d={UI_IC.minus} size={18} />
        </button>
        <button type="button" className="gtr-ibtn" aria-label={t("Вписать в экран")} title={t("Вписать в экран")} onClick={fit}>
          <Icon d={UI_IC.fit} size={17} />
        </button>
        {tools ? (
          <>
            <span className="gtr-plan-ctl-sep" aria-hidden="true" />
            {tools}
          </>
        ) : null}
      </div>

      {!nodes.length ? (
        <div className="gtr-plan-empty">{t("Добавьте блоки из палитры — они появятся здесь значками")}</div>
      ) : null}
    </div>
  );
}
