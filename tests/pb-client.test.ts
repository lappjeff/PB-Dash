import { describe, expect, it, vi } from "vitest";
import { HttpPbClient, PbApiError } from "@/server/pb/client";

const BASE = "https://app.precisebuilder.com/t1234abcd";
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function client(fetchImpl: typeof fetch) {
  return new HttpPbClient({ baseUrl: BASE, apiKey: "pbk_test", fetch: fetchImpl, sleep: async () => {} });
}

describe("HttpPbClient", () => {
  it("sends the bearer key and documented paging parameters", async () => {
    const f = vi.fn(async (...args: [URL | RequestInfo, RequestInit?]) => (void args, json({ data: [], next_cursor: "abc" })));
    const page = await client(f as unknown as typeof fetch).listOpportunities({ cursor: "xyz", status: "pending", includeArchived: true, limit: 9999 });
    expect(page.nextCursor).toBe("abc");
    const [url, init] = f.mock.calls[0];
    const u = new URL(String(url));
    expect(u.pathname).toBe("/t1234abcd/api/v1/opportunities");
    expect(Object.fromEntries(u.searchParams)).toEqual({ limit: "500", cursor: "xyz", status: "pending", include_archived: "true" });
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer pbk_test");
  });

  it("accepts users whose name is null (seen on a live account)", async () => {
    const f = async () => json({ data: [{ id: "u1", name: "Ann Lee" }, { id: "u2", name: null }] });
    expect(await client(f as unknown as typeof fetch).listUsers()).toEqual([{ id: "u1", name: "Ann Lee" }, { id: "u2", name: null }]);
  });

  it("returns null for 404 on single-record reads", async () => {
    const f = async () => json({ errors: [{ status: "404", code: "not-found", detail: "No such record" }] }, 404);
    expect(await client(f as unknown as typeof fetch).getOpportunity("nope")).toBeNull();
  });

  it("retries 5xx then succeeds; does not retry 401", async () => {
    let n = 0;
    const flaky = async () => (++n < 3 ? json({ errors: [{ code: "x" }] }, 500) : json({ data: [{ id: "1", name: "Website" }] }));
    expect(await client(flaky as unknown as typeof fetch).listLeadSources()).toHaveLength(1);
    expect(n).toBe(3);

    let m = 0;
    const denied = async () => {
      m++;
      return json({ errors: [{ status: "401", code: "unauthorized" }] }, 401);
    };
    await expect(client(denied as unknown as typeof fetch).listLeadSources()).rejects.toBeInstanceOf(PbApiError);
    expect(m).toBe(1);
  });

  it("rejects responses that do not match the documented schema, and HTML pages", async () => {
    const bad = async () => json({ data: [{ id: 1 }] });
    await expect(client(bad as unknown as typeof fetch).listLeadSources()).rejects.toThrow(/documented schema/);
    const html = async () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
    await expect(client(html as unknown as typeof fetch).listLeadSources()).rejects.toThrow(/BASE_URL/);
  });

  it("keeps unknown new fields (docs: fields may be added)", async () => {
    const f = async () => json({ data: [{ id: "s1", name: "New", status: "pending", color: "blue" }] });
    const [s] = await client(f as unknown as typeof fetch).listSalesStages();
    expect((s as Record<string, unknown>).color).toBe("blue");
  });
});
