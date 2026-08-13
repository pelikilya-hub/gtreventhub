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
  "admin",
];

export const Route = createFileRoute("/gtr/$screen")({
  validateSearch: (
    s: Record<string, unknown>,
  ): { vid?: string; artist?: string; draft?: string } => ({
    vid: typeof s.vid === "string" ? s.vid : undefined,
    artist: typeof s.artist === "string" ? s.artist : undefined,
    draft: typeof s.draft === "string" ? s.draft : undefined,
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
