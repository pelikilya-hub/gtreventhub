// Делает список участников с кодами входа.
//   node scripts/gen-members.mjs Ева Мия Лёва …   (первое имя — хозяйка)
// Печатает JSON для секрета MEMBERS и сохраняет его в members.json (в git не попадает).
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const COLORS = ["#FFE14D", "#FF9A8F", "#FFB65C", "#7EDC9C", "#8CC4FF", "#C9A8FF", "#FF9AD5", "#7FE3E0", "#C8E86B"];
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // без похожих 0/O, 1/I/L
const names = process.argv.slice(2);
if (names.length === 0) {
  console.error("Укажи имена: node scripts/gen-members.mjs Ева Мия Лёва …");
  process.exit(1);
}
const code = () => [...randomBytes(10)].map((b) => ALPHABET[b % ALPHABET.length]).join("");
const list = names.map((name, i) => ({
  id: `m${i + 1}`,
  name,
  color: COLORS[i % COLORS.length],
  ...(i === 0 ? { owner: true } : {}),
  token: code(),
}));
writeFileSync("members.json", JSON.stringify(list));
for (const m of list) console.log(`${m.name.padEnd(12)} ${m.token}${m.owner ? "  (хозяйка)" : ""}`);
console.log("\nСохранено в members.json. Залить на сервер:\n  npx wrangler secret put MEMBERS < members.json");
