// Слух вайб-чека: ответ модели проходит только через словарь genres.json.
// Выдуманный жанр, кривой JSON, дикий bpm — всё отбрасывается, клиент
// остаётся с локальной прикидкой, а не с мусором на экране.
import { describe, expect, it } from "vitest";

import { genreIdList, parseVibeReply, resolveGenre } from "../vibe-parse";

describe("resolveGenre", () => {
  it("находит жанр по точному id", () => {
    expect(resolveGenre("deep-house")?.ru).toBe("дип-хаус");
  });

  it("находит жанр по алиасу с пробелом и по-русски", () => {
    expect(resolveGenre("deep house")?.id).toBe("deep-house");
    expect(resolveGenre("дип-хаус")?.id).toBe("deep-house");
  });

  it("выдуманный жанр не проходит", () => {
    expect(resolveGenre("mega-super-core")).toBeNull();
    expect(resolveGenre("")).toBeNull();
  });
});

describe("parseVibeReply", () => {
  it("разбирает чистый JSON-ответ", () => {
    const g = parseVibeReply('{"genre":"melodic-techno","bpm":124}');
    expect(g?.genreId).toBe("melodic-techno");
    expect(g?.bpm).toBe(124);
    expect(g?.ru.length).toBeGreaterThan(0);
  });

  it("вытаскивает JSON из болтовни вокруг и кодфенсов", () => {
    const g = parseVibeReply('Вот ответ:\n```json\n{"genre":"psytrance","bpm":145}\n```\nГотово!');
    expect(g?.genreId).toBe("psytrance");
  });

  it("неизвестный жанр — null, а не подмена", () => {
    expect(parseVibeReply('{"genre":"vibe-of-the-night","bpm":120}')).toBeNull();
  });

  it("дикий bpm обнуляется, жанр остаётся", () => {
    const g = parseVibeReply('{"genre":"dub-techno","bpm":999}');
    expect(g?.genreId).toBe("dub-techno");
    expect(g?.bpm).toBeNull();
  });

  it("кривой текст без JSON — null", () => {
    expect(parseVibeReply("не смог определить")).toBeNull();
  });
});

describe("genreIdList", () => {
  it("список для промпта не пуст и состоит из известных id", () => {
    const ids = genreIdList();
    expect(ids.length).toBeGreaterThan(200);
    expect(ids).toContain("deep-house");
  });
});
