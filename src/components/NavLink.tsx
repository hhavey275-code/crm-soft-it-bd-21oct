import { Link, useLocation } from "@tanstack/react-router";
import { forwardRef, AnchorHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface NavLinkCompatProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className"> {
  to: string;
  end?: boolean;
  className?: string;
  activeClassName?: string;
  pendingClassName?: string;
  children?: React.ReactNode;
}

const NavLink = forwardRef<HTMLAnchorElement, NavLinkCompatProps>(
  ({ className, activeClassName, to, end, children, ...props }, ref) => {
    const location = useLocation();
    const isActive = end
      ? location.pathname === to
      : location.pathname === to || location.pathname.startsWith(to + "/");
    return (
      <Link
        ref={ref}
        to={to as any}
        className={cn(className, isActive && activeClassName)}
        {...(props as any)}
      >
        {children}
      </Link>
    );
  },
);

NavLink.displayName = "NavLink";

export { NavLink };
