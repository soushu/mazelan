import type { Session, Message } from "./types";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

// 仮の user_id（STEP5 で認証後に差し替え）
const TEMP_USER_ID = "00000000-0000-0000-0000-000000000001";

export async function createSession(title: string): Promise<Session> {
  const res = await fetch(
    `${BACKEND}/sessions?user_id=${TEMP_USER_ID}&title=${encodeURIComponent(title)}`,
    { method: "POST" }
  );
  if (!res.ok) throw new Error("Failed to create session");
  return res.json();
}

export async function listSessions(): Promise<Session[]> {
  const res = await fetch(`${BACKEND}/sessions?user_id=${TEMP_USER_ID}`);
  if (!res.ok) throw new Error("Failed to fetch sessions");
  return res.json();
}

export async function getMessages(sessionId: string): Promise<Message[]> {
  const res = await fetch(`${BACKEND}/sessions/${sessionId}/messages`);
  if (!res.ok) throw new Error("Failed to fetch messages");
  return res.json();
}

export async function deleteSession(sessionId: string): Promise<void> {
  await fetch(`${BACKEND}/sessions/${sessionId}`, { method: "DELETE" });
}

export async function* streamChat(
  sessionId: string,
  content: string
): AsyncGenerator<string> {
  const res = await fetch(`${BACKEND}/chat/${sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok || !res.body) throw new Error("Stream failed");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    yield decoder.decode(value, { stream: true });
  }
}
