// Кто в продукте «команда». Отдельный модуль без данных: этот предикат
// нужен и браузеру, и серверу, а тянуть ради него весь каталог в бандл
// нельзя.
export const TEAM_ROLES = ["gtr", "organizer", "pr", "owner", "sales"];

export const isTeam = (role?: string): boolean => Boolean(role && TEAM_ROLES.includes(role));
