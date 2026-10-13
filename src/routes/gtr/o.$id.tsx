// Заказ билетов: QR для оплаты, а после подтверждения — сам билет.
import { createFileRoute } from "@tanstack/react-router";

import { TicketOrderPage } from "@/gtr/ticket-pages";

export const Route = createFileRoute("/gtr/o/$id")({
  head: () => ({ meta: [{ title: "GTR Event — заказ" }] }),
  component: () => <TicketOrderPage id={Route.useParams().id} />,
});
