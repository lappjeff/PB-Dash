import crypto from "node:crypto";

export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type SignatureResult =
  | { ok: true }
  | { ok: false; reason: "missing-header" | "malformed-header" | "timestamp-out-of-range" | "no-matching-signature" | "no-secret" };

/**
 * Verifies the `Precise-Signature` header as documented at
 * https://app.precisebuilder.com/docs/webhook-signatures/ :
 * HMAC-SHA256 over `<t>.<raw body>` with the endpoint secret, lowercase hex,
 * accepted if it equals ANY `v1` value (two are sent during a 24h secret rotation),
 * and `t` within 5 minutes of our clock.
 *
 * `secrets` may hold several endpoint secrets; any match is accepted.
 */
export function verifyPreciseSignature(
  rawBody: string | Buffer,
  header: string | null | undefined,
  secrets: string[],
  nowSeconds: number = Date.now() / 1000,
): SignatureResult {
  if (secrets.length === 0) return { ok: false, reason: "no-secret" };
  if (!header) return { ok: false, reason: "missing-header" };

  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === "t") timestamp = value;
    else if (key === "v1") signatures.push(value);
  }
  if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length === 0) {
    return { ok: false, reason: "malformed-header" };
  }
  if (Math.abs(nowSeconds - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: "timestamp-out-of-range" };
  }

  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  for (const secret of secrets) {
    const expected = Buffer.from(
      crypto.createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex"),
    );
    for (const sig of signatures) {
      const candidate = Buffer.from(sig);
      if (candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected)) {
        return { ok: true };
      }
    }
  }
  return { ok: false, reason: "no-matching-signature" };
}

/** Produces a header exactly as PB would. Used by tests and demo-mode webhook simulation. */
export function signPreciseBody(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  const v1 = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}
