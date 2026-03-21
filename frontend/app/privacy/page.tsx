"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";

const PRIVACY_JA = {
  title: "プライバシーポリシー",
  lastUpdated: "最終更新日: 2026年3月15日",
  termsLink: "利用規約",
  sections: [
    { title: "1. 収集する情報", intro: "本サービスでは、以下の情報を収集・保存します。", groups: [
      { subtitle: "アカウント情報", list: ["メールアドレス", "名前（任意）", "パスワード（ハッシュ化して保存）", "Google OAuthプロフィール情報（Google認証を使用した場合）"] },
      { subtitle: "利用データ", list: ["チャット会話内容（メッセージ、送信画像）", "セッション情報（タイトル、作成日時）", "トークン使用量・コスト情報"] },
    ]},
    { title: "2. APIキーの取り扱い", list: ["APIキーはブラウザのローカルストレージに暗号化して保存され、サーバーには保存されません。", "APIキーはリクエスト時にHTTPSを通じて各AIプロバイダーへの中継のみに使用されます。", "APIキーをログに記録したり、第三者と共有することはありません。", "ユーザーはいつでもAPIキーを変更・削除できます。"] },
    { title: "3. データの利用目的", list: ["チャットサービスの提供・改善", "ユーザー認証", "会話履歴の保存・表示"], notUsed: "以下の目的には使用しません:", notUsedList: ["AIモデルのトレーニング", "広告の配信", "第三者へのデータ販売"] },
    { title: "4. 第三者との情報共有", intro: "ユーザーの会話内容は、ユーザーが選択したAIモデルに応じて、以下のプロバイダーに送信されます:", providers: [["Anthropic", "Claude モデル使用時"], ["OpenAI", "GPT モデル使用時"], ["Google", "Gemini モデル使用時"]], outro: "各プロバイダーのデータ取り扱いについては、各社のプライバシーポリシーをご確認ください。それ以外の第三者にデータを共有・販売することはありません。" },
    { title: "5. データの保存", list: ["データはGoogle Cloud Platform上のサーバーに保存されます。", "通信はHTTPS（TLS）により暗号化されます。", "パスワードはbcryptによりハッシュ化されます。"] },
    { title: "6. データの削除", list: ["ユーザーはいつでもチャットセッションを個別に削除できます。", "ユーザーはサイドバーの「アカウント削除」からアカウントを削除できます。", "アカウント削除時には、関連するすべてのデータが削除されます。"] },
    { title: "7. Cookie・ローカルストレージ", items: [["認証Cookie", "ログインセッション管理に使用（NextAuth.js）"], ["ローカルストレージ", "APIキー（暗号化）、テーマ設定、セッションキャッシュの保存に使用"]], extra: "トラッキングCookieや分析ツールは使用していません。" },
    { title: "8. 未成年者の利用", content: "本サービスは18歳未満の方を対象としていません。18歳未満の方の個人情報を意図的に収集することはありません。" },
    { title: "9. ポリシーの変更", content: "本ポリシーは予告なく変更される場合があります。変更後のポリシーは、本ページに掲載された時点で効力を生じます。" },
  ],
};

const PRIVACY_EN = {
  title: "Privacy Policy",
  lastUpdated: "Last updated: March 15, 2026",
  termsLink: "Terms of Service",
  sections: [
    { title: "1. Information We Collect", intro: "The Service collects and stores the following information:", groups: [
      { subtitle: "Account Information", list: ["Email address", "Name (optional)", "Password (stored as hash)", "Google OAuth profile information (when using Google sign-in)"] },
      { subtitle: "Usage Data", list: ["Chat conversation content (messages, images)", "Session information (title, creation date)", "Token usage and cost information"] },
    ]},
    { title: "2. API Key Handling", list: ["API keys are encrypted and stored in your browser's local storage, not on the server.", "API keys are only used to relay requests to AI providers via HTTPS.", "We do not log or share API keys with third parties.", "Users can change or delete API keys at any time."] },
    { title: "3. Data Usage", list: ["Providing and improving the chat service", "User authentication", "Storing and displaying conversation history"], notUsed: "We do NOT use data for:", notUsedList: ["Training AI models", "Serving advertisements", "Selling data to third parties"] },
    { title: "4. Third-Party Data Sharing", intro: "User conversation content is sent to the following providers based on the selected AI model:", providers: [["Anthropic", "When using Claude models"], ["OpenAI", "When using GPT models"], ["Google", "When using Gemini models"]], outro: "Please refer to each provider's privacy policy for their data handling practices. We do not share or sell data to any other third parties." },
    { title: "5. Data Storage", list: ["Data is stored on Google Cloud Platform servers.", "Communications are encrypted via HTTPS (TLS).", "Passwords are hashed using bcrypt."] },
    { title: "6. Data Deletion", list: ["Users can delete individual chat sessions at any time.", "Users can delete their account from the \"Delete account\" option in the sidebar.", "All associated data is deleted when an account is deleted."] },
    { title: "7. Cookies & Local Storage", items: [["Authentication Cookie", "Used for login session management (NextAuth.js)"], ["Local Storage", "Used to store API keys (encrypted), theme settings, and session cache"]], extra: "We do not use tracking cookies or analytics tools." },
    { title: "8. Minors", content: "The Service is not intended for users under 18. We do not intentionally collect personal information from minors." },
    { title: "9. Policy Changes", content: "This policy may be changed without notice. Updated policies take effect when published on this page." },
  ],
};

