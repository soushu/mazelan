"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export default function PrivacyPage() {
  const router = useRouter();
  return (
    <div className="min-h-screen bg-theme-base">
      <div className="max-w-2xl mx-auto px-4 py-12">
        <button
          onClick={() => router.back()}
          className="text-sm text-accent hover:text-accent-hover transition-colors"
        >
          &larr; Back
        </button>

        <h1 className="text-2xl font-bold text-t-primary mt-6 mb-2">プライバシーポリシー</h1>
        <p className="text-xs text-t-muted mb-8">最終更新日: 2026年3月15日</p>

        <div className="space-y-6 text-sm text-t-secondary leading-relaxed">
          <section>
            <h2 className="text-base font-semibold text-t-primary mb-2">1. 収集する情報</h2>
            <p className="mb-2">本サービスでは、以下の情報を収集・保存します。</p>
            <h3 className="font-medium text-t-primary mt-3 mb-1">アカウント情報</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>メールアドレス</li>
              <li>名前（任意）</li>
              <li>パスワード（ハッシュ化して保存）</li>
              <li>Google OAuthプロフィール情報（Google認証を使用した場合）</li>
            </ul>
            <h3 className="font-medium text-t-primary mt-3 mb-1">利用データ</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>チャット会話内容（メッセージ、送信画像）</li>
              <li>セッション情報（タイトル、作成日時）</li>
              <li>トークン使用量・コスト情報</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-t-primary mb-2">2. APIキーの取り扱い</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>APIキーはブラウザのローカルストレージに保存され、サーバーには保存されません。</li>
              <li>APIキーはリクエスト時にHTTPSを通じて各AIプロバイダーへの中継のみに使用されます。</li>
              <li>APIキーをログに記録したり、第三者と共有することはありません。</li>
              <li>ユーザーはいつでもAPIキーを変更・削除できます。</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-t-primary mb-2">3. データの利用目的</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>チャットサービスの提供・改善</li>
              <li>ユーザー認証</li>
              <li>会話履歴の保存・表示</li>
            </ul>
            <p className="mt-2 font-medium text-t-primary">
              以下の目的には使用しません:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>AIモデルのトレーニング</li>
              <li>広告の配信</li>
              <li>第三者へのデータ販売</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-t-primary mb-2">4. 第三者との情報共有</h2>
            <p className="mb-2">
              ユーザーの会話内容は、ユーザーが選択したAIモデルに応じて、以下のプロバイダーに送信されます:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li><span className="font-medium">Anthropic</span> — Claude モデル使用時</li>
              <li><span className="font-medium">OpenAI</span> — GPT モデル使用時</li>
              <li><span className="font-medium">Google</span> — Gemini モデル使用時</li>
            </ul>
            <p className="mt-2">
              各プロバイダーのデータ取り扱いについては、各社のプライバシーポリシーをご確認ください。
              それ以外の第三者にデータを共有・販売することはありません。
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-t-primary mb-2">5. データの保存</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>データはGoogle Cloud Platform（米国リージョン）上のサーバーに保存されます。</li>
              <li>通信はHTTPS（TLS）により暗号化されます。</li>
              <li>パスワードはbcryptによりハッシュ化されます。</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-t-primary mb-2">6. データの削除</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>ユーザーはいつでもチャットセッションを個別に削除できます。</li>
              <li>アカウントの削除を希望する場合は、運営者にご連絡ください。</li>
              <li>アカウント削除時には、関連するすべてのデータが削除されます。</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-t-primary mb-2">7. Cookie・ローカルストレージ</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li><span className="font-medium">認証Cookie</span> — ログインセッション管理に使用（NextAuth.js）</li>
              <li><span className="font-medium">ローカルストレージ</span> — APIキー、テーマ設定、セッションキャッシュの保存に使用</li>
              <li>トラッキングCookieや分析ツールは使用していません。</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-t-primary mb-2">8. 未成年者の利用</h2>
            <p>
              本サービスは18歳未満の方を対象としていません。
              18歳未満の方の個人情報を意図的に収集することはありません。
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-t-primary mb-2">9. ポリシーの変更</h2>
            <p>
              本ポリシーは予告なく変更される場合があります。変更後のポリシーは、本ページに掲載された時点で効力を生じます。
            </p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t border-border-primary text-xs text-t-muted">
          <Link href="/terms" className="text-accent hover:text-accent-hover transition-colors">
            利用規約
          </Link>
        </div>
      </div>
    </div>
  );
}
