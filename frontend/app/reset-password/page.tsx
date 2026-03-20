"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "";

function ResetPasswordForm() {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const email = searchParams.get("email");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // If no token/email, show "forgot password" form
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail }),
      });
      if (res.ok) {
        setForgotSent(true);
      } else {
        setError(t("auth.resetRequestFailed"));
      }
    } catch {
      setError(t("auth.resetRequestFailed"));
    }
    setLoading(false);
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError(t("auth.passwordMismatch"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email, new_password: newPassword }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setSuccess(true);
      } else {
        setError(data?.detail || t("auth.resetFailed"));
      }
    } catch {
      setError(t("auth.resetFailed"));
    }
    setLoading(false);
  }

  // Success state
  if (success) {
    return (
      <div className="w-full max-w-sm space-y-6 px-4 text-center">
        <h1 className="text-2xl font-bold text-t-primary">{t("auth.resetSuccessTitle")}</h1>
        <p className="text-sm text-t-muted">{t("auth.resetSuccessMessage")}</p>
        <Link
          href="/login"
          className="inline-block w-full rounded-lg bg-theme-hover px-4 py-3 text-sm font-medium text-t-primary hover:bg-theme-active transition-colors text-center"
        >
          {t("auth.signInLink")}
        </Link>
      </div>
    );
  }

  // Forgot password sent state
  if (forgotSent) {
    return (
      <div className="w-full max-w-sm space-y-6 px-4 text-center">
        <h1 className="text-2xl font-bold text-t-primary">{t("auth.resetEmailSentTitle")}</h1>
        <p className="text-sm text-t-muted">{t("auth.resetEmailSentMessage")}</p>
        <Link
          href="/login"
          className="text-accent hover:text-accent-hover transition-colors text-sm"
        >
          {t("auth.signInLink")}
        </Link>
      </div>
    );
  }

  // Reset password form (with token)
  if (token && email) {
    return (
      <div className="w-full max-w-sm space-y-6 px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-t-primary">{t("auth.resetPasswordTitle")}</h1>
          <p className="mt-1 text-sm text-t-muted">{t("auth.resetPasswordSubtitle")}</p>
        </div>

        {error && (
          <div className="rounded-lg bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleResetPassword} className="space-y-4">
          <input
            type="password"
            placeholder={t("auth.newPassword")}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
            className="w-full rounded-lg border border-border-input bg-theme-input px-4 py-3 text-sm text-t-primary placeholder-t-placeholder focus:border-border-secondary focus:outline-none"
          />
          <input
            type="password"
            placeholder={t("auth.confirmPassword")}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
            className="w-full rounded-lg border border-border-input bg-theme-input px-4 py-3 text-sm text-t-primary placeholder-t-placeholder focus:border-border-secondary focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-theme-hover px-4 py-3 text-sm font-medium text-t-primary hover:bg-theme-active transition-colors disabled:opacity-50"
          >
            {loading ? t("auth.resetting") : t("auth.resetPassword")}
          </button>
        </form>
      </div>
    );
  }

  // Forgot password request form
  return (
    <div className="w-full max-w-sm space-y-6 px-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-t-primary">{t("auth.forgotPasswordTitle")}</h1>
        <p className="mt-1 text-sm text-t-muted">{t("auth.forgotPasswordSubtitle")}</p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <form onSubmit={handleForgotPassword} className="space-y-4">
        <input
          type="email"
          placeholder={t("auth.email")}
          value={forgotEmail}
          onChange={(e) => setForgotEmail(e.target.value)}
          required
          className="w-full rounded-lg border border-border-input bg-theme-input px-4 py-3 text-sm text-t-primary placeholder-t-placeholder focus:border-border-secondary focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-theme-hover px-4 py-3 text-sm font-medium text-t-primary hover:bg-theme-active transition-colors disabled:opacity-50"
        >
          {loading ? t("auth.sending") : t("auth.sendResetLink")}
        </button>
      </form>

      <p className="text-center text-sm text-t-muted">
        <Link href="/login" className="text-accent hover:text-accent-hover transition-colors">
          {t("auth.signInLink")}
        </Link>
      </p>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-theme-base">
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
