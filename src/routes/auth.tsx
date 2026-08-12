import { createFileRoute } from "@tanstack/react-router";
import { AuthForm } from "@/components/AuthForm";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in | SOFT IT BD" },
      { name: "description", content: "Sign in securely to your SOFT IT BD account." },
      { property: "og:title", content: "Sign in | SOFT IT BD" },
      { property: "og:description", content: "Sign in securely to your SOFT IT BD account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthForm,
});
