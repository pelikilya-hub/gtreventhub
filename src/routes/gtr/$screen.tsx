import { createFileRoute, redirect } from "@tanstack/react-router";

import { sessionFn } from "@/gtr/auth";
import { GtrShell } from "@/gtr/shell";
import type { ScreenId } from "@/gtr/data/app-data";

const SCREENS: ScreenId[] = [
  "dash",
  "calendar",
  "events",
  "constructor",
  "inquiries",
  "spaces",
  "venue",
  "finance",
  "artists",
  "vendors",
  "base",
  "venueCard",
  "access",
  "contacts",
  "afishagen",
  "map",
  "feed",
  "tonight",
  "tracking",
  "drafts",
  "outreach",
  "aimatch",
  "phrases",
  "community",
  "visas",
  "promo",
  "private",
  "myshows",
  "admin",
];

export const Route = createFileRoute("/gtr/$screen")({
  validateSearch: (
    s: Record<string, unknown>,
  ): { vid?: string; artist?: string; draft?: string; pin?: string; label?: string; kind?: string; find?: string } => ({
    vid: typeof s.vid === "string" ? s.vid : undefined,
    artist: typeof s.artist === "string" ? s.artist : undefined,
    draft: typeof s.draft === "string" ? s.draft : undefined,
    // Карта со стороны: точка «lat,lon» с подписью и типом — черновик
    // площадки, которой в базе нет; find — строка поиска, когда точки нет.
    pin: typeof s.pin === "string" ? s.pin : undefined,
    label: typeof s.label === "string" ? s.label : undefined,
    kind: typeof s.kind === "string" ? s.kind : undefined,
    find: typeof s.find === "string" ? s.find : undefined,
  }),
  beforeLoad: async ({ params }) => {
    const { user } = await sessionFn();
    if (!user) throw redirect({ to: "/gtr/login" });
    if (!SCREENS.includes(params.screen as ScreenId)) {
      throw redirect({ to: "/gtr/$screen", params: { screen: "dash" } });
    }
    return { gtrUser: user };
  },
  component: ScreenPage,
});

function ScreenPage() {
  const { gtrUser } = Route.useRouteContext();
  const { screen } = Route.useParams();
  const search = Route.useSearch();
  return <GtrShell user={gtrUser} screen={screen as ScreenId} search={search} />;
}
