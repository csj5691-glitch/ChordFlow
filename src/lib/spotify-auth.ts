// Copyright (c) 2026 Claude St-Jean. All rights reserved.

export const SPOTIFY_CLIENT_ID = "5364d7d228444739a2b48ad9a80c2470";

export const SPOTIFY_SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
].join(" ");

const TOKEN_KEY = "chordflow-spotify-token";
const VERIFIER_KEY = "chordflow-spotify-verifier";
const RETURN_KEY = "chordflow-spotify-return";

function encodeState(payload: { v: string; r: string }): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
}

export function decodeState(state: string | null): { v: string; r: string } | null {
  if (!state) return null;
  try {
    const b64 = state.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export interface SpotifyToken {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
  obtained_at: number;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomString(length: number): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const rand = new Uint8Array(length);
  crypto.getRandomValues(rand);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[rand[i] % chars.length];
  }
  return out;
}

export function getRedirectUri(): string {
  if (typeof window === "undefined") return "";
  const origin = window.location.origin;
  if (window.location.hostname === "localhost") {
    return `${origin.replace("localhost", "127.0.0.1")}/auth/callback`;
  }
  return `${origin}/auth/callback`;
}

export function getAppOrigin(): string {
  if (typeof window === "undefined") return "";
  if (window.location.hostname === "127.0.0.1") {
    return `http://localhost:${window.location.port || "3000"}`;
  }
  return window.location.origin;
}

export function hasWindow(): boolean {
  return typeof window !== "undefined";
}

export function loadToken(): SpotifyToken | null {
  if (!hasWindow()) return null;
  try {
    const raw = window.localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as SpotifyToken) : null;
  } catch {
    return null;
  }
}

function saveToken(token: SpotifyToken): void {
  window.localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

export function isLoggedIn(): boolean {
  const token = loadToken();
  if (!token?.access_token) return false;
  const expiresAt = token.obtained_at + token.expires_in * 1000;
  if (Date.now() < expiresAt - 60_000) return true;
  return Boolean(token.refresh_token);
}

export function getReturnPath(): string | null {
  if (!hasWindow()) return null;
  return window.sessionStorage.getItem(RETURN_KEY);
}

export async function authorize(returnPath?: string): Promise<void> {
  const verifier = randomString(64);
  const challenge = await generateCodeChallenge(verifier);
  const path = returnPath || "/";

  window.sessionStorage.setItem(VERIFIER_KEY, verifier);
  window.sessionStorage.setItem(RETURN_KEY, path);

  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: "code",
    redirect_uri: getRedirectUri(),
    scope: SPOTIFY_SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state: encodeState({ v: verifier, r: path }),
    show_dialog: "false",
  });

  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

async function postToken(body: URLSearchParams): Promise<SpotifyToken> {
  const res = await fetch("/api/spotify-token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(Object.fromEntries(body.entries())),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify token request failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as TokenResponse;
  return {
    access_token: data.access_token,
    token_type: data.token_type,
    expires_in: data.expires_in,
    refresh_token: data.refresh_token ?? "",
    scope: data.scope,
    obtained_at: Date.now(),
  };
}

export async function exchangeCode(code: string, verifierArg?: string | null): Promise<SpotifyToken> {
  let verifier = verifierArg ?? window.sessionStorage.getItem(VERIFIER_KEY);
  if (!verifier) {
    throw new Error("Aucune session de connexion trouvée. Réessayez.");
  }
  window.sessionStorage.removeItem(VERIFIER_KEY);

  const body = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: getRedirectUri(),
    code_verifier: verifier,
  });
  const token = await postToken(body);
  saveToken(token);
  return token;
}

export async function getValidToken(): Promise<string | null> {
  const token = loadToken();
  if (!token?.access_token) return null;

  const expiresAt = token.obtained_at + token.expires_in * 1000;
  if (Date.now() < expiresAt - 60_000) {
    return token.access_token;
  }

  if (!token.refresh_token) {
    clearToken();
    return null;
  }

  const body = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: token.refresh_token,
  });
  const refreshed = await postToken(body);
  const merged: SpotifyToken = {
    ...refreshed,
    refresh_token: refreshed.refresh_token || token.refresh_token,
  };
  saveToken(merged);
  return merged.access_token;
}

export function extractSpotifyUri(input: string): {
  type: string;
  id: string;
} | null {
  const trimmed = input.trim();
  const comMatch = trimmed.match(
    /open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(track|album|playlist|episode|show)\/([a-zA-Z0-9]+)/
  );
  if (comMatch) {
    return { type: comMatch[1], id: comMatch[2] };
  }
  const uriMatch = trimmed.match(
    /spotify:(track|album|playlist|episode|show):([a-zA-Z0-9]+)/
  );
  if (uriMatch) {
    return { type: uriMatch[1], id: uriMatch[2] };
  }
  return null;
}