import fs from "node:fs";
import path from "node:path";

// Bcrypt hashes are full of `$` characters, which Next.js's built-in env
// loader (dotenv-expand) treats as variable-reference syntax and silently
// mangles. Storing the hash in its own file sidesteps that entirely.
// const CREDENTIALS_PATH = path.join( process.cwd(), ".credentials", "password.hash" );

// let cached: string | null | undefined;

export function getPasswordHash (): string | null {
  // Check the environment variable directly (works reliably on AWS Amplify)
  if ( process.env.LOGIN_HASH ) {
    return process.env.LOGIN_HASH;
  }

  // Fallback to reading the file if running locally
  try {
    const hashPath = path.join( process.cwd(), ".credentials", "password.hash" );
    if ( fs.existsSync( hashPath ) ) {
      return fs.readFileSync( hashPath, "utf8" ).trim();
    }
  } catch {
    // Ignore file read errors
  }

  return null;
}
