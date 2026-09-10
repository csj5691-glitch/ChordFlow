"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

// Player Web SDK Spotify partagé à toute l'application.
// Au lieu de créer/détruire un device à chaque page (churn qui rendait
// l'enregistrement du device instable → DEVICE_NOT_ON_ACCOUNT), on garde
// UNE seule instance et UN seul device, connectés une fois et réutilisés.

import { getValidToken } from "./spotify-auth";

declare global {
  interface Window {
    Spotify?: {
      Player: new (options: Record<string, unknown>) => SpotifyPlayerInstance;
    };
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

const SDK_SCRIPT_ID = "spotify-playback-sdk";

export interface SpotifyPlaybackState {
  paused: boolean;
  position_ms: number;
  duration_ms: number;
  track_window?: {
    current_track?: {
      uri: string;
      name: string;
      artists: { name: string }[];
    };
  };
}

export interface SpotifyPlayerInstance {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  activateElement: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
  getCurrentState: () => Promise<SpotifyPlaybackState | null>;
  addListener: (event: string, cb: (state?: unknown) => void) => void;
}

let instance: SpotifyPlayerInstance | null = null;
let connecting: Promise<SpotifyPlayerInstance | null> | null = null;
let deviceId: string | null = null;
let ready = false;

type ReadyListener = (deviceId: string) => void;
type StateListener = (state: unknown) => void;
type NotReadyListener = () => void;
type SdkErrorListener = (key: string, label: string, msg: string) => void;
type AuthErrorListener = (code: string) => void;

const readyListeners = new Set<ReadyListener>();
const stateListeners = new Set<StateListener>();
const notReadyListeners = new Set<NotReadyListener>();
const sdkErrorListeners = new Set<SdkErrorListener>();
const authErrorListeners = new Set<AuthErrorListener>();

export function subscribeSpotifyPlayer(cb: {
  onReady: ReadyListener;
  onState: StateListener;
  onNotReady: NotReadyListener;
  onSdkError: SdkErrorListener;
  onAuthError: AuthErrorListener;
}) {
  readyListeners.add(cb.onReady);
  stateListeners.add(cb.onState);
  notReadyListeners.add(cb.onNotReady);
  sdkErrorListeners.add(cb.onSdkError);
  authErrorListeners.add(cb.onAuthError);
  if (ready && deviceId) cb.onReady(deviceId);
  return () => {
    readyListeners.delete(cb.onReady);
    stateListeners.delete(cb.onState);
    notReadyListeners.delete(cb.onNotReady);
    sdkErrorListeners.delete(cb.onSdkError);
    authErrorListeners.delete(cb.onAuthError);
  };
}

export function getSpotifyDeviceId(): string | null {
  return deviceId;
}

export function getSpotifyPlayerInstance(): SpotifyPlayerInstance | null {
  return instance;
}

function ensureScript(done: () => void, onError?: () => void): void {
  if (document.getElementById(SDK_SCRIPT_ID)) {
    done();
    return;
  }
  const tag = document.createElement("script");
  tag.id = SDK_SCRIPT_ID;
  tag.src = "https://sdk.scdn.co/spotify-player.js";
  tag.async = true;
  tag.onload = done;
  tag.onerror = () => onError?.();
  document.head.appendChild(tag);
}

function boot(): void {
  if (instance) return;
  instance = new window.Spotify!.Player({
    name: "ChordFlow",
    getOAuthToken: async (cb: (token: string) => void) => {
      try {
        const token = await getValidToken();
        if (!token) {
          console.warn("SDK : aucun jeton valide (expiré/non rafraîchissable)");
          authErrorListeners.forEach((f) => f("spotify-auth-token-manquant"));
        } else {
          console.log("SDK : jeton fourni");
        }
        cb(token ?? "");
      } catch (err) {
        console.error("getOAuthToken a échoué (le SDK restait sans jeton) :", err);
        authErrorListeners.forEach((f) => f("spotify-auth-token-erreur"));
        cb("");
      }
    },
    volume: 0.7,
  });

  for (const [evt, label] of [
    ["initialization_error", "Erreur d'initialisation du SDK"],
    ["authentication_error", "Erreur d'authentification (jeton invalide ou scopes)"],
    ["account_error", "Compte Spotify sans abonnement Premium"],
    ["playback_error", "Erreur de lecture Spotify"],
  ] as Array<[string, string]>) {
    instance!.addListener(evt, (d) => {
      const msg = ((d as { message?: string })?.message ?? "") as string;
      console.error(`Spotify SDK ${evt}:`, msg || "(aucun message)");
      sdkErrorListeners.forEach((f) => f(evt, label, msg));
    });
  }

  instance!.addListener("ready", (d) => {
    deviceId = ((d as { device_id?: string })?.device_id ?? null) as string | null;
    ready = true;
    if (deviceId) readyListeners.forEach((f) => f(deviceId!));
  });

  instance!.addListener("player_state_changed", (s) => {
    stateListeners.forEach((f) => f(s));
  });

  instance!.addListener("not_ready", () => {
    ready = false;
    deviceId = null;
    notReadyListeners.forEach((f) => f());
  });

  instance!
    .connect()
    .then((ok) => console.log("Spotify connect() →", ok))
    .catch(() => {});
}

function resetConnection(): void {
  if (instance) {
    try {
      instance.disconnect();
    } catch {
      // ignorer
    }
  }
  instance = null;
  deviceId = null;
  ready = false;
  connecting = null;
}

export function ensureSpotifyPlayer(): Promise<SpotifyPlayerInstance | null> {
  if (instance && deviceId) return Promise.resolve(instance);
  if (!connecting) {
    connecting = new Promise<SpotifyPlayerInstance | null>((resolve, reject) => {
      const start = () => {
        try {
          boot();
        } catch (e) {
          resetConnection();
          reject(e as Error);
          return;
        }
        let waited = 0;
        const poll = setInterval(() => {
          if (instance && deviceId) {
            clearInterval(poll);
            resolve(instance);
            return;
          }
          waited += 500;
          if (waited >= 25_000) {
            clearInterval(poll);
            resetConnection();
            reject(
              Object.assign(
                new Error(
                  "Le lecteur Spotify ne se connecte pas (WebSocket Spotify bloqué ?). " +
                    "Vérifiez votre réseau et désactivez les bloqueurs, puis réessayez."
                ),
                { cause: "timeout" }
              )
            );
          }
        }, 500);
      };
      ensureScript(start, () => {
        resetConnection();
        reject(new Error("Impossible de charger le SDK Spotify (réseau ou bloqueur ?)."));
      });
    });
  }
  return connecting!;
}