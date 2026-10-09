import { createRouter, useRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

function DefaultErrorComponent({ error: rawError, reset }: import("@tanstack/react-router").ErrorComponentProps) {
  const error = rawError as Error;
  const router = useRouter();
  const isChunk = /dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError|Unexpected token '<'/i.test(
    String(error?.message || ""),
  );
  if (typeof window !== "undefined") {
    console.error("[route-error]", error);
    if (isChunk) {
      try {
        const last = Number(sessionStorage.getItem("chunk-reload-at") || 0);
        if (Date.now() - last > 30_000) {
          sessionStorage.setItem("chunk-reload-at", String(Date.now()));
          void import("@/lib/app-recovery").then((m) => m.recoverFromStaleAssets()).catch(() => window.location.reload());
        }
      } catch {
        window.location.reload();
      }
    }
  }
  if (isChunk) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-xl font-semibold text-foreground">নতুন আপডেট লোড হচ্ছে…</h1>
          <p className="text-sm text-muted-foreground">কয়েক সেকেন্ডে না খুললে নিচের বাটনে চাপুন।</p>
          <button
            onClick={() => {
              sessionStorage.removeItem("chunk-reload-at");
              void import("@/lib/app-recovery").then((m) => m.recoverFromStaleAssets());
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-8 w-8 text-destructive"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          An unexpected error occurred. Please try again.
        </p>
        {error?.message && (
          <pre className="mt-4 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-left font-mono text-xs text-destructive">
            {error.message}
          </pre>
        )}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const getRouter = () => {
  const router = createRouter({
    routeTree,
    context: {},
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: DefaultErrorComponent,
  });

  return router;
};
