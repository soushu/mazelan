import type { Session, Message, ImageAttachment, ModelId, SystemPromptResponse, ContextItem, ContextsResponse } from "./types";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

export async function createSession(title: string): Promise<Session> {
  const res = await fetch(
    `${BACKEND}/sessions?title=${encodeURIComponent(title)}`,
    { method: "POST", credentials: "include" }
  );
  if (!res.ok) throw new Error("Failed to create session");
  return res.json();
}

export async function listSessions(): Promise<Session[]> {
  const res = await fetch(`${BACKEND}/sessions`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch sessions");
  return res.json();
}

export async function getMessages(sessionId: string): Promise<Message[]> {
  const res = await fetch(`${BACKEND}/sessions/${sessionId}/messages`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch messages");
  return res.json();
}

export async function updateSession(sessionId: string, title: string): Promise<Session> {
  const res = await fetch(`${BACKEND}/sessions/${sessionId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to update session");
  return res.json();
}

export async function toggleSessionStar(sessionId: string): Promise<Session> {
  const res = await fetch(`${BACKEND}/sessions/${sessionId}/star`, {
    method: "PUT",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to toggle star");
  return res.json();
}

export async function deleteSession(sessionId: string): Promise<void> {
  await fetch(`${BACKEND}/sessions/${sessionId}`, {
    method: "DELETE",
    credentials: "include",
  });
}

export async function forkSession(sessionId: string, pairIndex: number): Promise<Session> {
  const res = await fetch(`${BACKEND}/sessions/${sessionId}/fork`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ pair_index: pairIndex }),
  });
  return res.json();
}

export async function* streamChat(
  sessionId: string,
  content: string,
  images?: ImageAttachment[],
  apiKey?: string | null,
  model?: ModelId,
  anthropicKey?: string | null,
  thinking?: boolean,
  googleFallbackKey?: string | null,
): AsyncGenerator<string> {
  const body: Record<string, unknown> = { content };
  if (model) {
    body.model = model;
  }
  if (thinking) {
    body.thinking = true;
  }
  if (images && images.length > 0) {
    body.images = images.map(({ media_type, data }) => ({ media_type, data }));
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }
  if (anthropicKey) {
    headers["X-Anthropic-Key"] = anthropicKey;
  }
  if (googleFallbackKey) {
    headers["X-Google-Fallback-Key"] = googleFallbackKey;
  }
  const res = await fetch(`${BACKEND}/chat/${sessionId}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    credentials: "include",
  });
  if (!res.ok || !res.body) {
    if (res.status === 401) throw new Error("API_KEY_INVALID");
    if (res.status === 422) {
      try {
        const detail = await res.json();
        const msg = detail?.detail?.[0]?.msg || "Validation error";
        throw new Error(`VALIDATION: ${msg}`);
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("VALIDATION:")) throw e;
      }
    }
    throw new Error("Stream failed");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    yield decoder.decode(value, { stream: true });
  }
}

export async function getUserSystemPrompt(): Promise<SystemPromptResponse> {
  const res = await fetch(`${BACKEND}/sessions/user/system-prompt`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch system prompt");
  return res.json();
}

export async function updateUserSystemPrompt(systemPrompt: string | null): Promise<SystemPromptResponse> {
  const res = await fetch(`${BACKEND}/sessions/user/system-prompt`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system_prompt: systemPrompt }),
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to update system prompt");
  return res.json();
}

export async function getSessionSystemPrompt(sessionId: string): Promise<SystemPromptResponse> {
  const res = await fetch(`${BACKEND}/sessions/${sessionId}/system-prompt`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch session system prompt");
  return res.json();
}

export async function updateSessionSystemPrompt(sessionId: string, systemPrompt: string | null): Promise<SystemPromptResponse> {
  const res = await fetch(`${BACKEND}/sessions/${sessionId}/system-prompt`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system_prompt: systemPrompt }),
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to update session system prompt");
  return res.json();
}

// ---- Debate Mode ----

export async function* streamDebate(
  sessionId: string,
  content: string,
  modelA: ModelId,
  modelB: ModelId,
  apiKeyA?: string | null,
  apiKeyB?: string | null,
  images?: ImageAttachment[],
  anthropicKey?: string | null,
  thinking?: boolean,
  googleFallbackKey?: string | null,
): AsyncGenerator<string> {
  const body: Record<string, unknown> = { content, model_a: modelA, model_b: modelB };
  if (thinking) {
    body.thinking = true;
  }
  if (images && images.length > 0) {
    body.images = images.map(({ media_type, data }) => ({ media_type, data }));
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKeyA) headers["X-API-Key-A"] = apiKeyA;
  if (apiKeyB) headers["X-API-Key-B"] = apiKeyB;
  if (anthropicKey) headers["X-Anthropic-Key"] = anthropicKey;
  if (googleFallbackKey) headers["X-Google-Fallback-Key"] = googleFallbackKey;

  const res = await fetch(`${BACKEND}/debate/${sessionId}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    credentials: "include",
  });
  if (!res.ok || !res.body) {
    if (res.status === 401) throw new Error("API_KEY_INVALID");
    if (res.status === 422) {
      try {
        const detail = await res.json();
        const msg = detail?.detail?.[0]?.msg || "Validation error";
        throw new Error(`VALIDATION: ${msg}`);
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("VALIDATION:")) throw e;
      }
    }
    throw new Error("Stream failed");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    yield decoder.decode(value, { stream: true });
  }
}

// ---- Context Memory ----

export async function listContexts(): Promise<ContextsResponse> {
  const res = await fetch(`${BACKEND}/contexts`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch contexts");
  return res.json();
}

export async function createContext(content: string, category: string): Promise<ContextItem> {
  const res = await fetch(`${BACKEND}/contexts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, category }),
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to create context");
  return res.json();
}

export async function updateContext(id: string, data: { content?: string; category?: string }): Promise<ContextItem> {
  const res = await fetch(`${BACKEND}/contexts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to update context");
  return res.json();
}

export async function deleteContext(id: string): Promise<void> {
  await fetch(`${BACKEND}/contexts/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
}

export async function toggleContext(id: string): Promise<ContextItem> {
  const res = await fetch(`${BACKEND}/contexts/${id}/toggle`, {
    method: "PATCH",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to toggle context");
  return res.json();
}

export async function deleteAccount(): Promise<void> {
  const res = await fetch(`${BACKEND}/auth/account`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to delete account");
}
