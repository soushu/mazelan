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

// Migrate old keys on first access
let migrated = false;
function migrateKeys(): void {
  if (migrated || typeof window === "undefined") return;
  migrated = true;
  for (const provider of Object.keys(OLD_STORAGE_KEYS) as Provider[]) {
    const oldKey = localStorage.getItem(OLD_STORAGE_KEYS[provider]);
    if (oldKey && !localStorage.getItem(STORAGE_KEYS[provider])) {
      localStorage.setItem(STORAGE_KEYS[provider], oldKey);
      localStorage.removeItem(OLD_STORAGE_KEYS[provider]);
    }
  }
}

// ── Per-provider helpers ───────────────────────────

export function getApiKeyForProvider(provider: Provider): string | null {
  if (typeof window === "undefined") return null;
  migrateKeys();
  return localStorage.getItem(STORAGE_KEYS[provider]);
}

export function setApiKeyForProvider(provider: Provider, key: string): void {
  localStorage.setItem(STORAGE_KEYS[provider], key);
}

export function clearApiKeyForProvider(provider: Provider): void {
  localStorage.removeItem(STORAGE_KEYS[provider]);
}

export function hasAnyApiKey(): boolean {
  if (typeof window === "undefined") return false;
  return Object.values(STORAGE_KEYS).some((k) => !!localStorage.getItem(k));
}

export function validateApiKey(provider: Provider, key: string): string | null {
  const trimmed = key.trim();
  if (!trimmed) return "APIキーを入力してください";
  switch (provider) {
    case "anthropic":
      if (!trimmed.startsWith("sk-ant-")) return "Anthropic APIキーは sk-ant- で始まる必要があります";
      break;
    case "openai":
      if (!trimmed.startsWith("sk-")) return "OpenAI APIキーは sk- で始まる必要があります";
      break;
    case "google":
      if (trimmed.length < 10) return "Google APIキーが短すぎます";
      break;
  }
  return null;
}

// ── Backward-compatible (Anthropic only) ───────────

export function getApiKey(): string | null {
  return getApiKeyForProvider("anthropic");
}

export function setApiKey(key: string): void {
  setApiKeyForProvider("anthropic", key);
}

export function clearApiKey(): void {
  clearApiKeyForProvider("anthropic");
}
