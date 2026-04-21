// Compatibility shim so files copied from a react-router-dom codebase keep working
// against TanStack Router without per-call rewrites.
import {
  useNavigate as useTSNavigate,
  useParams as useTSParams,
  useSearch as useTSSearch,
  Link as TSLink,
  type LinkProps as TSLinkProps,
} from "@tanstack/react-router";
import { forwardRef, useEffect } from "react";

export function useNavigate() {
  const nav = useTSNavigate();
  return (to: string | number) => {
    if (typeof to === "number") {
      if (typeof window !== "undefined") window.history.go(to);
      return;
    }
    nav({ to: to as string });
  };
}

export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T {
  return useTSParams({ strict: false }) as T;
}

export function useSearchParams(): [URLSearchParams, (params: URLSearchParams | Record<string, string>) => void] {
  const search = useTSSearch({ strict: false }) as Record<string, any>;
  const nav = useTSNavigate();
  const params = new URLSearchParams();
  Object.entries(search || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null) params.set(k, String(v));
  });
  const setParams = (next: URLSearchParams | Record<string, string>) => {
    const obj: Record<string, string> = {};
    if (next instanceof URLSearchParams) {
      next.forEach((v, k) => { obj[k] = v; });
    } else {
      Object.assign(obj, next);
    }
    nav({ search: obj as any });
  };
  return [params, setParams];
}

type LinkCompatProps = Omit<TSLinkProps, "to"> & {
  to: string;
  children?: React.ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  target?: string;
  rel?: string;
  style?: React.CSSProperties;
  title?: string;
};

export const Link = forwardRef<HTMLAnchorElement, LinkCompatProps>(
  ({ to, ...rest }, ref) => {
    return <TSLink ref={ref} to={to as any} {...(rest as any)} />;
  }
);
Link.displayName = "Link";

// react-router-dom Navigate component — performs an imperative redirect on mount
export function Navigate({ to, replace }: { to: string; replace?: boolean }) {
  const nav = useTSNavigate();
  useEffect(() => {
    nav({ to: to as any, replace });
  }, [to, replace]);
  return null;
}

// react-router-dom useNavigationType — TanStack doesn't expose this; return "PUSH"
export function useNavigationType(): "POP" | "PUSH" | "REPLACE" {
  return "PUSH";
}
