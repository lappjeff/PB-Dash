"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { navItems, type NavFlags } from "./nav-items";

export function NavLinks(props: NavFlags & { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {navItems(props).map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={props.onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
              active && "bg-sidebar-accent font-medium text-sidebar-foreground",
            )}
          >
            <Icon className={cn("size-4", active ? "text-sidebar-primary" : "text-muted-foreground")} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Brand() {
  return (
    <div className="flex items-center gap-2 px-2.5">
      <div className="grid size-7 place-items-center rounded-md bg-foreground text-[11px] font-bold tracking-tight text-background">PB</div>
      <div className="leading-tight">
        <div className="text-sm font-semibold">Sales Intelligence</div>
        <div className="text-[11px] text-muted-foreground">Precise Builder</div>
      </div>
    </div>
  );
}

export function Sidebar(props: NavFlags) {
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-6 border-r bg-sidebar px-3 py-4 md:flex">
      <Brand />
      <NavLinks {...props} />
    </aside>
  );
}
