import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["DM Sans", "sans-serif"],
        mono: ["DM Mono", "monospace"],
      },
      colors: {
        background: "#020509",
        theme: {
          base: "var(--color-bg-base)",
          surface: "var(--color-bg-surface)",
          elevated: "var(--color-bg-elevated)",
          hover: "var(--color-bg-hover)",
          active: "var(--color-bg-active)",
          input: "var(--color-bg-input)",
          "user-bubble": "var(--color-bg-user-bubble)",
          "assistant-bubble": "var(--color-bg-assistant-bubble)",
          avatar: "var(--color-bg-avatar)",
          overlay: "var(--color-bg-overlay)",
        },
        border: {
          primary: "var(--color-border-primary)",
          secondary: "var(--color-border-secondary)",
          input: "var(--color-border-input)",
        },
        t: {
          primary: "var(--color-text-primary)",
          secondary: "var(--color-text-secondary)",
          tertiary: "var(--color-text-tertiary)",
          muted: "var(--color-text-muted)",
          faint: "var(--color-text-faint)",
          placeholder: "var(--color-text-placeholder)",
          "user-bubble": "var(--color-text-user-bubble)",
        },
        accent: {
          DEFAULT: "var(--color-accent)",
          hover: "var(--color-accent-hover)",
        },
        danger: "var(--color-danger)",
        success: "var(--color-success)",
        "code-bg": "var(--color-code-bg)",
        "code-text": "var(--color-code-text)",
        "spinner-track": "var(--color-spinner-track)",
        "spinner-fill": "var(--color-spinner-fill)",
        divider: "var(--color-divider)",
      },
    },
  },
  plugins: [],
};

export default config;
