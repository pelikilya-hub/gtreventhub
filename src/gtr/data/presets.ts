// Сценарии-пресеты события: один клик собирает каркас — площадка, зал под
// вместимость, слот и блоки из готовых ответов брифа. Вайб выбирается при
// создании и тянет за собой музыкальные стили для подбора артистов.
import { freeGridCell, venueGraph, type Graph, type GraphNode } from "./app-data";
import { modulesFromBrief, vibeQuestionFor, type BriefAnswers } from "./brief";

export type EventPreset = {
  id: string;
  title: string;
  desc: string;
  format: string;
  targetCap: number; // под сколько гостей подбирать зал
  guests: string; // id варианта в вопросе guests
  time: [string, string];
  answers: BriefAnswers; // готовые ответы брифа — из них собираются блоки
};

export const EVENT_PRESETS: EventPreset[] = [
  {
    id: "club500",
    title: "Клубная ночь на 500",
    desc: "Привозной хедлайнер, билеты, полная сцена, охрана и согласование ночного слота",
    format: "Клубная ночь",
    targetCap: 500,
    guests: "l",
    time: ["22:00", "04:00"],
    answers: {
      daypart: ["night"],
      headliner: ["touring"],
      tickets: ["paid"],
      stage: ["fullstage"],
      media: ["photovideo"],
      fnb: ["bar"],
      security: ["door", "floor", "medic"],
      noise: ["need"],
    },
  },
  {
    id: "wed120",
    title: "Свадьба у моря на 120",
    desc: "Церемония на пляже, живая группа, арка и свет, банкет, съёмка с дроном",
    format: "Свадьба",
    targetCap: 120,
    guests: "m",
    time: ["16:00", "23:00"],
    answers: {
      daypart: ["evening"],
      ceremony: ["beach"],
      wed_music: ["band"],
      wed_decor: ["arch", "lightdeco"],
      media: ["drone"],
      fnb: ["banquet", "bar"],
    },
  },
  {
    id: "corp200",
    title: "Гала-корпоратив на 200",
    desc: "Круглые столы, LED и проектор, банкет с баром, фотограф и охрана",
    format: "Корпоратив",
    targetCap: 200,
    guests: "l",
    time: ["19:00", "23:00"],
    answers: {
      daypart: ["evening"],
      corp_format: ["gala"],
      seating: ["rounds"],
      av: ["projector", "led"],
      fnb: ["banquet", "bar"],
      media: ["photo"],
      security: ["door"],
    },
  },
  {
    id: "conf150",
    title: "Конференция на 150",
    desc: "Театр, проектор, синхроперевод и стриминг, кофе-брейки",
    format: "Конференция",
    targetCap: 150,
    guests: "m",
    time: ["09:00", "18:00"],
    answers: {
      daypart: ["day"],
      seating: ["theatre"],
      av: ["projector", "translation", "stream"],
      fnb: ["buffet"],
    },
  },
  {
    id: "villa50",
    title: "Приватный вечер на 50",
    desc: "DJ, бар и фуршет, фотограф — камерный формат без лишнего",
    format: "Частная вечеринка",
    targetCap: 50,
    guests: "s",
    time: ["18:00", "01:00"],
    answers: {
      daypart: ["evening"],
      party_music: ["dj"],
      fnb: ["bar", "buffet"],
      media: ["photo"],
    },
  },
  {
    id: "brand300",
    title: "Бренд-день на 300",
    desc: "Фотозона, интерактив и шоу, LED-экран, съёмка, охрана на входе",
    format: "Бренд-активация",
    targetCap: 300,
    guests: "l",
    time: ["12:00", "18:00"],
    answers: {
      daypart: ["day"],
      activation: ["photozone", "interactive", "show"],
      av: ["led"],
      media: ["photovideo"],
      fnb: ["buffet"],
      security: ["door"],
    },
  },
];

// Сколько блоков даст пресет (для карточки в создании) — без учёта вайба
export const presetBlockCount = (p: EventPreset): number =>
  modulesFromBrief(p.format, { ...p.answers, guests: [p.guests] }).length;

const capOf = (n: GraphNode) => parseInt(String(n.badge).replace(/\D/g, ""), 10) || 0;

// Каркас события по пресету: зал под вместимость, слот со временем пресета,
// блоки из ответов брифа. Вайб дописывается в ответы и даёт блок арт-дирекшна.
export const buildPresetDraft = (
  venueId: string,
  preset: EventPreset,
  vibeId: string,
): { graph: Graph; brief: BriefAnswers } => {
  const answers: BriefAnswers = { ...preset.answers, guests: [preset.guests] };
  const vq = vibeQuestionFor(preset.format);
  if (vq && vibeId) answers[vq.id] = [vibeId];

  const base = venueGraph(venueId);
  const rooms = base.nodes.filter((n) => n.kind === "room");
  // самый компактный зал, вмещающий гостей; нет такого — самый большой
  const fitting = rooms.filter((r) => capOf(r) >= preset.targetCap);
  const hall =
    fitting.slice().sort((a, b) => capOf(a) - capOf(b))[0] ??
    rooms.slice().sort((a, b) => capOf(b) - capOf(a))[0];

  const keep = new Set(
    base.nodes.filter((n) => n.kind !== "room" || n.id === hall?.id).map((n) => n.id),
  );
  let nodes = base.nodes.filter((n) => keep.has(n.id));
  const links = base.links.filter((l) => keep.has(l.from) && keep.has(l.to));

  const slotTitle = `Слот ${preset.time[0]}–${preset.time[1]}`;
  nodes = nodes.map((n) =>
    n.kind === "slot"
      ? {
          ...n,
          title: slotTitle,
          sub: "Дата уточняется",
          badge: preset.time[0],
          fields: n.fields.map((f): [string, string] => {
            if (f[0] === "ВРЕМЯ") return [f[0], `${preset.time[0]}–${preset.time[1]}`];
            if (f[0] === "ЗАЛ" && hall) return [f[0], hall.title];
            if (f[0] === "ДАТА") return [f[0], "—"];
            if (f[0] === "СТАТУС") return [f[0], "Черновик"];
            return f;
          }),
        }
      : n,
  );

  const venueNode = nodes.find((n) => n.kind === "venue");

  // Фильтр залов мог унести связь зал→слот вместе с отброшенным залом —
  // слот и вся его цепочка повисали без пути от площадки. Перевешиваем.
  const slotNode = nodes.find((n) => n.kind === "slot");
  if (slotNode && !links.some((l) => l.to === slotNode.id)) {
    const from = hall?.id ?? venueNode?.id;
    if (from) links.push({ from, to: slotNode.id });
  }

  modulesFromBrief(preset.format, answers).forEach((m, i) => {
    const { x, y } = freeGridCell(nodes);
    const id = `np${i}${Math.random().toString(36).slice(2, 6)}`;
    nodes.push({ id, kind: m.kind, x, y, title: m.title, sub: m.sub, badge: m.badge, fields: m.fields });
    if (venueNode) links.push({ from: venueNode.id, to: id });
  });

  return { graph: { nodes, links }, brief: answers };
};
