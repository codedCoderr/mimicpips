import { randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import { getSaasDb } from "./saasDb";
import type { UserDoc, SessionDoc } from "./saasTypes";

/**
 * Multi-user session auth for the copy-trading SaaS layer. Deliberately
 * separate from lib/auth.ts (the single "operator" password gating the
 * Control Room dashboard) — different cookie name, different session
 * storage (DB-backed here, so a specific user's session can be revoked;
 * that file uses a stateless JWT since there's only ever one operator).
 */

const COOKIE_NAME = "saas_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

export { COOKIE_NAME };

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export async function createUser(
  email: string,
  password: string,
  displayName: string
): Promise<UserDoc> {
  const db = await getSaasDb();
  const normalizedEmail = email.trim().toLowerCase();

  const existing = await db.collection<UserDoc>("users").findOne({ email: normalizedEmail });
  if (existing) {
    throw new Error("An account with this email already exists.");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date();
  const user: UserDoc = {
    email: normalizedEmail,
    passwordHash,
    displayName: displayName.trim(),
    createdAt: now,
    role: "follower",
    copyTradingEnabled: false,
    emailVerified: false,
  };

  const result = await db.collection<UserDoc>("users").insertOne(user as any);
  return { ...user, _id: result.insertedId };
}

export async function verifyPassword(
  email: string,
  password: string
): Promise<UserDoc | null> {
  const db = await getSaasDb();
  const user = await db
    .collection<UserDoc>("users")
    .findOne({ email: email.trim().toLowerCase() });
  if (!user) return null;

  const valid = await bcrypt.compare(password, user.passwordHash);
  return valid ? user : null;
}

export async function createSession(userId: ObjectId): Promise<{ token: string; expiresAt: Date }> {
  const db = await getSaasDb();
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.collection<SessionDoc>("sessions").insertOne({
    userId,
    token,
    expiresAt,
    createdAt: new Date(),
  } as any);

  return { token, expiresAt };
}

export async function getUserFromSessionToken(token: string): Promise<UserDoc | null> {
  if (!token) return null;
  const db = await getSaasDb();

  const session = await db.collection<SessionDoc>("sessions").findOne({ token });
  if (!session || session.expiresAt < new Date()) return null;

  const user = await db.collection<UserDoc>("users").findOne({ _id: session.userId });
  return user;
}

/** Revokes a single session — used on logout or password change. */
export async function revokeSession(token: string): Promise<void> {
  const db = await getSaasDb();
  await db.collection<SessionDoc>("sessions").deleteOne({ token });
}

/** Revokes every session for a user — used on password change or admin suspension. */
export async function revokeAllUserSessions(userId: ObjectId): Promise<void> {
  const db = await getSaasDb();
  await db.collection<SessionDoc>("sessions").deleteMany({ userId });
}

export { SESSION_TTL_MS };