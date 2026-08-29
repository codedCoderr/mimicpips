// Run once (or whenever you want to change the password) to set the
// dashboard login password.
// Usage: node scripts/hash-password.mjs "your-password-here"
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";

const password = process.argv[2];
if (!password) {
  console.error("Usage: node scripts/hash-password.mjs <password>");
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 12);

const dir = path.join(process.cwd(), ".credentials");
fs.mkdirSync(dir, { recursive: true });
const filePath = path.join(dir, "password.hash");
fs.writeFileSync(filePath, hash + "\n", { mode: 0o600 });

console.log(`\nPassword set. Hash written to ${filePath}`);
console.log("This file is gitignored — do not commit it.\n");
