"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "";

function LoginForm() {
  const t = useTranslations();
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
              ? t("auth.errorEmailExists")
              : data?.detail || t("auth.errorRegistrationFailed")
          );
          setLoading(false);
          return;
        }
        await signIn("credentials", { email, password, callbackUrl: "/chat" });
      } catch {
        setFormError(t("auth.errorRegistrationFailed"));
      }
      setLoading(false);
    } else {
      await signIn("credentials", { email, password, callbackUrl: "/chat" });
      setLoading(false);
    }
  }

  const features = [
    { icon: "M-6,-5 Q-1,-2 0,1 M0,1 Q2,0 6,-3 M0,1 L1,7", label: t("auth.feature1"), emoji: "✈️" },
    { icon: "", label: t("auth.feature2"), emoji: "🔍" },
    { icon: "", label: t("auth.feature3"), emoji: "🌐" },
  ];

  return (
    <div className="flex min-h-dvh w-full flex-col lg:flex-row">
      {/* Left: Branding */}
      <div className="relative flex flex-col items-center justify-center lg:w-1/2 px-8 py-12 lg:py-0 bg-gradient-to-br from-cyan-500/10 via-blue-600/10 to-sky-500/10">
        <div className="absolute inset-0 bg-theme-base/80" />
        <div className="relative z-10 flex flex-col items-center lg:items-start max-w-md">
          {/* Logo */}
          <div className="mb-6">
            <svg width="72" height="72" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="login-logo-bg" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" style={{stopColor:'#67E8F9'}}/>
                  <stop offset="100%" style={{stopColor:'#0369A1'}}/>
                </linearGradient>
              </defs>
              <circle cx="256" cy="256" r="240" fill="url(#login-logo-bg)"/>
              <g transform="translate(256,256) scale(18)" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M-6,-5 Q-1,-2 0,1" opacity="0.5"/>
                <path d="M0,1 Q2,0 6,-3" opacity="0.5"/>
                <path d="M0,1 L1,7" opacity="0.5"/>
                <circle cx="-6" cy="-5" r="2" fill="white" stroke="white" strokeWidth="1.5"/>
                <circle cx="6" cy="-3" r="2" fill="white" stroke="white" strokeWidth="1.5"/>
                <circle cx="0" cy="1" r="1.3" fill="white" stroke="white" strokeWidth="1" opacity="0.75"/>
                <circle cx="1" cy="7" r="2" fill="white" stroke="white" strokeWidth="1.5"/>
              </g>
            </svg>
          </div>

          <h1 className="text-3xl lg:text-4xl font-bold text-t-primary mb-2">{t("app.name")}</h1>
          <p className="text-lg text-t-secondary mb-10 text-center lg:text-left">{t("auth.tagline")}</p>

          {/* Features */}
          <div className="space-y-4 w-full">
            {features.map((f, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center text-lg">
                  {f.emoji}
                </div>
                <span className="text-sm text-t-secondary">{f.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right: Login Form */}
      <div className="flex flex-1 items-center justify-center px-6 py-12 lg:py-0 bg-theme-base">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center lg:text-left">
            <h2 className="text-xl font-semibold text-t-primary">
              {isSignUp ? t("auth.signUpTitle") : t("auth.signInTitle")}
            </h2>
          </div>

          {(error || formError) && (
            <div className="rounded-lg bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {formError ||
                (error === "AccessDenied"
                  ? t("auth.errorAccessDenied")
                  : t("auth.errorSignInFailed"))}
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
                {t("auth.signInWithGoogle")}
              </button>

              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-divider" />
                <span className="text-xs text-t-muted">{t("auth.or")}</span>
                <div className="h-px flex-1 bg-divider" />
              </div>
            </>
          )}

          <form onSubmit={handleCredentials} className="space-y-4">
            {isSignUp && (
              <input
                type="text"
                placeholder={t("auth.name")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-border-input bg-theme-input px-4 py-3 text-sm text-t-primary placeholder-t-placeholder focus:border-border-secondary focus:outline-none"
              />
            )}
            <input
              type="email"
              placeholder={t("auth.email")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-lg border border-border-input bg-theme-input px-4 py-3 text-sm text-t-primary placeholder-t-placeholder focus:border-border-secondary focus:outline-none"
            />
            <input
              type="password"
              placeholder={t("auth.password")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={12}
              className="w-full rounded-lg border border-border-input bg-theme-input px-4 py-3 text-sm text-t-primary placeholder-t-placeholder focus:border-border-secondary focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-theme-hover px-4 py-3 text-sm font-medium text-t-primary hover:bg-theme-active transition-colors disabled:opacity-50"
            >
              {loading
                ? isSignUp
                  ? t("auth.creatingAccount")
                  : t("auth.signingIn")
                : isSignUp
                  ? t("auth.signUp")
                  : t("auth.signIn")}
            </button>
          </form>

          <p className="text-center text-sm text-t-muted">
            {isSignUp ? t("auth.hasAccount") : t("auth.noAccount")}{" "}
            <button
              onClick={() => {
                setIsSignUp(!isSignUp);
                setFormError("");
              }}
              className="text-accent hover:text-accent-hover transition-colors"
            >
              {isSignUp ? t("auth.signInLink") : t("auth.signUpLink")}
            </button>
          </p>

          <p className="text-center text-xs text-t-muted">
            <Link href="/terms" className="hover:text-t-secondary transition-colors">{t("auth.terms")}</Link>
            <span className="mx-2">&middot;</span>
            <Link href="/privacy" className="hover:text-t-secondary transition-colors">{t("auth.privacy")}</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
