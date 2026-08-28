// Письма площадкам.
//
// Текст продажи стареет молча: цифры в нём были вписаны строкой — «110
// площадок», «312 артистов», — база выросла до 354 в шести регионах, а
// письма продолжали называть старое число и занижали нас же втрое по
// географии. Тест держит то, без чего письмо не работает: живые цифры,
// английский в первом касании, голосовой помощник, языки, ссылку на
// карточку и предложение созвона.
import { describe, expect, it } from "vitest";

import {
  callScript,
  msgFirstEn,
  msgFirstRu,
  msgFollowUp,
  msgInstagram,
  type Pitch,
} from "../data/outreach";
import { plural } from "../plural";

const m = { name: "Anna Kim", phone: "+66 61 234 5678", tg: "@gtr_anna" };
const pitch: Pitch = {
  scale: { venues: 354, artists: 312, regions: 6 },
  link: "https://gtrevent.com/gtr/v?t=abc123",
};
const venue = "Illuzion Phuket";

describe("первое письмо", () => {
  const en = msgFirstEn(m, venue, pitch);

  it("написано по-английски", () => {
    // На Пхукете управляющий чаще тайский или интернациональный: русское
    // письмо от незнакомого человека он просто не открывает.
    expect(/[а-яё]/i.test(en)).toBe(false);
  });

  it("называет живые цифры, а не вчерашние", () => {
    expect(en).toContain("354 venues");
    expect(en).toContain("6 regions");
    expect(en).toContain("312 artists");
    // Старые числа не должны всплыть ни в одном шаблоне.
    expect(en).not.toContain("110 venues");
  });

  it("рассказывает про голосового помощника и языки", () => {
    expect(en.toLowerCase()).toContain("voice assistant");
    expect(en).toContain("English, Russian and Thai");
  });

  it("даёт ссылку на карточку и предлагает звонок", () => {
    expect(en).toContain(pitch.link!);
    expect(en.toLowerCase()).toContain("call");
  });
});

describe("русская версия", () => {
  const ru = msgFirstRu(m, venue, pitch);

  it("склоняет числа по правилу", () => {
    expect(ru).toContain("354 площадки");
    expect(ru).not.toContain("354 площадок");
    expect(plural(11, "площадка", "площадки", "площадок")).toBe("площадок");
  });

  it("несёт те же четыре довода", () => {
    expect(ru).toContain("Голосовой помощник");
    expect(ru).toContain("языкового барьера");
    expect(ru).toContain(pitch.link!);
    expect(ru).toContain("созвонимся");
  });
});

describe("остальные касания", () => {
  it("директ короткий и без ссылки — со ссылкой чаще уходит в спам", () => {
    const ig = msgInstagram(m, venue, pitch);
    expect(ig.length).toBeLessThan(420);
    expect(ig).not.toContain("https://");
    expect(ig.toLowerCase()).toContain("call");
  });

  it("напоминание не слипается в стену текста", () => {
    const f = msgFollowUp(m, venue, pitch);
    expect(f).toContain("\n\n");
    expect(f).toContain(pitch.link!);
  });

  it("без ссылки письма остаются целыми", () => {
    // Приглашение может быть ещё не создано — письмо обязано читаться и так.
    const bare: Pitch = { scale: pitch.scale };
    for (const f of [msgFirstEn, msgFirstRu, msgFollowUp])
      expect(f(m, venue, bare)).not.toContain("undefined");
    expect(msgFollowUp(m, venue, bare)).not.toMatch(/\n\n\n/);
  });

  it("скрипт звонка проговаривает помощника и языки отдельными шагами", () => {
    const steps = callScript(m, venue, pitch);
    const all = steps.map((s) => `${s.step} ${s.text}`).join(" ");
    expect(all).toContain("Голосовой помощник");
    expect(all).toContain("тайском");
    expect(all).toContain(pitch.link!);
  });
});
