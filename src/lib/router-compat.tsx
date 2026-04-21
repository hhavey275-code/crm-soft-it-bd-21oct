// Compatibility shim so files copied from a react-router-dom codebase keep working
// against TanStack Router without per-call rewrites.
import {
  useNavigate as useTSNavigate,
  Link as TSLink,
  type LinkProps as TSLinkProps,
} from "@tanstack/react-router";
import { forwardRef } from "react";

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

type LinkCompatProps = Omit<TSLinkProps, "to"> & {
  to: string;
  children?: React.ReactNode;
  className?: string;
};

export const Link = forwardRef<HTMLAnchorElement, LinkCompatProps>(
  ({ to, ...rest }, ref) => {
    return <TSLink ref={ref} to={to as any} {...(rest as any)} />;
  }
);
Link.displayName = "Link";
