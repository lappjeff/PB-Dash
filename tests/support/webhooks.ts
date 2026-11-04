import crypto from "node:crypto";
import { signPreciseBody } from "@/server/pb/signature";

export const SECRET = "whsec_test_secret";

export function envelope(type: string, objectType: string, objectId: string, data: Record<string, unknown> = {}, createdAt = "2026-02-20T14:30:00+00:00", id: string = crypto.randomUUID()) {
  return {
    id,
    type,
    account: "t1234abcd",
    api_version: "2026-10",
    created_at: createdAt,
    data: { object: { type: objectType, id: objectId }, ...data },
  };
}

export function signed(body: object, secret = SECRET) {
  const raw = JSON.stringify(body);
  return { raw, header: signPreciseBody(raw, secret) };
}

export function stageEvent(oppId: string, from: { id: string; name: string }, to: { id: string; name: string }, createdAt: string, id?: string) {
  return envelope(
    "opportunity.stage_updated",
    "opportunity",
    oppId,
    {
      opportunity: { id: oppId, name: "x", description: "x", status: "pending", temperature: "warm", job_type: "Remodel", site_address: null, closed_at: null, completed_at: null },
      customer: { id: "c1", name: "Jane Smith", email: "jane@example.com", phone: "555-555-0100" },
      salesrep: { id: "8b0e6f9a-3c2d-4e1f-9a8b-7c6d5e4f3a2b", name: "Kyle Gibson" },
      stage: to,
      previous_stage: from,
    },
    createdAt,
    id,
  );
}
