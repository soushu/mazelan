"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";

export type Theme = "dark" | "light-blue" | "light-cyan";

const THEMES: Theme[] = ["dark", "light-blue", "light-cyan"];

const THEME_LABELS: Record<Theme, string> = {
  dark: "Dark",
  "light-blue": "Sky Blue",
  "light-cyan": "Cyan",
};

type ThemeContextValue = {
  theme: Theme;
  toggleTheme: () => void;
  themeLabel: string;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  toggleTheme: () => {},
  themeLabel: "Dark",
});

const STORAGE_KEY = "claudia-theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");

  // Read from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (stored && THEMES.includes(stored)) {
      setTheme(stored);
    }
  }, []);

  // Sync class on <html> whenever theme changes
  useEffect(() => {
    const root = document.documentElement;
    // Remove all theme classes
    root.classList.remove(...THEMES);
    // Add current theme class (dark has no class)
    if (theme !== "dark") {
      root.classList.add(theme);
    }
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const idx = THEMES.indexOf(prev);
      return THEMES[(idx + 1) % THEMES.length];
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, themeLabel: THEME_LABELS[theme] }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
