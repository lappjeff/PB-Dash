"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { buttonVariants } from "@/components/ui/button";
import { Brand, NavLinks } from "./sidebar";
import type { NavFlags } from "./nav-items";

export function MobileNav(props: NavFlags) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger className={buttonVariants({ variant: "ghost", size: "icon", className: "md:hidden" })} aria-label="Open navigation">
        <Menu />
      </SheetTrigger>
      <SheetContent side="left" className="w-64 gap-6 p-4">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <Brand />
        <NavLinks {...props} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
