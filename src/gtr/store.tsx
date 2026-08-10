// Общий стор GTR Event: события календаря, графы конструктора и лайнап
// персистятся в localStorage и синхронизируются между открытыми вкладками
// (разными участниками) через BroadcastChannel — правки видны всем сразу.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { SessionUser } from "./auth";
import {
  GRAPH_SEED,
  seedEvents,
  venueGraph,
  type CalEvent,
  type EventDraft,
  type Graph,
  type OrgRequest,
} from "./data/app-data";

type Shared = {
  events: CalEvent[];
  drafts: EventDraft[]; // события конструктора
  lineup: string[];
  requests: OrgRequest[];
};

export type Peer = { id: string; name: string; roleLabel: string; initials: string; ts: number };

type GtrStore = {
  user: SessionUser;
  shared: Shared;
  peers: Peer[];
  setEvents: (fn: (list: CalEvent[]) => CalEvent[]) => void;
  setLineup: (fn: (ids: string[]) => string[]) => void;
  addRequest: (req: OrgRequest) => void;
  updateRequest: (id: string, patch: Partial<OrgRequest>) => void;
  // события конструктора
  drafts: EventDraft[];
  draftOf: (id: string) => EventDraft | undefined;
  draftsOf: (venueId: string) => EventDraft[];
  createDraft: (init: Partial<EventDraft> & { venueId: string }) => string;
  updateDraft: (id: string, patch: Partial<EventDraft>) => void;
  setDraftGraph: (id: string, fn: (g: Graph) => Graph) => void;
  deleteDraft: (id: string) => void;
};

const KEY = "gtr-shared-v1";
const CH = "gtr-sync-v1";

