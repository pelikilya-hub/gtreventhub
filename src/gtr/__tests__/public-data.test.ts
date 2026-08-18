// Разделение базы на публичную и рабочую часть — операция, где легко
// срезать лишнее: поле уходит из витрины, а экран продолжает его читать
// и падает целиком. Так и случилось с «достоверностью» в базе площадок.
//
// Тест держит обе границы сразу: приватное не должно утечь, публичное
// не должно пропасть.
import { describe, expect, it } from "vitest";

import venuesPub from "../data/venues.public.json";
import artistsPub from "../data/artists.public.json";

type Venue = Record<string, unknown> & { id: string; name: string };

const venues = (venuesPub as unknown as { venues: Venue[] }).venues;
const artists = (artistsPub as unknown as { artists: Record<string, unknown>[] }).artists;

describe("витрина площадок", () => {
  it("не теряет при разделении ни одного поля, которое читают экраны", async () => {
    // Сравниваем с полной базой, а не с жёстким списком: у части записей
    // поля пустуют в самом источнике, и это дырка в данных, а не потеря
    // при разделении. Проверяем именно перенос: есть в полной — обязано
    // быть в публичной.
    const full = (await import("../data/venues.json")) as unknown as {
      default?: { venues: Venue[] };
      venues?: Venue[];
    };
    const src = (full.default ?? full).venues!;
    const need = [
      "id", "name", "type", "tag", "area", "cluster", "district",
      "concept", "capacity", "music", "status", "confidence", "source",
    ];
    for (const v of src) {
      const pub = venues.find((x) => x.id === v.id);
      expect(pub, v.id).toBeDefined();
      for (const k of need)
        if (v[k] !== undefined) expect(pub![k], `${v.id}.${k}`).toBeDefined();
    }
  });

  it("не содержит контактов и внутренних заметок", () => {
    for (const v of venues)
      for (const k of ["phone", "email", "telegram", "notes"])
        expect(v[k], `${v.id}.${k}`).toBeUndefined();
  });

  it("контакты и разведка вырезаны целиком", () => {
    const d = venuesPub as unknown as { contacts: unknown[]; research: unknown[] };
    expect(d.contacts.length).toBe(0);
    expect(d.research.length).toBe(0);
  });
});

describe("витрина артистов", () => {
  it("несёт то, что показывает карточка", () => {
    for (const a of artists)
      for (const k of ["id", "name", "cat", "kind", "status"])
        expect(a[k], `${String(a.id)}.${k}`).toBeDefined();
  });

  it("не содержит контактов, райдеров и разведки", () => {
    for (const a of artists)
      for (const k of ["email", "phone", "wa", "mgmt", "person", "rider", "notes", "evidence"])
        expect(a[k], `${String(a.id)}.${k}`).toBeUndefined();
  });
});
