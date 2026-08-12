import { createFileRoute } from "@tanstack/react-router";
import { AuthForm } from "@/components/AuthForm";

export const Route = createFileRoute("/signup")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Create account | SOFT IT BD" },
      { name: "description", content: "Create your SOFT IT BD account." },
      { property: "og:title", content: "Create account | SOFT IT BD" },
      { property: "og:description", content: "Create your SOFT IT BD account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthForm,
});