const mkId = () => `EV-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

// Стартовые события: по одному на каждую засеянную вручную площадку —
// чтобы демо не открывалось пустым, но они уже обычные записи, а не
// единственно возможный граф этой площадки.
const seedDrafts = (): EventDraft[] =>
  Object.entries(GRAPH_SEED).map(([venueId, graph], i) => ({
    id: `EV-seed-${i + 1}`,
    venueId,
    title: "",
    format: "Событие площадки",
    guests: "",
    date: "",
    author: "GTR",
    created: 0,
    updated: 0,
    graph: structuredClone(graph),
    brief: {},
  }));

const defaultShared = (): Shared => ({
  events: seedEvents(),
  drafts: seedDrafts(),
  lineup: [],
  requests: [],
});

// Миграция: в старом формате граф лежал в graphs[venueId]. Переносим каждый
// в отдельное событие, чтобы уже собранное у пользователя не потерялось.
const migrateGraphs = (graphs: Record<string, Graph>): EventDraft[] =>
  Object.entries(graphs).map(([venueId, graph], i) => ({
    id: `EV-mig-${i + 1}`,
    venueId,
    title: "",
    format: "Перенесено из старой версии",
    guests: "",
    date: "",
    author: "GTR",
    created: 0,
    updated: 0,
    graph,
    brief: {},
  }));

const load = (): Shared => {
  if (typeof window === "undefined") return defaultShared();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaultShared();
    const parsed = JSON.parse(raw) as Partial<Shared> & { graphs?: Record<string, Graph> };
    const base = defaultShared();
    const drafts = Array.isArray(parsed.drafts)
      ? (parsed.drafts as EventDraft[])
      : parsed.graphs
        ? migrateGraphs(parsed.graphs)
        : base.drafts;
    return {
      events: Array.isArray(parsed.events) ? (parsed.events as CalEvent[]) : base.events,
      drafts,
      lineup: Array.isArray(parsed.lineup) ? (parsed.lineup as string[]) : [],
      requests: Array.isArray(parsed.requests) ? (parsed.requests as OrgRequest[]) : [],
    };
  } catch {
    return defaultShared();
  }
};

const Ctx = createContext<GtrStore | null>(null);

export function GtrProvider({ user, children }: { user: SessionUser; children: ReactNode }) {
  const [shared, setShared] = useState<Shared>(defaultShared);
  const [peers, setPeers] = useState<Peer[]>([]);
  const chRef = useRef<BroadcastChannel | null>(null);
  const tabId = useRef(`${Math.random().toString(36).slice(2, 9)}`);

  // hydrate после маунта (SSR-безопасно)
  useEffect(() => {
    setShared(load());
  }, []);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(CH);
    chRef.current = ch;
    ch.onmessage = (e: MessageEvent) => {
      const msg = e.data as
        | { t: "state"; shared: Shared }
        | { t: "hello" | "ping"; peer: Peer }
        | { t: "bye"; id: string };
      if (msg.t === "state") setShared(msg.shared);
      else if (msg.t === "hello" || msg.t === "ping") {
        setPeers((ps) => {
          const rest = ps.filter((p) => p.id !== msg.peer.id);
          return [...rest, msg.peer];
        });
        if (msg.t === "hello") ch.postMessage({ t: "ping", peer: mkPeer() });
      } else if (msg.t === "bye") setPeers((ps) => ps.filter((p) => p.id !== msg.id));
    };
    const mkPeer = (): Peer => ({
      id: tabId.current,
      name: user.name,
      roleLabel: user.roleLabel,
      initials: user.initials,
      ts: Date.now(),
    });
    ch.postMessage({ t: "hello", peer: mkPeer() });
    const iv = setInterval(() => {
      ch.postMessage({ t: "ping", peer: mkPeer() });
      setPeers((ps) => ps.filter((p) => Date.now() - p.ts < 12_000));
    }, 5_000);
    const bye = () => ch.postMessage({ t: "bye", id: tabId.current });
    window.addEventListener("beforeunload", bye);
    return () => {
      bye();
      clearInterval(iv);
      window.removeEventListener("beforeunload", bye);
      ch.close();
    };
  }, [user]);

  const commit = useCallback((next: Shared) => {
    setShared(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // квота localStorage — некритично для MVP
    }
    chRef.current?.postMessage({ t: "state", shared: next });
  }, []);

  const value = useMemo<GtrStore>(
    () => ({
      user,
      shared,
      peers,
      setEvents: (fn) => commit({ ...shared, events: fn(shared.events) }),
      setLineup: (fn) => commit({ ...shared, lineup: fn(shared.lineup) }),

      drafts: shared.drafts,
      draftOf: (id) => shared.drafts.find((d) => d.id === id),
      draftsOf: (venueId) =>
        shared.drafts.filter((d) => d.venueId === venueId).sort((a, b) => b.updated - a.updated),

      // Новое событие: граф либо передан (сценарий-пресет), либо собирается
      // из базы площадки — площадка, залы, слот.
      createDraft: (init) => {
        const id = init.id ?? mkId();
        const now = Date.now();
        const draft: EventDraft = {
          id,
          venueId: init.venueId,
          title: init.title ?? "",
          format: init.format ?? "",
          guests: init.guests ?? "",
          date: init.date ?? "",
          author: init.author ?? user.roleLabel,
          created: now,
          updated: now,
          graph: init.graph ?? venueGraph(init.venueId),
          brief: init.brief ?? {},
        };
        commit({ ...shared, drafts: [draft, ...shared.drafts] });
        return id;
      },
      updateDraft: (id, patch) =>
        commit({
          ...shared,
          drafts: shared.drafts.map((d) =>
            d.id === id ? { ...d, ...patch, updated: Date.now() } : d,
          ),
        }),
      setDraftGraph: (id, fn) =>
        commit({
          ...shared,
          drafts: shared.drafts.map((d) =>
            d.id === id ? { ...d, graph: fn(d.graph), updated: Date.now() } : d,
          ),
        }),
      deleteDraft: (id) =>
        commit({ ...shared, drafts: shared.drafts.filter((d) => d.id !== id) }),

      addRequest: (req) => commit({ ...shared, requests: [req, ...shared.requests] }),
      updateRequest: (id, patch) =>
        commit({
          ...shared,
          requests: shared.requests.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        }),
    }),
    [user, shared, peers, commit],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useGtr = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useGtr вне GtrProvider");
  return v;
};
