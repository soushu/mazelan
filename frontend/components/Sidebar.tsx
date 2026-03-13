"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { signOut } from "next-auth/react";
import type { Session } from "@/lib/types";
import { hasAnyApiKey as checkAnyApiKey } from "@/lib/apiKeyStore";
import { useTheme } from "@/lib/themeContext";

type Props = {
  sessions: Session[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, newTitle: string) => void;
  onNew: () => void;
  userEmail?: string;
  onOpenApiKeyModal: () => void;
  onOpenSystemPromptModal: () => void;
  onOpenContextModal: () => void;
  apiKeyModalOpen: boolean;
  open: boolean;
  onClose: () => void;
  loading?: boolean;
};

export default function Sidebar({ sessions, activeId, onSelect, onDelete, onRename, onNew, userEmail, onOpenApiKeyModal, onOpenSystemPromptModal, onOpenContextModal, apiKeyModalOpen, open, onClose, loading }: Props) {
  const [query, setQuery] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const { theme, toggleTheme, themeLabel } = useTheme();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const menuRef = useRef<HTMLDivElement>(null);
  const menuHeight = 148; // approximate menu height in px

  const openMenu = useCallback((sessionId: string, buttonEl: HTMLButtonElement) => {
    if (menuOpenId === sessionId) {
      setMenuOpenId(null);
      return;
    }
    const rect = buttonEl.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const flipUp = spaceBelow < menuHeight + 8;
    // Align menu's right edge to button's right edge using left
    const menuWidth = 140;
    const left = rect.right - menuWidth;
    setMenuStyle(flipUp
      ? { bottom: window.innerHeight - rect.top + 4, left }
      : { top: rect.bottom + 4, left }
    );
    setMenuOpenId(sessionId);
  }, [menuOpenId]);

  // Refresh API key status on mount and when modal closes
  useEffect(() => {
    if (!apiKeyModalOpen) {
      setHasApiKey(checkAnyApiKey());
    }
  }, [apiKeyModalOpen]);

  // Close menu on outside click or scroll
  useEffect(() => {
    if (!menuOpenId) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    const handleScroll = () => setMenuOpenId(null);
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [menuOpenId]);

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
                className={`group relative flex items-center gap-2 px-3 py-3 md:py-2 mx-2 rounded-lg cursor-pointer transition-colors ${
                  activeId === s.id
                    ? "bg-theme-active text-t-primary"
                    : "text-t-tertiary hover:bg-theme-hover hover:text-t-secondary"
                }`}
                onClick={() => {
                  if (editingId !== s.id) onSelect(s.id);
                }}
              >
                {editingId === s.id ? (
                  <input
                    type="text"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const trimmed = editingTitle.trim();
                        if (trimmed) onRename(s.id, trimmed);
                        setEditingId(null);
                      } else if (e.key === "Escape") {
                        setEditingId(null);
                      }
                    }}
                    onBlur={() => {
                      const trimmed = editingTitle.trim();
                      if (trimmed && trimmed !== s.title) onRename(s.id, trimmed);
                      setEditingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                    className="flex-1 text-sm bg-theme-input text-t-primary px-1 py-0 rounded outline-none focus:ring-1 focus:ring-border-secondary min-w-0"
                  />
                ) : (
                  <>
                    <span className="flex-1 text-sm truncate">{s.title}</span>
                    {/* Three-dot menu button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openMenu(s.id, e.currentTarget);
                      }}
                      className={`${menuOpenId === s.id ? "opacity-100" : "md:opacity-0 md:group-hover:opacity-100"} text-t-muted hover:text-t-secondary transition-opacity text-sm p-1 flex-shrink-0`}
                    >
                      <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                        <circle cx="8" cy="3" r="1.5" />
                        <circle cx="8" cy="8" r="1.5" />
                        <circle cx="8" cy="13" r="1.5" />
                      </svg>
                    </button>
                  </>
                )}

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
            {/* System Prompt */}
            <button
              onClick={onOpenSystemPromptModal}
              className="w-full py-1.5 px-3 rounded-lg text-t-tertiary hover:bg-theme-hover hover:text-t-secondary text-sm transition-colors mt-1 flex items-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M4.5 2A2.5 2.5 0 0 0 2 4.5v3.879a2.5 2.5 0 0 0 .732 1.767l7.5 7.5a2.5 2.5 0 0 0 3.536 0l3.878-3.878a2.5 2.5 0 0 0 0-3.536l-7.5-7.5A2.5 2.5 0 0 0 8.38 2H4.5ZM5 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
              </svg>
              System Prompt
            </button>
            {/* Context Memory */}
            <button
              onClick={onOpenContextModal}
              className="w-full py-1.5 px-3 rounded-lg text-t-tertiary hover:bg-theme-hover hover:text-t-secondary text-sm transition-colors mt-1 flex items-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path d="M10 1a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 1ZM5.05 3.05a.75.75 0 0 1 1.06 0l1.062 1.06A.75.75 0 1 1 6.11 5.173L5.05 4.11a.75.75 0 0 1 0-1.06ZM14.95 3.05a.75.75 0 0 1 0 1.06l-1.06 1.062a.75.75 0 0 1-1.062-1.061l1.061-1.06a.75.75 0 0 1 1.06 0ZM3 8a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5A.75.75 0 0 1 3 8ZM14 8a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5A.75.75 0 0 1 14 8ZM7.172 13.828a.75.75 0 0 1-1.061-1.06l1.06-1.06a.75.75 0 0 1 1.061 1.06l-1.06 1.06ZM10.828 10.172a.75.75 0 0 1 0 1.061l1.06 1.06a.75.75 0 1 1-1.06 1.06l-1.06-1.06a.75.75 0 0 1 0-1.06l1.06-1.061ZM10 14a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 14ZM10 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
              </svg>
              Context Memory
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
        {/* Fixed-position dropdown menu (rendered outside scroll container) */}
        {menuOpenId && (
          <div
            ref={menuRef}
            className="fixed z-[60] min-w-[140px] bg-theme-elevated rounded-lg shadow-lg border border-border-primary py-1"
            style={menuStyle}
          >
            <button
              className="w-full px-3 py-2 text-sm text-t-secondary hover:bg-theme-hover flex items-center gap-2 text-left"
              onClick={(e) => {
                e.stopPropagation();
                const id = menuOpenId;
                const session = sessions.find((s) => s.id === id);
                setMenuOpenId(null);
                if (session) {
                  setEditingId(id);
                  setEditingTitle(session.title);
                }
              }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
              </svg>
              Rename
            </button>
            <button
              className="w-full px-3 py-2 text-sm text-t-secondary hover:bg-theme-hover flex items-center gap-2 text-left opacity-50 cursor-not-allowed"
              onClick={(e) => {
                e.stopPropagation();
                // TODO: Star feature (backend not implemented yet)
                setMenuOpenId(null);
              }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
              </svg>
              Star
            </button>
            <div className="border-t border-border-primary my-1" />
            <button
              className="w-full px-3 py-2 text-sm text-danger hover:bg-theme-hover flex items-center gap-2 text-left"
              onClick={(e) => {
                e.stopPropagation();
                const id = menuOpenId;
                setMenuOpenId(null);
                onDelete(id);
              }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
              Delete
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
