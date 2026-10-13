// Событие с билетами: открывается без входа, ссылку кидают в чат.
import { createFileRoute } from "@tanstack/react-router";

import { TicketEventPage } from "@/gtr/ticket-pages";

export const Route = createFileRoute("/gtr/t/$id")({
  head: () => ({ meta: [{ title: "GTR Event — билеты" }] }),
  component: () => <TicketEventPage id={Route.useParams().id} />,
});
