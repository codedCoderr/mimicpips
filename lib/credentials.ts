import fs from "node:fs";
import path from "node:path";
import * as dotenv from "dotenv";

dotenv.config( { path: ".env.local" } );

// Bcrypt hashes are full of `$` characters, which Next.js's built-in env
// loader (dotenv-expand) treats as variable-reference syntax and silently
// mangles. Storing the hash in its own file sidesteps that entirely.
// const CREDENTIALS_PATH = path.join( process.cwd(), ".credentials", "password.hash" );

// let cached: string | null | undefined;

export function getPasswordHash (): string | null {
  // Now safely reads the un-mangled hash from the environment
  return process.env.LOGIN_HASH || null;
}
