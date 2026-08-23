import { describe, expect, it } from "vitest";

import { diffChecks, smokeText, type Check } from "../selfcheck";

const ok = (id: string): Check => ({ id, ok: true, note: "ок" });
const bad = (id: string, note = "мимо"): Check => ({ id, ok: false, note });

describe("дымовая проверка", () => {
  it("первый прогон на здоровом проде молчит", () => {
    const d = diffChecks(null, [ok("kv"), ok("qa")]);
    expect(d.broke).toEqual([]);
    expect(d.fixed).toEqual([]);
  });

  it("первая поломка — тревога", () => {
    const d = diffChecks({ at: 1, bad: [] }, [ok("kv"), bad("qa")]);
    expect(d.broke).toEqual(["qa"]);
  });

  it("пока лежит — молчит: повтор одного и того же учит не читать", () => {
    const d = diffChecks({ at: 1, bad: ["qa"] }, [ok("kv"), bad("qa")]);
    expect(d.broke).toEqual([]);
    expect(d.fixed).toEqual([]);
  });

  it("починилось — тоже событие: молчание после тревоги читается как «всё ещё лежит»", () => {
    const d = diffChecks({ at: 1, bad: ["qa"] }, [ok("kv"), ok("qa")]);
    expect(d.fixed).toEqual(["qa"]);
  });

  it("одна поломка сменилась другой — это событие, хотя число прежнее", () => {
    const d = diffChecks({ at: 1, bad: ["qa"] }, [bad("afisha"), ok("qa")]);
    expect(d.broke).toEqual(["afisha"]);
    expect(d.fixed).toEqual(["qa"]);
  });

  it("исчезнувшая проверка не считается починенной", () => {
    // Проверку переименовали или убрали — это не победа над поломкой, и
    // говорить «починилось» было бы враньём.
    const d = diffChecks({ at: 1, bad: ["qa"] }, [ok("kv")]);
    expect(d.fixed).toEqual([]);
    expect(d.broke).toEqual([]);
  });

  it("текст тревоги называет, что именно сломалось", () => {
    const checks = [bad("qa", "0 из 3 канареек"), ok("kv")];
    const t = smokeText(diffChecks({ at: 1, bad: [] }, checks), checks);
    expect(t).toContain("qa");
    expect(t).toContain("0 из 3 канареек");
  });

  it("текст про возврат отделён от текста про поломку", () => {
    const checks = [ok("qa"), bad("afisha", "0 будущих событий")];
    const t = smokeText(diffChecks({ at: 1, bad: ["qa"] }, checks), checks);
    expect(t).toContain("Починилось: qa");
    expect(t).toContain("afisha");
  });
});
