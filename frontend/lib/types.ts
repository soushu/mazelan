export type ModelId = "claude-opus-4-6" | "claude-sonnet-4-6" | "claude-haiku-4-5-20251001";

export const MODEL_OPTIONS: { id: ModelId; label: string }[] = [
  { id: "claude-sonnet-4-6", label: "Sonnet" },
  { id: "claude-opus-4-6", label: "Opus" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku" },
];

export type Session = {
  id: string;
  title: string;
  created_at: string;
};

export type ImageAttachment = {
  media_type: string;
  data: string;
  preview_url?: string;
};

export type Message = {
  role: "user" | "assistant";
  content: string;
  created_at: string;
  images?: ImageAttachment[];
};

export type QAPair = {
  user: Message;
  assistant: Message | null;
};
