import fs from "node:fs";
import path from "node:path";

// Bcrypt hashes are full of `$` characters, which Next.js's built-in env
// loader (dotenv-expand) treats as variable-reference syntax and silently
// mangles. Storing the hash in its own file sidesteps that entirely.
const CREDENTIALS_PATH = path.join(process.cwd(), ".credentials", "password.hash");

let cached: string | null | undefined;

export function getPasswordHash(): string | null {
  if (cached !== undefined) return cached;
  try {
    const raw = fs.readFileSync(CREDENTIALS_PATH, "utf-8").trim();
    cached = raw || null;
  } catch {
    cached = null;
  }
  return cached;
}
