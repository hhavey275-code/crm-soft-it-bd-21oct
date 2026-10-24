import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "SoftIT BD — Sign in" },
    { name: "description", content: "Sign in to SoftIT BD to manage your advertising accounts and wallet." },
    { property: "og:title", content: "SoftIT BD — Sign in" },
    { property: "og:description", content: "Access your SoftIT BD advertising accounts and wallet." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  beforeLoad: () => {
    throw redirect({ to: "/auth" });
  },
});
