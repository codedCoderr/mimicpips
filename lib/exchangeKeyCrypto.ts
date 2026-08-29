import sodium from "libsodium-wrappers";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * EXCHANGE KEY ENCRYPTION
 *
 * Uses libsodium's secretbox (XSalsa20-Poly1305, authenticated encryption)
 * with a single master key from the environment, NOT sealed boxes.
 *
 * Why not sealed boxes: sealed-box encryption is asymmetric (encrypt with
 * a public key, decrypt with a private key) and is designed for cases
 * where the encrypting party should NOT be able to decrypt — e.g. a
 * public form submitting secrets to a service that holds the only
 * private key. That's not this situation: the copy-trade worker needs to
 * decrypt every follower's keys on every trade to place orders, so the
 * server holds (and must hold) the ability to decrypt. A symmetric
 * secretbox authenticated with one master key is the correct primitive
 * here, not the wrong shortcut — using sealed boxes would add asymmetric
 * overhead for no actual security benefit, since the "private key" would
 * just sit right next to the code that needs it anyway.
 *
 * MASTER KEY CUSTODY (read this before deploying):
 * The master key lives in SAAS_SERVICE_KEY (env var, 32 bytes, base64).
 * This is genuinely the single most sensitive secret in the whole system —
 * anyone with this key and DB access can decrypt every user's exchange
 * API keys. Self-hosting this (as chosen, vs. AWS KMS) means:
 *   - YOU are the key custodian. There is no cloud provider enforcing
 *     access policies, audit logs, or automatic rotation.
 *   - Losing this key means every stored exchange key becomes permanently
 *     undecryptable — there is no recovery path. Back it up somewhere
 *     that is NOT the same place as the database backup.
 *   - It must never be committed to git, logged, or included in any
 *     error message or crash dump.
 *   - Rotating it requires decrypting every row with the old key and
 *     re-encrypting with the new one (see rotateMasterKey below) — there
 *     is no built-in versioning in this first implementation, so track
 *     rotations manually until that's added.
 * ─────────────────────────────────────────────────────────────────────────
 */

let ready: Promise<void> | null = null;
async function ensureReady(): Promise<void> {
  if (!ready) ready = sodium.ready;
  await ready;
}

function loadMasterKey(): Uint8Array {
  const raw = process.env.SAAS_SERVICE_KEY;
  if (!raw) {
    throw new Error(
      "SAAS_SERVICE_KEY is not set. Generate one with: node scripts/generate-master-key.mjs"
    );
  }
  let key: Uint8Array;
  try {
    key = sodium.from_base64(raw, sodium.base64_variants.ORIGINAL);
  } catch {
    throw new Error("SAAS_SERVICE_KEY is not valid base64.");
  }
  if (key.length !== sodium.crypto_secretbox_KEYBYTES) {
    throw new Error(
      `SAAS_SERVICE_KEY must decode to exactly ${sodium.crypto_secretbox_KEYBYTES} bytes.`
    );
  }
  return key;
}

export interface EncryptedPayload {
  ciphertext: string; // base64
  nonce: string; // base64
}

export async function encryptSecret(plaintext: string): Promise<EncryptedPayload> {
  await ensureReady();
  const key = loadMasterKey();
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, key);
  return {
    ciphertext: sodium.to_base64(ciphertext, sodium.base64_variants.ORIGINAL),
    nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL),
  };
}

export async function decryptSecret(payload: EncryptedPayload): Promise<string> {
  await ensureReady();
  const key = loadMasterKey();
  const ciphertext = sodium.from_base64(payload.ciphertext, sodium.base64_variants.ORIGINAL);
  const nonce = sodium.from_base64(payload.nonce, sodium.base64_variants.ORIGINAL);
  const plaintext = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
  if (!plaintext) {
    throw new Error("Decryption failed — wrong key, corrupted data, or tampered ciphertext.");
  }
  return sodium.to_string(plaintext);
}

/**
 * Never call this casually — see MASTER KEY CUSTODY above. Re-encrypts a
 * payload under a new key. The caller is responsible for reading every
 * stored row with the OLD key still set, calling this, and writing back
 * the result before the old key is discarded anywhere.
 */
export async function reencryptWithNewKey(
  payload: EncryptedPayload,
  newKeyBase64: string
): Promise<EncryptedPayload> {
  const plaintext = await decryptSecret(payload);
  await ensureReady();
  const newKey = sodium.from_base64(newKeyBase64, sodium.base64_variants.ORIGINAL);
  if (newKey.length !== sodium.crypto_secretbox_KEYBYTES) {
    throw new Error(`New key must decode to exactly ${sodium.crypto_secretbox_KEYBYTES} bytes.`);
  }
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, newKey);
  return {
    ciphertext: sodium.to_base64(ciphertext, sodium.base64_variants.ORIGINAL),
    nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL),
  };
}