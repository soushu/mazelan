import type { Session, Message, ImageAttachment } from "./types";

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

export async function deleteSession(sessionId: string): Promise<void> {
  await fetch(`${BACKEND}/sessions/${sessionId}`, {
    method: "DELETE",
    credentials: "include",
  });
}

export async function* streamChat(
  sessionId: string,
  content: string,
  images?: ImageAttachment[],
  apiKey?: string | null
): AsyncGenerator<string> {
  const body: Record<string, unknown> = { content };
  if (images && images.length > 0) {
    body.images = images.map(({ media_type, data }) => ({ media_type, data }));
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }
  const res = await fetch(`${BACKEND}/chat/${sessionId}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    credentials: "include",
  });
  if (!res.ok || !res.body) {
    if (res.status === 401) throw new Error("API_KEY_INVALID");
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
