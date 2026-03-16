"use client";

import { useState, useEffect } from "react";
import { listContexts, createContext, updateContext, deleteContext, toggleContext } from "@/lib/api";
import type { ContextItem } from "@/lib/types";
import { useTranslations } from "next-intl";

const CATEGORY_KEYS = ["preferences", "skills", "projects", "personal", "general"] as const;

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function ContextModal({ open, onClose }: Props) {
  const t = useTranslations();
  const [grouped, setGrouped] = useState<Record<string, ContextItem[]>>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [newCategory, setNewCategory] = useState("general");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  useEffect(() => {
    if (!open) return;
    loadContexts();
  }, [open]);

  async function loadContexts() {
    setLoading(true);
    try {
      const data = await listContexts();
      setGrouped(data.contexts);
      setTotal(data.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd() {
    if (!newContent.trim()) return;
    setAdding(true);
    try {
      await createContext(newContent.trim(), newCategory);
      setNewContent("");
      await loadContexts();
    } catch (err) {
      console.error(err);
    } finally {
      setAdding(false);
    }
  }

  async function handleToggle(id: string) {
    setGrouped((prev) => {
      const next = { ...prev };
      for (const cat of Object.keys(next)) {
        next[cat] = next[cat].map((item) =>
          item.id === id ? { ...item, is_active: !item.is_active } : item
        );
      }
      return next;
    });
    try {
      await toggleContext(id);
    } catch (err) {
      console.error(err);
      await loadContexts();
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteContext(id);
      await loadContexts();
    } catch (err) {
      console.error(err);
    }
  }

  async function handleEditSave(id: string) {
    if (!editContent.trim()) return;
    try {
      await updateContext(id, { content: editContent.trim() });
      setEditingId(null);
      await loadContexts();
    } catch (err) {
      console.error(err);
    }
  }

  if (!open) return null;

  const sortedCategories = Object.keys(grouped).sort(
    (a, b) => CATEGORY_KEYS.indexOf(a as typeof CATEGORY_KEYS[number]) - CATEGORY_KEYS.indexOf(b as typeof CATEGORY_KEYS[number])
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-theme-overlay" onClick={onClose}>
      <div
        className="bg-theme-elevated rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-t-primary">{t("context.title")}</h2>
          <span className="text-xs text-t-muted">{total} {t("context.items")}</span>
        </div>
        <p className="text-xs text-t-tertiary mb-4">
          {t("context.description")}
        </p>

        {/* Add form */}
        <div className="flex flex-col gap-2 mb-4">
          <input
            type="text"
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder={t("context.searchPlaceholder")}
            className="w-full bg-theme-surface text-t-secondary placeholder-t-placeholder text-sm px-3 py-2 rounded-lg outline-none focus:ring-1 focus:ring-border-secondary"
          />
          <div className="flex gap-2">
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              className="flex-1 bg-theme-surface text-t-secondary text-sm px-2 py-2 rounded-lg outline-none"
            >
              {CATEGORY_KEYS.map((key) => (
                <option key={key} value={key}>{t(`context.categories.${key}`)}</option>
              ))}
            </select>
            <button
              onClick={handleAdd}
              disabled={adding || !newContent.trim()}
              className="px-3 py-2 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-40 text-white text-sm transition-colors whitespace-nowrap"
            >
              {t("context.add")}
            </button>
          </div>
        </div>

        {/* Context list */}
        <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-5 h-5 border-2 border-spinner-track border-t-spinner-fill rounded-full animate-spin" />
            </div>
          ) : sortedCategories.length === 0 ? (
            <p className="text-t-muted text-sm text-center py-8">
              {t("context.emptyMessage")}
            </p>
          ) : (
            sortedCategories.map((cat) => (
              <div key={cat}>
                <h3 className="text-xs font-medium text-t-tertiary uppercase tracking-wider mb-2">
                  {t(`context.categories.${cat}`)}
                </h3>
                <div className="space-y-1.5">
                  {grouped[cat].map((item) => (
                    <div
                      key={item.id}
                      className={`flex items-start gap-2 px-3 py-2 rounded-lg transition-colors ${
                        item.is_active ? "bg-theme-surface" : "bg-theme-surface opacity-50"
                      }`}
                    >
                      <button
                        onClick={() => handleToggle(item.id)}
                        className={`mt-0.5 w-8 h-4 rounded-full flex-shrink-0 transition-colors relative ${
                          item.is_active ? "bg-accent" : "bg-theme-hover"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                            item.is_active ? "left-4" : "left-0.5"
                          }`}
                        />
                      </button>

                      <div className="flex-1 min-w-0">
                        {editingId === item.id ? (
                          <div className="flex gap-1">
                            <input
                              type="text"
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                              className="flex-1 bg-theme-input text-t-secondary text-sm px-2 py-1 rounded outline-none"
                              onKeyDown={(e) => e.key === "Enter" && handleEditSave(item.id)}
                              autoFocus
                            />
                            <button
                              onClick={() => handleEditSave(item.id)}
                              className="text-xs text-accent hover:text-accent-hover px-1"
                            >
                              {t("context.save")}
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="text-xs text-t-muted hover:text-t-secondary px-1"
                            >
                              {t("context.cancel")}
                            </button>
                          </div>
                        ) : (
                          <p className="text-sm text-t-secondary break-words">{item.content}</p>
                        )}
                        <span className={`text-[10px] mt-0.5 inline-block px-1.5 py-0.5 rounded ${
                          item.source === "auto"
                            ? "bg-theme-hover text-t-muted"
                            : "bg-accent/20 text-accent"
                        }`}>
                          {item.source}
                        </span>
                      </div>

                      {editingId !== item.id && (
                        <div className="flex gap-1 flex-shrink-0">
                          <button
                            onClick={() => { setEditingId(item.id); setEditContent(item.content); }}
                            className="text-t-muted hover:text-t-secondary text-xs p-1"
                            title={t("context.edit")}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                              <path d="M13.488 2.513a1.75 1.75 0 0 0-2.475 0L3.22 10.306a1 1 0 0 0-.258.438l-.89 3.117a.5.5 0 0 0 .617.617l3.116-.89a1 1 0 0 0 .438-.257L14 5.488a1.75 1.75 0 0 0 0-2.475l-.512-.5Z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDelete(item.id)}
                            className="text-t-muted hover:text-danger text-xs p-1"
                            title={t("context.delete")}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                              <path fillRule="evenodd" d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.286a1.5 1.5 0 0 0 1.492-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5A.75.75 0 0 1 9.95 6Z" clipRule="evenodd" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-4 pt-3 border-t border-border-primary">
          <button
            onClick={onClose}
            className="w-full py-2 rounded-lg bg-theme-hover hover:bg-theme-active text-t-secondary text-sm transition-colors"
          >
            {t("context.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
