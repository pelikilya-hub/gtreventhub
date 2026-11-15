// «Моя радуга» — чат, общий рисунок и «чудеса» для девяти человек.
//
// Всё состояние живёт в одном Durable Object (Room): сообщения и штрихи —
// в его SQLite, картинки — в R2. Realtime — WebSocket с гибернацией, так что
// пока все молчат, воркер ничего не стоит.

export interface Env {
  ROOM: DurableObjectNamespace;
  MEDIA: R2Bucket;
  MEMBERS: string; // JSON: Member[] вместе с token
  OPENAI_API_KEY?: string;
  MAGIC_DAILY_LIMIT?: string;
}

interface Member {
  id: string;
  name: string;
  color: string;
  owner?: boolean;
  token: string;
}
type PublicMember = Omit<Member, "token">;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

function members(env: Env): Member[] {
  try {
    const list = JSON.parse(env.MEMBERS || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
const pub = ({ token: _t, ...m }: Member): PublicMember => m;

// Сравнение без утечки по времени: коды короткие, участников девять.
function sameToken(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function whoIs(req: Request, env: Env): Member | null {
  const url = new URL(req.url);
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : url.searchParams.get("token") || "";
  if (!token) return null;
  return members(env).find((m) => sameToken(m.token, token)) ?? null;
}

const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg" };
const MAX_UPLOAD = 6 * 1024 * 1024;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/") return new Response("Моя радуга");

    const me = whoIs(req, env);
    if (!me) return json({ error: "unauthorized" }, 401);

    if (url.pathname === "/me") {
      return json({ me: pub(me), members: members(env).map(pub) });
    }

    if (url.pathname === "/upload" && req.method === "POST") {
      const type = (req.headers.get("content-type") || "").split(";")[0].trim();
      const ext = IMAGE_TYPES[type];
      if (!ext) return json({ error: "bad_type" }, 415);
      const body = await req.arrayBuffer();
      if (body.byteLength === 0 || body.byteLength > MAX_UPLOAD) return json({ error: "bad_size" }, 413);
      const key = `u/${me.id}/${crypto.randomUUID()}.${ext}`;
      await env.MEDIA.put(key, body, { httpMetadata: { contentType: type } });
      return json({ media: key });
    }

    if (url.pathname.startsWith("/media/") && req.method === "GET") {
      const key = decodeURIComponent(url.pathname.slice("/media/".length));
      const obj = await env.MEDIA.get(key);
      if (!obj) return json({ error: "not_found" }, 404);
      return new Response(obj.body, {
        headers: {
          "content-type": obj.httpMetadata?.contentType || "application/octet-stream",
          "cache-control": "private, max-age=31536000, immutable",
        },
      });
    }

    if (url.pathname === "/ws" || url.pathname === "/magic") {
      const stub = env.ROOM.get(env.ROOM.idFromName("raduga"));
      const headers = new Headers(req.headers);
      headers.set("x-member", me.id);
      return stub.fetch(new Request(req, { headers }));
    }

    return json({ error: "not_found" }, 404);
  },
};

// ---------------------------------------------------------------------------

const MSG_KINDS = new Set(["text", "image", "drawing", "sticker", "mask"]);
const HISTORY = 100;
const MAX_TEXT = 1000;
const MAX_POINTS = 2000;
const MAX_STROKES = 5000;

const MAGIC_STYLE: Record<string, string> = {
  mask:
    "Карнавальная маска для лица ребёнка, вид строго спереди, симметричная, " +
    "с вырезами для глаз, плоская яркая иллюстрация с толстым тёмным контуром как фломастером, " +
    "прозрачный фон, без текста.",
  sticker:
    "Детская наклейка: один персонаж или предмет по центру, плоская яркая иллюстрация " +
    "с толстым тёмным контуром как фломастером и белой обводкой, прозрачный фон, без текста.",
  coloring:
    "Страница детской раскраски: только чёткие чёрные контуры на чисто белом фоне, " +
    "крупные простые формы, без заливки, без теней, без текста.",
};

export class Room implements DurableObject {
  private sql: SqlStorage;

  constructor(private ctx: DurableObjectState, private env: Env) {
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member TEXT NOT NULL, kind TEXT NOT NULL,
        text TEXT, media TEXT, ts INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS strokes (
        id TEXT PRIMARY KEY, member TEXT NOT NULL,
        color TEXT NOT NULL, width REAL NOT NULL,
        points TEXT NOT NULL, ts INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS magic_usage (
        member TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL,
        PRIMARY KEY (member, day));
    `);
  }

  private member(id: string | null): Member | null {
    return members(this.env).find((m) => m.id === id) ?? null;
  }

  private online(except?: WebSocket): string[] {
    const ids = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const id = (ws.deserializeAttachment() as { id?: string } | null)?.id;
      if (id) ids.add(id);
    }
    return [...ids];
  }

  private broadcast(data: unknown, except?: WebSocket) {
    const text = JSON.stringify(data);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(text);
      } catch {
        // сокет уже закрывается — webSocketClose разошлёт присутствие
      }
    }
  }

  private history() {
    const rows = this.sql
      .exec("SELECT id, member, kind, text, media, ts FROM messages ORDER BY id DESC LIMIT ?", HISTORY)
      .toArray();
    return rows.reverse();
  }

  private strokes() {
    return this.sql
      .exec("SELECT id, member, color, width, points FROM strokes ORDER BY ts, rowid")
      .toArray()
      .map((r) => ({ ...r, points: JSON.parse(r.points as string) }));
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const me = this.member(req.headers.get("x-member"));
    if (!me) return json({ error: "unauthorized" }, 401);

    if (url.pathname === "/magic" && req.method === "POST") return this.magic(req, me);

    if (req.headers.get("upgrade") !== "websocket") return json({ error: "expected_websocket" }, 426);
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ id: me.id });
    pair[1].send(
      JSON.stringify({
        t: "hello",
        me: pub(me),
        members: members(this.env).map(pub),
        online: this.online(),
        messages: this.history(),
        strokes: this.strokes(),
      }),
    );
    this.broadcast({ t: "presence", online: this.online() }, pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== "string" || raw.length > 200_000) return;
    const id = (ws.deserializeAttachment() as { id?: string } | null)?.id;
    const me = this.member(id ?? null);
    if (!me) return ws.close(4001, "unauthorized");
    let m: any;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }

    switch (m?.t) {
      case "ping":
        ws.send('{"t":"pong"}');
        return;

      case "msg": {
        if (!MSG_KINDS.has(m.kind)) return;
        const text = typeof m.text === "string" ? m.text.trim().slice(0, MAX_TEXT) : "";
        const media = typeof m.media === "string" && /^[\w/.-]{1,200}$/.test(m.media) ? m.media : null;
        if (!text && !media) return;
        const ts = Date.now();
        const row = this.sql
          .exec(
            "INSERT INTO messages (member, kind, text, media, ts) VALUES (?, ?, ?, ?, ?) RETURNING id",
            me.id, m.kind, text, media, ts,
          )
          .one();
        this.broadcast({ t: "msg", m: { id: row.id, member: me.id, kind: m.kind, text, media, ts } });
        return;
      }

      case "typing":
        this.broadcast({ t: "typing", member: me.id }, ws);
        return;

      // Пока палец на экране: точки летят остальным, но в базу не пишутся.
      case "draw": {
        const s = cleanStroke(m.s);
        if (s) this.broadcast({ t: "draw", s: { ...s, member: me.id } }, ws);
        return;
      }

      // Палец поднят: штрих целиком сохраняется.
      case "stroke": {
        const s = cleanStroke(m.s);
        if (!s) return;
        const count = this.sql.exec("SELECT COUNT(*) AS n FROM strokes").one().n as number;
        if (count >= MAX_STROKES) return ws.send('{"t":"error","error":"board_full"}');
        this.sql.exec(
          "INSERT OR REPLACE INTO strokes (id, member, color, width, points, ts) VALUES (?, ?, ?, ?, ?, ?)",
          s.id, me.id, s.color, s.width, JSON.stringify(s.points), Date.now(),
        );
        this.broadcast({ t: "stroke", s: { ...s, member: me.id } }, ws);
        return;
      }

      // Отменить можно только свой штрих.
      case "undo": {
        if (typeof m.id !== "string") return;
        this.sql.exec("DELETE FROM strokes WHERE id = ? AND member = ?", m.id, me.id);
        this.broadcast({ t: "undo", id: m.id, member: me.id });
        return;
      }

      // Чистый лист — только хозяйка.
      case "clear":
        if (!me.owner) return;
        this.sql.exec("DELETE FROM strokes");
        this.broadcast({ t: "clear" });
        return;

      case "cursor":
        if (typeof m.x === "number" && typeof m.y === "number") {
          this.broadcast({ t: "cursor", member: me.id, x: m.x, y: m.y }, ws);
        }
        return;
    }
  }

  async webSocketClose(ws: WebSocket) {
    try {
      ws.close();
    } catch {
      // уже закрыт
    }
    const online = this.online(ws);
    this.broadcast({ t: "presence", online }, ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }

  // --- «Чудо»: картинка по описанию -------------------------------------

  private async magic(req: Request, me: Member): Promise<Response> {
    if (!this.env.OPENAI_API_KEY) return json({ error: "magic_off" }, 503);
    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ error: "bad_json" }, 400);
    }
    const kind = typeof body?.kind === "string" && MAGIC_STYLE[body.kind] ? body.kind : "sticker";
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, 300) : "";
    if (prompt.length < 2) return json({ error: "empty" }, 400);

    const limit = Number(this.env.MAGIC_DAILY_LIMIT || 10);
    const day = new Date().toISOString().slice(0, 10);
    const used =
      (this.sql.exec("SELECT count FROM magic_usage WHERE member = ? AND day = ?", me.id, day).toArray()[0]
        ?.count as number) ?? 0;
    if (used >= limit) return json({ error: "limit", left: 0 }, 429);

    const auth = { authorization: `Bearer ${this.env.OPENAI_API_KEY}`, "content-type": "application/json" };

    // Сначала проверка самого желания: недобрые просьбы не рисуем вовсе.
    const mod = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ model: "omni-moderation-latest", input: prompt }),
    });
    if (!mod.ok) return json({ error: "magic_failed" }, 502);
    const verdict = (await mod.json()) as { results?: { flagged?: boolean }[] };
    if (verdict.results?.[0]?.flagged) return json({ error: "unkind", left: limit - used }, 422);

    const gen = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt:
          `${MAGIC_STYLE[kind]} Картинка для детей 5–10 лет: добрая, смешная, ничего страшного, ` +
          `никакого оружия и насилия. Что нарисовать: ${prompt}`,
        size: "1024x1024",
        quality: "low",
        background: kind === "coloring" ? "opaque" : "transparent",
        output_format: "png",
        n: 1,
      }),
    });
    if (!gen.ok) {
      // Отказ модели по содержанию приходит как 400 — для ребёнка это «не получилось».
      return json({ error: gen.status === 400 ? "unkind" : "magic_failed", left: limit - used }, gen.status === 400 ? 422 : 502);
    }
    const out = (await gen.json()) as { data?: { b64_json?: string }[] };
    const b64 = out.data?.[0]?.b64_json;
    if (!b64) return json({ error: "magic_failed" }, 502);

    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const key = `m/${me.id}/${crypto.randomUUID()}.png`;
    await this.env.MEDIA.put(key, bytes, {
      httpMetadata: { contentType: "image/png" },
      customMetadata: { kind, prompt: encodeURIComponent(prompt) },
    });
    this.sql.exec(
      "INSERT INTO magic_usage (member, day, count) VALUES (?, ?, 1) ON CONFLICT (member, day) DO UPDATE SET count = count + 1",
      me.id, day,
    );
    return json({ media: key, kind, left: limit - used - 1 });
  }
}

interface Stroke {
  id: string;
  color: string;
  width: number;
  points: number[][];
}

// Координаты — доли от стороны листа (0…1), чтобы рисунок совпадал на любом экране.
function cleanStroke(s: any): Stroke | null {
  if (!s || typeof s.id !== "string" || !/^[\w-]{1,64}$/.test(s.id)) return null;
  if (typeof s.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(s.color)) return null;
  const width = Number(s.width);
  if (!(width > 0 && width <= 0.2)) return null;
  if (!Array.isArray(s.points) || s.points.length === 0 || s.points.length > MAX_POINTS) return null;
  const points: number[][] = [];
  for (const p of s.points) {
    if (!Array.isArray(p) || p.length !== 2) return null;
    const [x, y] = p;
    if (typeof x !== "number" || typeof y !== "number" || !isFinite(x) || !isFinite(y)) return null;
    points.push([Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]);
  }
  return { id: s.id, color: s.color, width, points };
}
