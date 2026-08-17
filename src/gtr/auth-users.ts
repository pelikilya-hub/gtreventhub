// Демо-состав стенда: пять ролей под общим паролем доступа.
//
// Живёт отдельным серверным модулем: раньше список ехал в браузер вместе
// с экраном входа, и любой посетитель получал перечень действующих
// адресов — половину работы по подбору доступа за нас.
import type { SessionUser } from "./auth";

type DemoUser = SessionUser & { passHash: string };

export const demoUsers = (DEMO_PASS_HASH: string): DemoUser[] => [
  {
    email: "pr@gtr.events",
    name: "Ника Соболева",
    role: "pr",
    roleLabel: "PR-директор",
    venueId: "VEN-0013",
    initials: "ПД",
    passHash: DEMO_PASS_HASH,
  },
  {
    email: "owner@gtr.events",
    name: "Артём Ким",
    role: "owner",
    roleLabel: "Владелец",
    venueId: "VEN-0061",
    initials: "ВЛ",
    passHash: DEMO_PASS_HASH,
  },
  {
    email: "sales@gtr.events",
    name: "Мария Чан",
    role: "sales",
    roleLabel: "Event-продажи",
    venueId: "VEN-0033",
    initials: "ПР",
    passHash: DEMO_PASS_HASH,
  },
  {
    email: "admin@gtr.events",
    name: "GTR HQ",
    role: "gtr",
    roleLabel: "GTR-админ",
    venueId: "",
    initials: "АД",
    passHash: DEMO_PASS_HASH,
  },
];
