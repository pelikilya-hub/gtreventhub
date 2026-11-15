// Дымовой тест на живом `wrangler dev`: BASE=http://127.0.0.1:8787 node test/smoke.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const BASE = process.env.BASE || "http://127.0.0.1:8787";
const list = JSON.parse(readFileSync("members.json", "utf8"));
const [eva, mia] = list;

function connect(m) {
  const ws = new WebSocket(`${BASE.replace("http", "ws")}/ws?token=${m.token}`);
  const inbox = [];
  const waiters = [];
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    const i = waiters.findIndex((w) => w.test(msg));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else inbox.push(msg);
  };
  const next = (test, ms = 3000) =>
    new Promise((resolve, reject) => {
      const i = inbox.findIndex(test);
      if (i >= 0) return resolve(inbox.splice(i, 1)[0]);
      waiters.push({ test, resolve });
      setTimeout(() => reject(new Error("timeout: " + test)), ms);
    });
  const silent = async (test, ms = 400) => {
    await new Promise((r) => setTimeout(r, ms));
    assert.equal(inbox.findIndex(test), -1, "не должно было прийти: " + test);
  };
  return { ws, next, silent, send: (o) => ws.send(JSON.stringify(o)) };
}

assert.equal((await fetch(`${BASE}/me`)).status, 401, "без кода не пускаем");
assert.equal((await fetch(`${BASE}/me?token=nope`)).status, 401);
const me = await (await fetch(`${BASE}/me`, { headers: { authorization: `Bearer ${eva.token}` } })).json();
assert.equal(me.me.name, "Ева");
assert.equal(me.members.length, 9);
assert.ok(!JSON.stringify(me).includes(mia.token), "чужие коды наружу не уходят");

const a = connect(eva);
const helloA = await a.next((m) => m.t === "hello");
assert.equal(helloA.me.owner, true);
const b = connect(mia);
const helloB = await b.next((m) => m.t === "hello");
assert.deepEqual(helloB.online.sort(), ["m1", "m2"]);
await a.next((m) => m.t === "presence" && m.online.includes("m2"));

// чат
b.send({ t: "msg", kind: "text", text: "  Привет!  " });
const got = await a.next((m) => m.t === "msg");
assert.equal(got.m.text, "Привет!");
assert.equal(got.m.member, "m2");
await b.next((m) => m.t === "msg" && m.m.id === got.m.id);
b.send({ t: "msg", kind: "text", text: "   " });
b.send({ t: "msg", kind: "hack", text: "x" });
await a.silent((m) => m.t === "msg");

// рисунок
const stroke = { id: "s-" + Date.now(), color: "#2D7FF9", width: 0.02, points: [[0.1, 0.1], [0.5, 0.52345678]] };
b.send({ t: "draw", s: stroke });
await a.next((m) => m.t === "draw" && m.s.member === "m2");
b.send({ t: "stroke", s: stroke });
const st = await a.next((m) => m.t === "stroke");
assert.deepEqual(st.s.points[1], [0.5, 0.5235]);
b.send({ t: "stroke", s: { ...stroke, id: "bad", color: "red" } });
await a.silent((m) => m.t === "stroke");

// чужой штрих отменить нельзя, свой — можно
a.send({ t: "undo", id: stroke.id });
await a.next((m) => m.t === "undo");
const c = connect(eva);
const helloC = await c.next((m) => m.t === "hello");
assert.ok(helloC.strokes.some((s) => s.id === stroke.id), "штрих пережил чужую отмену и сохранился");
assert.ok(helloC.messages.some((m) => m.text === "Привет!"), "история приходит новому соединению");

// чистый лист — только хозяйка
b.send({ t: "clear" });
await a.silent((m) => m.t === "clear");
a.send({ t: "clear" });
await b.next((m) => m.t === "clear");

// загрузка картинки
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const up = await fetch(`${BASE}/upload`, { method: "POST", headers: { authorization: `Bearer ${mia.token}`, "content-type": "image/png" }, body: png });
const { media } = await up.json();
assert.match(media, /^u\/m2\/.+\.png$/);
const back = await fetch(`${BASE}/media/${media}?token=${eva.token}`);
assert.equal(back.headers.get("content-type"), "image/png");
assert.equal((await back.arrayBuffer()).byteLength, png.length);
assert.equal((await fetch(`${BASE}/media/${media}`)).status, 401);
assert.equal((await fetch(`${BASE}/upload`, { method: "POST", headers: { authorization: `Bearer ${mia.token}`, "content-type": "text/html" }, body: "<b>" })).status, 415);

// уход из сети
b.ws.close();
await a.next((m) => m.t === "presence" && !m.online.includes("m2"));

// без ключа OpenAI «чудо» честно говорит, что выключено
const magic = await fetch(`${BASE}/magic`, { method: "POST", headers: { authorization: `Bearer ${eva.token}`, "content-type": "application/json" }, body: JSON.stringify({ kind: "mask", prompt: "дракон" }) });
assert.equal(magic.status, 503);

a.ws.close();
c.ws.close();
console.log("ok: вход, чат, рисунок, отмена, чистый лист, картинки, присутствие");
