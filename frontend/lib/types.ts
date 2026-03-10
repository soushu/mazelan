export type Session = {
  id: string;
  title: string;
  created_at: string;
};

export type Message = {
  role: "user" | "assistant";
  content: string;
  created_at: string;
};
