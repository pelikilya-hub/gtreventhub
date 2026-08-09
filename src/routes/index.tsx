import { createFileRoute, redirect } from "@tanstack/react-router";

// Корень продукта — сразу в приложение GTR Event
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/gtr" });
  },
});
