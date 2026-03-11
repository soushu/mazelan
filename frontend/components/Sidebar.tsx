"use client";

import { useState, useEffect } from "react";
import { signOut } from "next-auth/react";
import type { Session } from "@/lib/types";
import { getApiKey } from "@/lib/apiKeyStore";
import { useTheme } from "@/lib/themeContext";

type Props = {
  sessions: Session[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  userEmail?: string;
  onOpenApiKeyModal: () => void;
  apiKeyModalOpen: boolean;
  open: boolean;
  onClose: () => void;
  loading?: boolean;
};

export default function Sidebar({ sessions, activeId, onSelect, onDelete, onNew, userEmail, onOpenApiKeyModal, apiKeyModalOpen, open, onClose, loading }: Props) {
  const [query, setQuery] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const { theme, toggleTheme, themeLabel } = useTheme();

  // Refresh API key status on mount and when modal closes
  useEffect(() => {
    if (!apiKeyModalOpen) {
      setHasApiKey(!!getApiKey());
    }
  }, [apiKeyModalOpen]);

  const filtered = sessions.filter((s) =>
    s.title.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <>
      {/* Backdrop overlay (mobile only) */}
      <div
        className={`fixed inset-0 z-40 bg-theme-overlay transition-opacity duration-300 md:hidden ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 flex-shrink-0 flex flex-col h-dvh bg-theme-surface border-r border-border-primary transition-transform duration-300 ease-in-out md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="p-4 border-b border-border-primary flex items-center justify-between">
          <h1 className="text-lg font-semibold text-t-primary">claudia</h1>
          {/* Close button (mobile only) */}
          <button
            onClick={onClose}
            className="md:hidden p-1 text-t-tertiary hover:text-t-secondary transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* New chat button */}
        <div className="px-4 pt-3 pb-1">
          <button
            onClick={onNew}
            className="w-full py-2 px-3 rounded-lg bg-theme-hover hover:bg-theme-active text-t-secondary text-sm transition-colors"
          >
            + New
          </button>
        </div>

        {/* Search */}
        <div className="p-3 border-b border-border-primary">
          <input
            type="text"
            placeholder="Search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-theme-input text-t-secondary placeholder-t-placeholder text-sm px-3 py-2 rounded-lg outline-none focus:ring-1 focus:ring-border-secondary"
          />
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto py-2">
          {loading ? (
            <div className="flex justify-center mt-8">
              <div className="w-5 h-5 border-2 border-spinner-track border-t-spinner-fill rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-t-muted text-sm text-center mt-8">No history</p>
          ) : (
            filtered.map((s) => (
              <div
                key={s.id}
                className={`group flex items-center gap-2 px-3 py-3 md:py-2 mx-2 rounded-lg cursor-pointer transition-colors ${
                  activeId === s.id
                    ? "bg-theme-active text-t-primary"
                    : "text-t-tertiary hover:bg-theme-hover hover:text-t-secondary"
                }`}
                onClick={() => onSelect(s.id)}
              >
                <span className="flex-1 text-sm truncate">{s.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(s.id);
                  }}
                  className="md:opacity-0 md:group-hover:opacity-100 text-t-muted hover:text-danger transition-opacity text-xs p-1"
                >
                  X
                </button>
              </div>
            ))
          )}
        </div>

        {/* User info */}
        {userEmail && (
          <div className="p-3 border-t border-border-primary">
            <p className="text-xs text-t-muted truncate mb-2">{userEmail}</p>
            <button
              onClick={onOpenApiKeyModal}
              className="w-full py-1.5 px-3 rounded-lg text-t-tertiary hover:bg-theme-hover hover:text-t-secondary text-sm transition-colors flex items-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.992 6.992 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clipRule="evenodd" />
              </svg>
              API Key
              {hasApiKey && <span className="ml-auto w-2 h-2 rounded-full bg-success" />}
            </button>
            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="w-full py-1.5 px-3 rounded-lg text-t-tertiary hover:bg-theme-hover hover:text-t-secondary text-sm transition-colors mt-1 flex items-center gap-2"
            >
              {theme === "dark" ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path fillRule="evenodd" d="M7.455 2.004a.75.75 0 0 1 .26.77 7 7 0 0 0 9.958 7.967.75.75 0 0 1 1.067.853A8.5 8.5 0 1 1 6.647 1.921a.75.75 0 0 1 .808.083Z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path d="M10 2a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 2ZM10 15a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 15ZM10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM15.657 5.404a.75.75 0 1 0-1.06-1.06l-1.061 1.06a.75.75 0 0 0 1.06 1.06l1.06-1.06ZM6.464 14.596a.75.75 0 1 0-1.06-1.06l-1.06 1.06a.75.75 0 0 0 1.06 1.06l1.06-1.06ZM18 10a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 18 10ZM5 10a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 5 10ZM14.596 15.657a.75.75 0 0 0 1.06-1.06l-1.06-1.061a.75.75 0 1 0-1.06 1.06l1.06 1.06ZM5.404 6.464a.75.75 0 0 0 1.06-1.06l-1.06-1.06a.75.75 0 1 0-1.06 1.06l1.06 1.06Z" />
                </svg>
              )}
              Theme: {themeLabel}
            </button>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="w-full py-1.5 px-3 rounded-lg text-t-tertiary hover:bg-theme-hover hover:text-t-secondary text-sm transition-colors mt-1"
            >
              Sign out
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
