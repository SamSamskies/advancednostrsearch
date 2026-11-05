import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `vercel dev` sometimes does not inject `.env.local` into serverless
 * functions. Fill allowed keys from local files when missing (no-op if set).
 */
export function loadLocalEnvFallback(names) {
  if (!Array.isArray(names) || names.length === 0) return;
  const files = [".env.local", ".env"];
  for (const file of files) {
    try {
      const path = join(process.cwd(), file);
      if (!existsSync(path)) continue;
      for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        if (!names.includes(key)) continue;
        if (process.env[key]?.trim()) continue;
        let value = trimmed.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (value) process.env[key] = value;
      }
    } catch {
      // ignore unreadable env files
    }
  }
}
