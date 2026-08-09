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
  type CalEvent,
  type Graph,
  type OrgRequest,
} from "./data/app-data";

type Shared = {
  events: CalEvent[];
  graphs: Record<string, Graph>;
  lineup: string[];
  requests: OrgRequest[];
};

export type Peer = { id: string; name: string; roleLabel: string; initials: string; ts: number };

type GtrStore = {
  user: SessionUser;
  shared: Shared;
  peers: Peer[];
  setEvents: (fn: (list: CalEvent[]) => CalEvent[]) => void;
  setGraph: (venueId: string, fn: (g: Graph) => Graph) => void;
  setLineup: (fn: (ids: string[]) => string[]) => void;
  graphOf: (venueId: string) => Graph;
  addRequest: (req: OrgRequest) => void;
  updateRequest: (id: string, patch: Partial<OrgRequest>) => void;
};

const KEY = "gtr-shared-v1";
const CH = "gtr-sync-v1";

const defaultShared = (): Shared => ({
  events: seedEvents(),
  graphs: structuredClone(GRAPH_SEED),
  lineup: [],
  requests: [],
});

const load = (): Shared => {
  if (typeof window === "undefined") return defaultShared();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaultShared();
    const parsed = JSON.parse(raw) as Partial<Shared>;
    const base = defaultShared();
    return {
      events: Array.isArray(parsed.events) ? (parsed.events as CalEvent[]) : base.events,
      graphs: { ...base.graphs, ...(parsed.graphs ?? {}) },
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
      setGraph: (venueId, fn) => {
        const g = shared.graphs[venueId] ?? { nodes: [], links: [] };
        commit({ ...shared, graphs: { ...shared.graphs, [venueId]: fn(g) } });
      },
      setLineup: (fn) => commit({ ...shared, lineup: fn(shared.lineup) }),
      graphOf: (venueId) => shared.graphs[venueId] ?? { nodes: [], links: [] },
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
