// Каталог команд — план, а не опись продукта.
//
// В нём 60 намерений, и часть ссылается на инструменты, которых ещё нет:
// покупка билетов, холд стола, приглашения друзьям, заказ транспорта.
// Отдать такой каталог модели значит научить её обещать несуществующее —
// поэтому в промпт он не уезжает. Но и лежать без присмотра ему нельзя:
// без проверки разрыв между планом и продуктом растёт молча.
//
// Здесь стоит храповик. Новая висячая ссылка ломает сборку сразу.
// Реализовали задуманное — уберите строку из PLANNED, и тест это
// потребует, а не смолчит.
import { describe, expect, it } from "vitest";

import catalog from "../command-catalog.json";
import { APP_ROUTES, TOOL_DEFS } from "../tools";

type Cmd = {
  id: string;
  group: string;
  intent: string;
  examples?: string[];
  execution: string;
  tool?: string;
  arguments?: Record<string, unknown>;
};

const commands = (catalog as { commands: Cmd[] }).commands;

/** Инструменты, задуманные, но ещё не построенные. */
const PLANNED = new Set([
  "get_friends_attending",
  "preview_transport",
  "preview_ticket_purchase",
  "start_ticket_checkout",
  "preview_table_booking",
  "create_table_hold",
  "preview_friend_invites",
  "send_friend_invites",
  "book_transport",
]);

/** Экраны, задуманные, но ещё не построенные. */
const PLANNED_ROUTES = new Set(["media", "navigation"]);

describe("каталог команд", () => {
  const toolNames = new Set<string>(TOOL_DEFS.map((d) => d.name));
  const routeIds = new Set<string>(APP_ROUTES.map((r) => r.id));

  it("каждая команда ссылается на существующий или явно запланированный инструмент", () => {
    const dangling = commands
      .filter((c) => c.tool && !toolNames.has(c.tool) && !PLANNED.has(c.tool))
      .map((c) => `${c.id} -> ${c.tool}`);
    expect(dangling).toEqual([]);
  });

  it("запланированное остаётся запланированным, пока его не построили", () => {
    // Инструмент появился — строку из PLANNED надо убрать, иначе список
    // превращается в кладбище, которое никто не пересматривает.
    const built = [...PLANNED].filter((t) => toolNames.has(t));
    expect(built).toEqual([]);
  });

  it("маршруты каталога совпадают с экранами продукта", () => {
    const dangling = commands
      .filter((c) => c.tool === "open_in_app")
      .map((c) => String(c.arguments?.route ?? ""))
      .filter((r) => r && !routeIds.has(r) && !PLANNED_ROUTES.has(r));
    expect(dangling).toEqual([]);
  });

  it("у каждой команды есть примеры живой речи", () => {
    const mute = commands.filter((c) => !c.examples?.length).map((c) => c.id);
    expect(mute).toEqual([]);
  });

  it("идентификаторы уникальны", () => {
    const ids = commands.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
