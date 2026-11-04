/**
 * Minimal structured JSON logger. Callers must pass only identifiers and counts —
 * never API keys, secrets, or customer contact details.
 */
type Level = "debug" | "info" | "warn" | "error";

const REDACT = /(authorization|api[_-]?key|secret|password|token|email|phone)/i;

function scrub(fields: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = REDACT.test(k) ? "[redacted]" : v;
  return out;
}

function emit(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  if (process.env.VITEST && level !== "error") return;
  const line = JSON.stringify({ level, msg, time: new Date().toISOString(), ...scrub(fields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, f?: Record<string, unknown>) => emit("debug", msg, f),
  info: (msg: string, f?: Record<string, unknown>) => emit("info", msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => emit("warn", msg, f),
  error: (msg: string, f?: Record<string, unknown>) => emit("error", msg, f),
};
