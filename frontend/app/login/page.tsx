"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "";

function LoginForm() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [formError, setFormError] = useState("");

  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setLoading(true);

    if (isSignUp) {
      try {
        const res = await fetch(`${BACKEND_URL}/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, name: name || undefined }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          setFormError(
            res.status === 409
              ? "このメールアドレスは既に登録されています。"
              : data?.detail || "登録に失敗しました。"
          );
          setLoading(false);
          return;
        }
        // Registration successful, auto sign in
        await signIn("credentials", { email, password, callbackUrl: "/chat" });
      } catch {
        setFormError("登録に失敗しました。");
      }
      setLoading(false);
    } else {
      await signIn("credentials", { email, password, callbackUrl: "/chat" });
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm space-y-6 px-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-t-primary">claudia</h1>
        <p className="mt-1 text-sm text-t-muted">
          {isSignUp ? "Create your account" : "Sign in to continue"}
        </p>
      </div>

      {(error || formError) && (
        <div className="rounded-lg bg-red-900/30 border border-red-800 px-4 py-3 text-sm text-red-300">
          {formError ||
            (error === "AccessDenied"
              ? "Access denied. Your account is not authorized."
              : "Sign in failed. Please try again.")}
        </div>
      )}

      {!isSignUp && (
        <>
          <button
            onClick={() => signIn("google", { callbackUrl: "/chat" })}
            className="flex w-full items-center justify-center gap-3 rounded-lg bg-white px-4 py-3 text-sm font-medium text-gray-800 hover:bg-gray-100 transition-colors"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Sign in with Google
          </button>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-divider" />
            <span className="text-xs text-t-muted">or</span>
            <div className="h-px flex-1 bg-divider" />
          </div>
        </>
      )}

      <form onSubmit={handleCredentials} className="space-y-4">
        {isSignUp && (
          <input
            type="text"
            placeholder="Name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-border-input bg-theme-input px-4 py-3 text-sm text-t-primary placeholder-t-placeholder focus:border-border-secondary focus:outline-none"
          />
        )}
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full rounded-lg border border-border-input bg-theme-input px-4 py-3 text-sm text-t-primary placeholder-t-placeholder focus:border-border-secondary focus:outline-none"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          className="w-full rounded-lg border border-border-input bg-theme-input px-4 py-3 text-sm text-t-primary placeholder-t-placeholder focus:border-border-secondary focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-theme-hover px-4 py-3 text-sm font-medium text-t-primary hover:bg-theme-active transition-colors disabled:opacity-50"
        >
          {loading
            ? isSignUp
              ? "Creating account..."
              : "Signing in..."
            : isSignUp
              ? "Sign up"
              : "Sign in with Email"}
        </button>
      </form>

      <p className="text-center text-sm text-t-muted">
        {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
        <button
          onClick={() => {
            setIsSignUp(!isSignUp);
            setFormError("");
          }}
          className="text-accent hover:text-accent-hover transition-colors"
        >
          {isSignUp ? "Sign in" : "Sign up"}
        </button>
      </p>

      <p className="text-center text-xs text-t-muted">
        <Link href="/terms" className="hover:text-t-secondary transition-colors">利用規約</Link>
        <span className="mx-2">·</span>
        <Link href="/privacy" className="hover:text-t-secondary transition-colors">プライバシーポリシー</Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-theme-base">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
