import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Clerk needs its middleware to attach auth state. Protection itself happens on each
 * resource (pages via pageContext(), Route Handlers via requireViewer(), Server Actions
 * via requireAdmin()), as Clerk recommends. Webhook and cron routes use their own secrets.
 * Without Clerk keys (demo mode) there is nothing to do here.
 */
const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
const withClerk = clerkMiddleware();

export default function proxy(req: NextRequest, ev: Parameters<typeof withClerk>[1]) {
  if (!clerkConfigured) return NextResponse.next();
  return withClerk(req, ev);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
