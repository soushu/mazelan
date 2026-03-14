export type Provider = "anthropic" | "openai" | "google";

export type ModelId =
  | "claude-opus-4-6"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5-20251001"
  | "gpt-4o"
  | "gpt-4o-mini"
  | "o3-mini"
  | "gemini-2.5-flash"
  | "gemini-2.5-pro"
  | "gemini-3.1-flash-lite";

export type ModelOption = { id: ModelId; label: string; supports_thinking?: boolean };

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
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", supports_thinking: true },
      { id: "claude-opus-4-6", label: "Claude Opus 4.6", supports_thinking: true },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", supports_thinking: true },
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
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", supports_thinking: true },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", supports_thinking: true },
      { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite" },
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
  is_starred: boolean;
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
  model?: string;
};

/** Get provider from a model ID stored in the message (handles debate format too) */
export function getProviderFromModelId(modelId: string | undefined): Provider | null {
  if (!modelId) return null;
  if (modelId.startsWith("debate:")) return null;
  for (const group of MODEL_GROUPS) {
    if (group.models.some((m) => m.id === modelId)) return group.provider;
  }
  return null;
}

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

export type DebateStepId =
  | "model_a_answer"
  | "model_b_answer"
  | "model_a_critique"
  | "model_b_critique"
  | "final";

export type DebateStep = {
  id: DebateStepId;
  content: string;
};

export type DebateData = {
  modelA: string;
  modelB: string;
  steps: DebateStep[];
};

/** Parse debate content from <!--DEBATE:...--> format */
export function parseDebateContent(content: string): DebateData | null {
  const headerMatch = content.match(/^<!--DEBATE:([^:]+):(.+?)-->/);
  if (!headerMatch) return null;

  const modelA = headerMatch[1];
  const modelB = headerMatch[2];

  const stepIds: DebateStepId[] = [
    "model_a_answer", "model_b_answer",
    "model_a_critique", "model_b_critique",
    "final",
  ];

  const steps: DebateStep[] = [];
  for (let i = 0; i < stepIds.length; i++) {
    const stepId = stepIds[i];
    const marker = `<!--STEP:${stepId}-->`;
    const startIdx = content.indexOf(marker);
    if (startIdx === -1) continue;

    const contentStart = startIdx + marker.length + 1; // +1 for newline
    const nextMarker = i < stepIds.length - 1 ? `<!--STEP:${stepIds[i + 1]}-->` : null;
    const endIdx = nextMarker ? content.indexOf(nextMarker) : content.length;

    steps.push({
      id: stepId,
      content: content.slice(contentStart, endIdx).trim(),
    });
  }

  return { modelA, modelB, steps };
}

/** Get model label from MODEL_REGISTRY */
export function getModelLabel(modelId: string): string {
  for (const group of MODEL_GROUPS) {
    const model = group.models.find((m) => m.id === modelId);
    if (model) return model.label;
  }
  return modelId;
}
