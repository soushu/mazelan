"use client";

import { useState } from "react";
import type { Session } from "@/lib/types";

type Props = {
  sessions: Session[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
};

export default function Sidebar({ sessions, activeId, onSelect, onDelete, onNew }: Props) {
  const [query, setQuery] = useState("");

  const filtered = sessions.filter((s) =>
    s.title.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <aside className="w-64 flex-shrink-0 flex flex-col h-screen bg-slate-900 border-r border-slate-800">
      {/* ヘッダー */}
      <div className="p-4 border-b border-slate-800">
        <h1 className="text-lg font-semibold text-slate-100 mb-3">claudia</h1>
        <button
          onClick={onNew}
          className="w-full py-2 px-3 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm transition-colors"
        >
          + 新しい質問
        </button>
      </div>

      {/* 検索 */}
      <div className="p-3 border-b border-slate-800">
        <input
          type="text"
          placeholder="検索..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full bg-slate-800 text-slate-200 placeholder-slate-500 text-sm px-3 py-2 rounded-lg outline-none focus:ring-1 focus:ring-slate-600"
        />
      </div>

      {/* セッション一覧 */}
      <div className="flex-1 overflow-y-auto py-2">
        {filtered.length === 0 ? (
          <p className="text-slate-500 text-sm text-center mt-8">履歴なし</p>
        ) : (
          filtered.map((s) => (
            <div
              key={s.id}
              className={`group flex items-center gap-2 px-3 py-2 mx-2 rounded-lg cursor-pointer transition-colors ${
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
                className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-opacity text-xs"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
