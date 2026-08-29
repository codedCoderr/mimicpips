"use client";

const STORAGE_KEY = "controlroom.session.v1";

export interface Session {
  connected: true;
}

export function saveSession() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ connected: true }));
}

export function loadSession(): Session | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.connected === true) return { connected: true };
    if (parsed?.baseUrl) {
      saveSession();
      return { connected: true };
    }
    return null;
  } catch {
    return null;
  }
}

export function clearSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
