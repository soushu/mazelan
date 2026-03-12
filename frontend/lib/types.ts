export type Provider = "anthropic" | "openai" | "google";

export type ModelId =
  | "claude-opus-4-6"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5-20251001"
  | "gpt-4o"
  | "gpt-4o-mini"
  | "o3-mini"
  | "gemini-2.0-flash"
  | "gemini-2.0-pro"
  | "gemini-2.5-pro";

export type ModelOption = { id: ModelId; label: string };

export type ModelGroup = {
  provider: Provider;
  label: string;
  models: ModelOption[];
};

export const MODEL_GROUPS: ModelGroup[] = [
  {
    provider: "anthropic",
    label: "Anthropic",
    models: [
      { id: "claude-sonnet-4-6", label: "Claude Sonnet" },
      { id: "claude-opus-4-6", label: "Claude Opus" },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku" },
    ],
  },
  {
    provider: "openai",
    label: "OpenAI",
    models: [
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "gpt-4o-mini", label: "GPT-4o mini" },
      { id: "o3-mini", label: "o3-mini" },
    ],
  },
  {
    provider: "google",
    label: "Google",
    models: [
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
      { id: "gemini-2.0-pro", label: "Gemini 2.0 Pro" },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    ],
  },
];

// Backward-compatible flat list
export const MODEL_OPTIONS: ModelOption[] = MODEL_GROUPS.flatMap((g) => g.models);

export function getProviderForModel(modelId: ModelId): Provider {
  for (const group of MODEL_GROUPS) {
    if (group.models.some((m) => m.id === modelId)) return group.provider;
  }
  return "anthropic";
}

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

export type SystemPromptResponse = {
  system_prompt: string | null;
};

export type ContextItem = {
  id: string;
  content: string;
  category: string;
  source: "auto" | "manual";
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ContextsResponse = {
  contexts: Record<string, ContextItem[]>;
  total: number;
};
