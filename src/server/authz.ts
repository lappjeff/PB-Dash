/**
 * Authorization rules, independent of how the user was authenticated.
 * Every data-access function takes a resolved scope produced here, so aggregate
 * queries are restricted on the server, not only in the UI.
 */
export type Role = "ADMIN" | "SALESPERSON";

export type Viewer = {
  userId: number;
  name: string;
  email: string | null;
  role: Role;
  salespersonId: number | null;
  isDemo: boolean;
};

export class AuthError extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly code: "unauthenticated" | "forbidden" | "not-linked" | "auth-not-configured",
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** "all" = no salesperson restriction (admins only). Otherwise the allowed salesperson ids. */
export type SalespersonScope = "all" | number[];

export function isAdmin(v: Viewer) {
  return v.role === "ADMIN";
}

export function requireAdmin(v: Viewer) {
  if (!isAdmin(v)) throw new AuthError(403, "forbidden", "Administrator access required");
}

/**
 * Admins may view everyone or narrow to specific salespeople. A salesperson is always
 * restricted to their own linked PB salesperson; asking for anyone else is refused
 * rather than silently narrowed, so mistakes are visible.
 */
export function resolveScope(v: Viewer, requested?: number[] | null): SalespersonScope {
  if (isAdmin(v)) return requested && requested.length ? requested : "all";
  if (v.salespersonId === null) {
    throw new AuthError(403, "not-linked", "Your account is not linked to a Precise Builder salesperson yet. Ask an administrator.");
  }
  if (requested && requested.some((id) => id !== v.salespersonId)) {
    throw new AuthError(403, "forbidden", "You can only view your own data");
  }
  return [v.salespersonId];
}

export function canViewSalesperson(v: Viewer, salespersonId: number | null) {
  return isAdmin(v) || (v.salespersonId !== null && v.salespersonId === salespersonId);
}
