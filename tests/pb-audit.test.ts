import { describe, expect, it } from "vitest";
import { DOC_SPECS, auditRecords, findings, newAudit } from "@/server/pb/audit";

const U = "8b0e6f9a-3c2d-4e1f-9a8b-7c6d5e4f3a2b";

describe("PB docs audit", () => {
  it("reports nothing for a record that matches the docs", () => {
    const a = auditRecords(newAudit(), DOC_SPECS["sales stage"], [{ id: U, name: "Won", status: "won" }]);
    expect(findings(a)).toEqual([]);
  });

  it("flags missing, extra, wrongly typed, bad enum and null fields without echoing values", () => {
    const a = auditRecords(newAudit(), DOC_SPECS.opportunity, [
      {
        id: U,
        number: 1042,
        customer: { id: U, name: "Secret Customer Name", phone: "555-0100" },
        description: "Private description",
        notes: null,
        site_address: null,
        job_type: null,
        temperature: "lukewarm",
        revenue: "1000",
        sales_stage: { id: U, name: "New" },
        status: "pending",
        sales_rep: null,
        lost_reason: null,
        closed_at: "2026-10-21 14:30",
        completed_at: null,
        created_date: "2026-10-21",
        mystery: true,
      },
    ]);
    const text = findings(a, new Set(["site_address", "completed_at"])).map((f) => `${f.severity}: ${f.text}`);
    expect(text).toEqual(
      expect.arrayContaining([
        "mismatch: `archived` missing from 1 of 1 records",
        "mismatch: `number` was number in 1 records",
        "mismatch: `revenue` was string in 1 records",
        'mismatch: `temperature` had undocumented value "lukewarm" in 1 records',
        "mismatch: `closed_at` was string, not ISO 8601 with time zone in 1 records",
        "mismatch: undocumented field `mystery` in 1 of 1 records",
        "mismatch: undocumented field `customer.phone` in 1 of 1 records",
        "note: `notes` was null in 1 of 1 records",
      ]),
    );
    expect(text.join("\n")).not.toMatch(/Secret|Private|555/);
    expect(text.some((t) => t.includes("site_address") || t.includes("completed_at"))).toBe(false);
  });

  it("checks array items and nested objects", () => {
    const a = auditRecords(newAudit(), DOC_SPECS.customer, [
      { id: U, phones: [{ phone: "x", label: "Mobile", ext: "1" }, null], opportunities: [{ id: "not-a-uuid" }] },
    ]);
    const text = findings(a).map((f) => f.text);
    expect(text).toContain("undocumented field `phones[].ext` in 1 of 1 records");
    expect(text).toContain("`phones[]` was null in 1 of 1 records");
    expect(text).toContain("`opportunities[].id` was string, not a UUID in 1 records");
  });
});
