// Run once to generate the master key used to encrypt/decrypt user
// exchange API keys. Store the output in SAAS_SERVICE_KEY — treat it with
// the same care as a root password. See lib/exchangeKeyCrypto.ts for the
// full custody notes (backup separately from the DB, never commit it,
// losing it makes every stored key permanently undecryptable).
//
// Usage: node scripts/generate-master-key.mjs
import sodium from "libsodium-wrappers";

await sodium.ready;
const key = sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES);
const encoded = sodium.to_base64(key, sodium.base64_variants.ORIGINAL);

console.log("\nSAAS_SERVICE_KEY (add to your server's environment, NOT to any .env file that gets committed):\n");
console.log(encoded);
console.log(
  "\nBack this up somewhere separate from your database backups. If it's lost, every stored exchange key becomes permanently undecryptable.\n"
);