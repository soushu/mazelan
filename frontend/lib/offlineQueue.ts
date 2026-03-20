/**
 * Offline operation queue for session management.
 * Queues star/delete/rename operations when offline, replays on reconnect.
 */

type OfflineOperation =
  | { type: "delete"; sessionId: string; timestamp: number }
  | { type: "star"; sessionId: string; timestamp: number }
  | { type: "rename"; sessionId: string; title: string; timestamp: number };

const QUEUE_KEY = "mazelan_offline_queue";

function getQueue(): OfflineOperation[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: OfflineOperation[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {}
}

type OfflineInput =
  | { type: "delete"; sessionId: string }
  | { type: "star"; sessionId: string }
  | { type: "rename"; sessionId: string; title: string };

export function enqueue(op: OfflineInput): void {
  const queue = getQueue();
  const entry = { ...op, timestamp: Date.now() } as OfflineOperation;

  if (entry.type === "delete") {
    // Delete wins: remove all prior ops for this session
    const filtered = queue.filter((o) => o.sessionId !== entry.sessionId);
    filtered.push(entry);
    saveQueue(filtered);
    return;
  }

  // Skip if delete already queued for this session
  if (queue.some((o) => o.type === "delete" && o.sessionId === entry.sessionId)) {
    return;
  }

  if (entry.type === "rename") {
    // Last write wins: replace prior rename
    const filtered = queue.filter(
      (o) => !(o.type === "rename" && o.sessionId === entry.sessionId)
    );
    filtered.push(entry);
    saveQueue(filtered);
    return;
  }

  if (entry.type === "star") {
    // Toggle: odd count = keep one, even count = cancel out
    const starCount = queue.filter(
      (o) => o.type === "star" && o.sessionId === entry.sessionId
    ).length;
    if (starCount % 2 === 0) {
      queue.push(entry);
    } else {
      const lastIdx = queue.findLastIndex(
        (o) => o.type === "star" && o.sessionId === entry.sessionId
      );
      if (lastIdx >= 0) queue.splice(lastIdx, 1);
    }
    saveQueue(queue);
  }
}

export async function processQueue(): Promise<void> {
  const queue = getQueue();
  if (queue.length === 0) return;

  const { deleteSession, updateSession, toggleSessionStar } = await import("./api");

  const failed: OfflineOperation[] = [];

  for (const op of queue) {
    try {
      switch (op.type) {
        case "delete":
          await deleteSession(op.sessionId);
          break;
        case "rename":
          await updateSession(op.sessionId, op.title);
          break;
        case "star":
          await toggleSessionStar(op.sessionId);
          break;
      }
    } catch {
      failed.push(op);
    }
  }

  saveQueue(failed);
}
