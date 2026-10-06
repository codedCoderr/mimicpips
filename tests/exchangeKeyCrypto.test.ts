import test from "node:test";
import assert from "node:assert/strict";
import sodium from "libsodium-wrappers";
import { decryptSecret, encryptSecret } from "../lib/exchangeKeyCrypto";

const ORIGINAL_KEY = process.env.SAAS_MASTER_KEY;
const TEST_KEY = Buffer.alloc(32, 7).toString("base64");

test.before(async () => {
  process.env.SAAS_MASTER_KEY = TEST_KEY;
  await sodium.ready;
});

test.after(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.SAAS_MASTER_KEY;
  else process.env.SAAS_MASTER_KEY = ORIGINAL_KEY;
});

test("round-trip: encrypt then decrypt recovers the original plaintext", async () => {
  const secret = "my-exchange-api-secret-12345";
  const encrypted = await encryptSecret(secret);
  const decrypted = await decryptSecret(encrypted);
  assert.equal(decrypted, secret);
});

test("THE REGRESSION: malformed base64 ciphertext produces a DATA-problem message, not a raw 'incomplete input'", async () => {
  await assert.rejects(
    () => decryptSecret({ ciphertext: "not-valid-base64-!!!", nonce: Buffer.alloc(24).toString("base64") }),
    (err: Error) => {
      assert.match(err.message, /corrupted or malformed/i);
      assert.match(err.message, /reconnect their exchange key/i);
      assert.notEqual(err.message, "incomplete input", "must not leak the raw libsodium message unexplained");
      return true;
    }
  );
});

test("THE REGRESSION: a too-short-but-validly-encoded ciphertext still produces a categorized message, not a bare native string", async () => {
  await assert.rejects(
    () => decryptSecret({ ciphertext: Buffer.from("ab").toString("base64"), nonce: Buffer.alloc(24).toString("base64") }),
    (err: Error) => {
      assert.match(err.message, /Decryption failed:/);
      assert.notEqual(err.message, "ciphertext is too short");
      return true;
    }
  );
});

test("THE REGRESSION: wrong key (auth failure) produces a KEY-mismatch message, distinct from the data-corruption one", async () => {
  const savedKey = process.env.SAAS_MASTER_KEY;
  process.env.SAAS_MASTER_KEY = Buffer.alloc(32, 9).toString("base64");
  const encryptedUnderOtherKey = await encryptSecret("another-secret");
  process.env.SAAS_MASTER_KEY = savedKey; // restore before decrypting, so this is a genuine key mismatch

  await assert.rejects(
    () => decryptSecret(encryptedUnderOtherKey),
    (err: Error) => {
      assert.match(err.message, /Decryption failed: wrong secret key for the given ciphertext/);
      assert.match(err.message, /SAAS_MASTER_KEY.*rotated/i);
      return true;
    }
  );
});

test("the two failure categories produce genuinely different messages (this is the whole point of the fix)", async () => {
  let dataErrorMessage = "";
  try {
    await decryptSecret({ ciphertext: "!!!not-base64!!!", nonce: Buffer.alloc(24).toString("base64") });
  } catch (err) {
    dataErrorMessage = (err as Error).message;
  }

  const savedKey = process.env.SAAS_MASTER_KEY;
  process.env.SAAS_MASTER_KEY = Buffer.alloc(32, 3).toString("base64");
  const encryptedUnderOtherKey = await encryptSecret("x");
  process.env.SAAS_MASTER_KEY = savedKey;

  let keyErrorMessage = "";
  try {
    await decryptSecret(encryptedUnderOtherKey);
  } catch (err) {
    keyErrorMessage = (err as Error).message;
  }

  assert.notEqual(dataErrorMessage, keyErrorMessage);
  assert.ok(dataErrorMessage.length > 0 && keyErrorMessage.length > 0);
});
