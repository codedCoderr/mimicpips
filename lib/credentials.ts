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
  // 1. Check environment variable and decode from Base64
  if ( process.env.LOGIN_HASH ) {
    return Buffer.from( process.env.LOGIN_HASH, "base64" ).toString( "utf-8" );
  }

  // 2. Fallback to reading the file if running locally
  try {
    const hashPath = path.join( process.cwd(), ".credentials", "password.hash" );
    if ( fs.existsSync( hashPath ) ) {
      const fileHash = fs.readFileSync( hashPath, "utf8" ).trim();
      if ( fileHash ) return fileHash;
    }
  } catch {
    // Ignore file read errors
  }

  return null;
}
