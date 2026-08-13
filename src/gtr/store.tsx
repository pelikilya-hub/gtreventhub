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
  type Offer,
  type OrgRequest,
} from "./data/app-data";
import { deleteDraftKvFn, pullOffersFn, pullSharedFn, pushDraftFn, pushRequestFn } from "./kv-api";

type Shared = {
  events: CalEvent[];
  drafts: EventDraft[]; // события конструктора
  lineup: string[];
  requests: OrgRequest[];
  offers: Offer[]; // предложения артистам
};

export type Peer = { id: string; name: string; roleLabel: string; initials: string; ts: number };

type GtrStore = {
  user: SessionUser;
  shared: Shared;
  peers: Peer[];
  setEvents: (fn: (list: CalEvent[]) => CalEvent[]) => void;
  setLineup: (fn: (ids: string[]) => string[]) => void;
  addRequest: (req: OrgRequest) => void;
  applyOffer: (offer: Offer) => void; // upsert после send/decide
  updateRequest: (id: string, patch: Partial<OrgRequest>) => void;
  // события конструктора
  drafts: EventDraft[];
  myDrafts: EventDraft[]; // личный кабинет: свои события (админ GTR видит все)
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
  offers: [],
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
      offers: Array.isArray(parsed.offers) ? (parsed.offers as Offer[]) : [],
    };
  } catch {
    return defaultShared();
  }
};

const Ctx = createContext<GtrStore | null>(null);

export function GtrProvider({ user, children }: { user: SessionUser; children: ReactNode }) {
  const [shared, setShared] = useState<Shared>(defaultShared);
  // Команда: чьи события видит кабинет (тимлид + участники, с сервера)
  const [teamOwners, setTeamOwners] = useState<string[]>([]);
  const [peers, setPeers] = useState<Peer[]>([]);
  const chRef = useRef<BroadcastChannel | null>(null);
  const tabId = useRef(`${Math.random().toString(36).slice(2, 9)}`);

  // hydrate после маунта (SSR-безопасно)
  useEffect(() => {
    setShared(load());
  }, []);

  // Синхронизация с общей базой (Workers KV): подтягиваем события и заявки
  // кабинета при входе, затем фоном. Слияние — last-write-wins по updated/ts,
  // локальные несохранённые записи не теряются.
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const [remote, remoteOffers] = await Promise.all([
          pullSharedFn(),
          pullOffersFn().catch(() => null),
        ]);
        if (!remote || !alive) return;
        if (Array.isArray((remote as { owners?: string[] }).owners))
          setTeamOwners((remote as { owners: string[] }).owners);
        setShared((cur) => {
          const byId = new Map(cur.drafts.map((d) => [d.id, d]));
          for (const rd of remote.drafts) {
            const loc = byId.get(rd.id);
            if (!loc || (rd.updated ?? 0) >= (loc.updated ?? 0)) byId.set(rd.id, rd);
          }
          const reqById = new Map(cur.requests.map((r) => [r.id, r]));
          for (const rr of remote.requests) {
            const loc = reqById.get(rr.id);
            if (!loc || (rr.ts ?? 0) >= (loc.ts ?? 0)) reqById.set(rr.id, rr);
          }
          const offById = new Map(cur.offers.map((o) => [o.id, o]));
          for (const ro of remoteOffers?.offers ?? []) {
            const loc = offById.get(ro.id);
            if (!loc || (ro.decidedTs ?? ro.ts) >= (loc.decidedTs ?? loc.ts)) offById.set(ro.id, ro);
          }
          const next = {
            ...cur,
            drafts: [...byId.values()].sort((a, b) => b.updated - a.updated),
            requests: [...reqById.values()].sort((a, b) => b.ts - a.ts),
            offers: [...offById.values()].sort((a, b) => b.ts - a.ts),
          };
          try {
            window.localStorage.setItem(KEY, JSON.stringify(next));
          } catch {
            /* квота */
          }
          return next;
        });
      } catch {
        /* сеть/локальный режим — молча работаем на localStorage */
      }
    };
    pull();
    const iv = setInterval(pull, 45_000);
    const onFocus = () => pull();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      clearInterval(iv);
      window.removeEventListener("focus", onFocus);
    };
  }, [user]);

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
      // Скоуп кабинета: менеджер видит только созданное им; события без
      // владельца (старые и засеянные) остаются видимыми по площадке роли.
      myDrafts:
        user.role === "gtr"
          ? shared.drafts
          : shared.drafts.filter((d) =>
              d.owner
                ? d.owner === user.email ||
                  d.owner === user.teamOf ||
                  teamOwners.includes(d.owner)
                : Boolean(user.venueId) && d.venueId === user.venueId,
            ),
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
          dateIso: init.dateIso ?? "",
          author: init.author ?? user.name,
          owner: init.owner ?? user.email, // личный кабинет: событие принадлежит создателю
          created: now,
          updated: now,
          graph: init.graph ?? venueGraph(init.venueId),
          brief: init.brief ?? {},
        };
        commit({ ...shared, drafts: [draft, ...shared.drafts] });
        pushDraftFn({ data: draft }).catch(() => {});
        return id;
      },
      updateDraft: (id, patch) => {
        const next = shared.drafts.map((d) =>
          d.id === id ? { ...d, ...patch, updated: Date.now() } : d,
        );
        commit({ ...shared, drafts: next });
        const changed = next.find((d) => d.id === id);
        if (changed) pushDraftFn({ data: changed }).catch(() => {});
      },
      setDraftGraph: (id, fn) => {
        const next = shared.drafts.map((d) =>
          d.id === id ? { ...d, graph: fn(d.graph), updated: Date.now() } : d,
        );
        commit({ ...shared, drafts: next });
        const changed = next.find((d) => d.id === id);
        if (changed) pushDraftFn({ data: changed }).catch(() => {});
      },
      deleteDraft: (id) => {
        commit({ ...shared, drafts: shared.drafts.filter((d) => d.id !== id) });
        deleteDraftKvFn({ data: { id } }).catch(() => {});
      },

      addRequest: (req) => {
        commit({ ...shared, requests: [req, ...shared.requests] });
        pushRequestFn({ data: req }).catch(() => {});
      },
      applyOffer: (offer) =>
        commit({
          ...shared,
          offers: [offer, ...shared.offers.filter((o) => o.id !== offer.id)],
        }),
      updateRequest: (id, patch) => {
        const next = shared.requests.map((r) => (r.id === id ? { ...r, ...patch } : r));
        commit({ ...shared, requests: next });
        const changed = next.find((r) => r.id === id);
        if (changed) pushRequestFn({ data: changed }).catch(() => {});
      },
    }),
    [user, shared, peers, teamOwners, commit],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useGtr = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useGtr вне GtrProvider");
  return v;
};
