"use client";

import { useState, useEffect } from "react";
import { signOut } from "next-auth/react";
import type { Session } from "@/lib/types";
import { getApiKey } from "@/lib/apiKeyStore";

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
};

export default function Sidebar({ sessions, activeId, onSelect, onDelete, onNew, userEmail, onOpenApiKeyModal, apiKeyModalOpen, open, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);

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
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity duration-300 md:hidden ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 flex-shrink-0 flex flex-col h-screen bg-slate-900 border-r border-slate-800 transition-transform duration-300 ease-in-out md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-slate-100">claudia</h1>
          {/* Close button (mobile only) */}
          <button
            onClick={onClose}
            className="md:hidden p-1 text-slate-400 hover:text-slate-200 transition-colors"
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
            className="w-full py-2 px-3 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm transition-colors"
          >
            + New
          </button>
        </div>

        {/* Search */}
        <div className="p-3 border-b border-slate-800">
          <input
            type="text"
            placeholder="Search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-slate-800 text-slate-200 placeholder-slate-500 text-sm px-3 py-2 rounded-lg outline-none focus:ring-1 focus:ring-slate-600"
          />
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <p className="text-slate-500 text-sm text-center mt-8">No history</p>
          ) : (
            filtered.map((s) => (
              <div
                key={s.id}
                className={`group flex items-center gap-2 px-3 py-3 md:py-2 mx-2 rounded-lg cursor-pointer transition-colors ${
                  activeId === s.id
                    ? "bg-slate-700 text-slate-100"
                    : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                }`}
                onClick={() => onSelect(s.id)}
              >
                <span className="flex-1 text-sm truncate">{s.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(s.id);
                  }}
                  className="md:opacity-0 md:group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-opacity text-xs p-1"
                >
                  X
                </button>
              </div>
            ))
          )}
        </div>

        {/* User info */}
        {userEmail && (
          <div className="p-3 border-t border-slate-800">
            <p className="text-xs text-slate-500 truncate mb-2">{userEmail}</p>
            <button
              onClick={onOpenApiKeyModal}
              className="w-full py-1.5 px-3 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-200 text-sm transition-colors flex items-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.992 6.992 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clipRule="evenodd" />
              </svg>
              API Key
              {hasApiKey && <span className="ml-auto w-2 h-2 rounded-full bg-green-500" />}
            </button>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="w-full py-1.5 px-3 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-200 text-sm transition-colors mt-1"
            >
              Sign out
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
