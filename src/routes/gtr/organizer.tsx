import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";

// Публичная витрина организатора — без авторизации (гость)
const OrganizerScreen = lazy(() =>
  import("@/gtr/screens/Organizer").then((m) => ({ default: m.OrganizerScreen })),
);

export const Route = createFileRoute("/gtr/organizer")({
  component: OrganizerPage,
});

function OrganizerPage() {
  const { t } = useTranslation();
  return (
    <Suspense
      fallback={
        <div
          className="gtr-mono"
          style={{ padding: 60, textAlign: "center", color: "rgba(255,255,255,.4)" }}
        >
          {t("Загрузка витрины…")}
        </div>
      }
    >
      <OrganizerScreen />
    </Suspense>
  );
}
