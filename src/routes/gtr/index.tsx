import { createFileRoute, redirect } from "@tanstack/react-router";

import { sessionFn } from "@/gtr/auth";

export const Route = createFileRoute("/gtr/")({
  beforeLoad: async () => {
    const { user } = await sessionFn();
    throw redirect({
      to: user ? "/gtr/$screen" : "/gtr/login",
      params: user ? { screen: "dash" } : undefined,
    });
  },
});
