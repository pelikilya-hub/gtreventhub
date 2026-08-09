import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

// Публичная витрина организатора — без авторизации (гость)
const OrganizerScreen = lazy(() =>
  import("@/gtr/screens/Organizer").then((m) => ({ default: m.OrganizerScreen })),
);

export const Route = createFileRoute("/gtr/organizer")({
  component: OrganizerPage,
});

function OrganizerPage() {
  return (
    <Suspense
      fallback={
        <div
          className="gtr-mono"
          style={{ padding: 60, textAlign: "center", color: "rgba(255,255,255,.4)" }}
        >
          Загрузка витрины…
        </div>
      }
    >
      <OrganizerScreen />
    </Suspense>
  );
}
