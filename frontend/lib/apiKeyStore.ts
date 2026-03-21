import type { Provider } from "./types";

const STORAGE_KEYS: Record<Provider, string> = {
  anthropic: "mazelan_anthropic_api_key",
  openai: "mazelan_openai_api_key",
  google: "mazelan_google_api_key",
};

const OLD_STORAGE_KEYS: Record<Provider, string> = {
  anthropic: "claudia_anthropic_api_key",
  openai: "claudia_openai_api_key",
  google: "claudia_google_api_key",
};

// ── Web Crypto encryption ───────────────────────
const DB_NAME = "mazelan_keystore";
const DB_STORE = "keys";
const CRYPTO_KEY_ID = "encryption_key";

async function getOrCreateCryptoKey(): Promise<CryptoKey> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(DB_STORE);
    };
    req.onsuccess = async () => {
      const db = req.result;
      const tx = db.transaction(DB_STORE, "readonly");
      const store = tx.objectStore(DB_STORE);
      const getReq = store.get(CRYPTO_KEY_ID);
      getReq.onsuccess = async () => {
        if (getReq.result) {
          resolve(getReq.result);
          db.close();
        } else {
          const key = await crypto.subtle.generateKey(
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"]
          );
          const writeTx = db.transaction(DB_STORE, "readwrite");
          writeTx.objectStore(DB_STORE).put(key, CRYPTO_KEY_ID);
          writeTx.oncomplete = () => {
            resolve(key);
            db.close();
          };
          writeTx.onerror = () => { reject(writeTx.error); db.close(); };
        }
      };
      getReq.onerror = () => { reject(getReq.error); db.close(); };
    };
    req.onerror = () => reject(req.error);
  });
}

async function encryptValue(plaintext: string): Promise<string> {
  const key = await getOrCreateCryptoKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(Array.from(combined, (b) => String.fromCharCode(b)).join(""));
}