type Section = (typeof PRIVACY_JA)["sections"][number];

export default function PrivacyPage() {
  const router = useRouter();
  const locale = useLocale();
  const t = locale === "ja" ? PRIVACY_JA : PRIVACY_EN;

  return (
    <div className="min-h-screen bg-theme-base">
      <div className="max-w-2xl mx-auto px-4 py-12">
        <button onClick={() => router.back()} className="text-sm text-accent hover:text-accent-hover transition-colors">
          &larr; Back
        </button>
        <h1 className="text-2xl font-bold text-t-primary mt-6 mb-2">{t.title}</h1>
        <p className="text-xs text-t-muted mb-8">{t.lastUpdated}</p>
        <div className="space-y-6 text-sm text-t-secondary leading-relaxed">
          {t.sections.map((s: Section, i: number) => (
            <section key={i}>
              <h2 className="text-base font-semibold text-t-primary mb-2">{s.title}</h2>
              {"intro" in s && <p className="mb-2">{s.intro}</p>}
              {"groups" in s && (s as { groups: { subtitle: string; list: string[] }[] }).groups.map((g, gi) => (
                <div key={gi}>
                  <h3 className="font-medium text-t-primary mt-3 mb-1">{g.subtitle}</h3>
                  <ul className="list-disc pl-5 space-y-1">{g.list.map((item, j) => <li key={j}>{item}</li>)}</ul>
                </div>
              ))}
              {"list" in s && !("groups" in s) && (
                <ul className="list-disc pl-5 space-y-1">{(s as { list: string[] }).list.map((item, j) => <li key={j}>{item}</li>)}</ul>
              )}
              {"notUsed" in s && (
                <>
                  <p className="mt-2 font-medium text-t-primary">{(s as { notUsed: string }).notUsed}</p>
                  <ul className="list-disc pl-5 space-y-1">{(s as { notUsedList: string[] }).notUsedList.map((item, j) => <li key={j}>{item}</li>)}</ul>
                </>
              )}
              {"providers" in s && (
                <>
                  <ul className="list-disc pl-5 space-y-1">
                    {(s as { providers: string[][] }).providers.map(([name, desc], j) => (
                      <li key={j}><span className="font-medium">{name}</span> — {desc}</li>
                    ))}
                  </ul>
                  <p className="mt-2">{(s as { outro: string }).outro}</p>
                </>
              )}
              {"items" in s && (
                <>
                  <ul className="list-disc pl-5 space-y-1">
                    {(s as { items: string[][] }).items.map(([name, desc], j) => (
                      <li key={j}><span className="font-medium">{name}</span> — {desc}</li>
                    ))}
                  </ul>
                  {"extra" in s && <p className="mt-1">{(s as { extra: string }).extra}</p>}
                </>
              )}
              {"content" in s && <p>{(s as { content: string }).content}</p>}
            </section>
          ))}
        </div>
        <div className="mt-12 pt-6 border-t border-border-primary text-xs text-t-muted">
          <Link href="/terms" className="text-accent hover:text-accent-hover transition-colors">{t.termsLink}</Link>
        </div>
      </div>
    </div>
  );
}