async function decryptValue(stored: string): Promise<string | null> {
  try {
    const key = await getOrCreateCryptoKey();
    const combined = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

function isEncrypted(value: string): boolean {
  // Encrypted values are base64 and longer; raw API keys start with "sk-" or "AI"
  return !value.startsWith("sk-") && !value.startsWith("AI") && value.length > 50;
}

// ── In-memory cache (avoid async reads on every render) ───
const cache: Record<string, string | null> = {};
let cacheLoaded = false;
let cacheReadyResolve: (() => void) | null = null;
const cacheReadyPromise = typeof window !== "undefined"
  ? new Promise<void>((resolve) => { cacheReadyResolve = resolve; })
  : Promise.resolve();
const cacheListeners: Array<() => void> = [];

/** Subscribe to cache ready event. Returns unsubscribe function. */
export function onCacheReady(fn: () => void): () => void {
  // Always wait for the promise — cacheLoaded is set before async work completes
  cacheReadyPromise.then(fn);
  return () => {};
}

/** Wait for cache to be loaded. */
export const waitForCache = () => cacheReadyPromise;

async function loadCache(): Promise<void> {
  if (cacheLoaded || typeof window === "undefined") return;
  cacheLoaded = true;

  // Migrate old keys first
  for (const provider of Object.keys(OLD_STORAGE_KEYS) as Provider[]) {
    const oldKey = localStorage.getItem(OLD_STORAGE_KEYS[provider]);
    if (oldKey && !localStorage.getItem(STORAGE_KEYS[provider])) {
      localStorage.setItem(STORAGE_KEYS[provider], oldKey);
      localStorage.removeItem(OLD_STORAGE_KEYS[provider]);
    }
  }

  // Load and decrypt all keys, encrypt any plaintext keys
  const allKeys = [...Object.values(STORAGE_KEYS), GOOGLE_FALLBACK_KEY];
  for (const storageKey of allKeys) {
    const raw = localStorage.getItem(storageKey);
    if (!raw) { cache[storageKey] = null; continue; }
    if (isEncrypted(raw)) {
      cache[storageKey] = await decryptValue(raw);
    } else {
      // Plaintext key found — encrypt and re-save
      cache[storageKey] = raw;
      try {
        const encrypted = await encryptValue(raw);
        localStorage.setItem(storageKey, encrypted);
      } catch (err) {
        console.warn("[apiKeyStore] Failed to encrypt key, removing plaintext:", err);
        localStorage.removeItem(storageKey);
      }
    }
  }

  // Notify listeners that cache is ready
  cacheReadyResolve?.();
  cacheListeners.forEach((fn) => fn());
  cacheListeners.length = 0;
}

// Eagerly load cache
if (typeof window !== "undefined") {
  loadCache();
}

// ── Per-provider helpers ───────────────────────────

export function getApiKeyForProvider(provider: Provider): string | null {
  if (typeof window === "undefined") return null;
  // Return from cache (sync)
  const storageKey = STORAGE_KEYS[provider];
  if (storageKey in cache) return cache[storageKey];
  // Fallback: read raw (before cache is loaded)
  const raw = localStorage.getItem(storageKey);
  if (!raw) return null;
  if (!isEncrypted(raw)) return raw;
  return null; // encrypted but cache not ready yet
}

export async function setApiKeyForProvider(provider: Provider, key: string): Promise<void> {
  const storageKey = STORAGE_KEYS[provider];
  cache[storageKey] = key;
  try {
    const encrypted = await encryptValue(key);
    localStorage.setItem(storageKey, encrypted);
  } catch (err) {
    console.warn("[apiKeyStore] Encryption failed, not saving key:", err);
    // Do NOT fall back to plaintext — key stays in memory cache only
  }
}

export function clearApiKeyForProvider(provider: Provider): void {
  const storageKey = STORAGE_KEYS[provider];
  cache[storageKey] = null;
  localStorage.removeItem(storageKey);
}

export function hasAnyApiKey(): boolean {
  if (typeof window === "undefined") return false;
  return Object.values(STORAGE_KEYS).some((k) => !!cache[k] || !!localStorage.getItem(k));
}

export function validateApiKey(provider: Provider, key: string): string | null {
  const trimmed = key.trim();
  if (!trimmed) return "APIキーを入力してください";
  switch (provider) {
    case "anthropic":
      if (!trimmed.startsWith("sk-ant-")) return "Anthropic APIキーは sk-ant- で始まる必要があります";
      if (trimmed.length < 20) return "Anthropic APIキーが短すぎます";
      break;
    case "openai":
      if (!trimmed.startsWith("sk-")) return "OpenAI APIキーは sk- で始まる必要があります";
      if (trimmed.length < 20) return "OpenAI APIキーが短すぎます";
      break;
    case "google":
      if (trimmed.length < 30) return "Google APIキーが短すぎます";
      break;
  }
  return null;
}

// ── Google fallback (paid) key ───────────────────────

const GOOGLE_FALLBACK_KEY = "mazelan_google_api_key_paid";

export function getGoogleFallbackKey(): string | null {
  if (typeof window === "undefined") return null;
  if (GOOGLE_FALLBACK_KEY in cache) return cache[GOOGLE_FALLBACK_KEY];
  const raw = localStorage.getItem(GOOGLE_FALLBACK_KEY);
  if (!raw) return null;
  if (!isEncrypted(raw)) return raw;
  return null;
}

export async function setGoogleFallbackKey(key: string): Promise<void> {
  cache[GOOGLE_FALLBACK_KEY] = key;
  try {
    const encrypted = await encryptValue(key);
    localStorage.setItem(GOOGLE_FALLBACK_KEY, encrypted);
  } catch (err) {
    console.warn("[apiKeyStore] Encryption failed for fallback key:", err);
  }
}

export function clearGoogleFallbackKey(): void {
  cache[GOOGLE_FALLBACK_KEY] = null;
  localStorage.removeItem(GOOGLE_FALLBACK_KEY);
}

// ── Backward-compatible (Anthropic only) ───────────

export function getApiKey(): string | null {
  return getApiKeyForProvider("anthropic");
}

export async function setApiKey(key: string): Promise<void> {
  await setApiKeyForProvider("anthropic", key);
}

export function clearApiKey(): void {
  clearApiKeyForProvider("anthropic");
}
