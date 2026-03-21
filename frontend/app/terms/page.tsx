"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";

const TERMS_JA = {
  title: "利用規約",
  lastUpdated: "最終更新日: 2026年3月15日",
  privacyLink: "プライバシーポリシー",
  sections: [
    { title: "1. サービスについて", content: "Mazelan（以下「本サービス」）は、個人が運営するAIチャットインターフェースです。本サービスは、ユーザーが自身で取得したAPIキーを使用して、複数のAIプロバイダー（Anthropic、OpenAI、Google）と対話するためのプラットフォームを提供します。", extra: "本サービスはAI機能を直接提供するものではなく、ユーザーと各AIプロバイダー間の橋渡しをするインターフェースです。" },
    { title: "2. アカウント", list: ["本サービスのご利用には、アカウント登録が必要です。", "ユーザーはアカウント情報の管理に責任を負います。", "1人につき1アカウントの使用を原則とします。", "18歳未満の方のご利用は想定しておりません。"] },
    { title: "3. APIキーについて", list: ["ユーザーは自身のAPIキーを使用して各AIプロバイダーにアクセスします。", "APIキーの利用に伴う料金は、ユーザーが各プロバイダーに直接支払います。", "本サービスは、APIキーの利用により発生する料金について一切の責任を負いません。", "ユーザーは各AIプロバイダーの利用規約も遵守する必要があります。"] },
    { title: "4. AI生成コンテンツに関する免責", list: ["AIの回答は不正確、不完全、または誤解を招く場合があります。", "AI生成コンテンツを医療、法律、金融等の専門的判断に使用しないでください。", "AI生成コンテンツの利用はユーザーの自己責任とします。", "本サービスは、AI生成コンテンツの正確性・完全性を保証しません。"] },
    { title: "5. 禁止事項", list: ["法令に違反する行為、または違反するおそれのある行為", "他者の権利を侵害するコンテンツの生成", "サービスの逆コンパイル、リバースエンジニアリング", "サービスへの不正アクセスまたは過度な負荷をかける行為", "第三者へのアカウントの譲渡・貸与"] },
    { title: "6. コンテンツの権利", list: ["ユーザーが入力したコンテンツの権利はユーザーに帰属します。", "AI生成コンテンツの権利は、各AIプロバイダーの利用規約に準じます。", "本サービスはユーザーのコンテンツに対する所有権を主張しません。"] },
    { title: "7. サービスの提供", list: ["本サービスは「現状のまま」提供され、可用性やサービス品質の保証はありません。", "本サービスは個人プロジェクトであり、予告なく変更・停止する場合があります。", "メンテナンスやサーバー障害等により、一時的に利用できない場合があります。"] },
    { title: "8. 免責事項", content: "本サービスの利用によって生じたいかなる損害（直接的・間接的を問わず）についても、運営者は一切の責任を負いません。これには、データの損失、APIキーの不正利用、AI生成コンテンツに起因する損害を含みますが、これらに限りません。" },
    { title: "9. アカウントの停止・削除", content: "運営者は、ユーザーが本規約に違反した場合、事前の通知なくアカウントを停止または削除する権利を有します。" },
    { title: "10. 規約の変更", content: "本規約は予告なく変更される場合があります。変更後の規約は、本ページに掲載された時点で効力を生じます。重要な変更がある場合は、サービス上で通知いたします。" },
    { title: "11. 準拠法", content: "本規約は日本法に準拠するものとします。" },
  ],
};

const TERMS_EN = {
  title: "Terms of Service",
  lastUpdated: "Last updated: March 15, 2026",
  privacyLink: "Privacy Policy",
  sections: [
    { title: "1. About the Service", content: "Mazelan (the \"Service\") is an AI chat interface operated by an individual. The Service provides a platform for users to interact with multiple AI providers (Anthropic, OpenAI, Google) using their own API keys.", extra: "The Service does not directly provide AI capabilities but acts as an interface between users and AI providers." },
    { title: "2. Accounts", list: ["Account registration is required to use the Service.", "Users are responsible for managing their account information.", "Each person is limited to one account.", "The Service is not intended for users under 18 years of age."] },
    { title: "3. API Keys", list: ["Users access AI providers using their own API keys.", "Fees associated with API key usage are paid directly to each provider by the user.", "The Service is not responsible for any charges incurred through API key usage.", "Users must also comply with each AI provider's terms of service."] },
    { title: "4. AI-Generated Content Disclaimer", list: ["AI responses may be inaccurate, incomplete, or misleading.", "Do not use AI-generated content for professional decisions in medicine, law, finance, etc.", "Use of AI-generated content is at the user's own risk.", "The Service does not guarantee the accuracy or completeness of AI-generated content."] },
    { title: "5. Prohibited Activities", list: ["Activities that violate or may violate laws and regulations", "Generating content that infringes on others' rights", "Decompiling or reverse engineering the Service", "Unauthorized access or placing excessive load on the Service", "Transferring or lending accounts to third parties"] },
    { title: "6. Content Rights", list: ["Rights to user-input content belong to the user.", "Rights to AI-generated content are subject to each AI provider's terms of service.", "The Service does not claim ownership of user content."] },
    { title: "7. Service Provision", list: ["The Service is provided \"as is\" without guarantees of availability or quality.", "The Service is a personal project and may be modified or discontinued without notice.", "The Service may be temporarily unavailable due to maintenance or server issues."] },
    { title: "8. Limitation of Liability", content: "The operator shall not be liable for any damages (direct or indirect) arising from use of the Service. This includes, but is not limited to, data loss, unauthorized use of API keys, and damages caused by AI-generated content." },
    { title: "9. Account Suspension/Deletion", content: "The operator reserves the right to suspend or delete accounts without prior notice if users violate these terms." },
    { title: "10. Changes to Terms", content: "These terms may be changed without notice. Updated terms take effect when published on this page. Users will be notified of significant changes through the Service." },
    { title: "11. Governing Law", content: "These terms are governed by the laws of Japan." },
  ],
};

export default function TermsPage() {
  const router = useRouter();
  const locale = useLocale();
  const t = locale === "ja" ? TERMS_JA : TERMS_EN;

  return (
    <div className="min-h-screen bg-theme-base">
      <div className="max-w-2xl mx-auto px-4 py-12">
        <button onClick={() => router.back()} className="text-sm text-accent hover:text-accent-hover transition-colors">
          &larr; Back
        </button>
        <h1 className="text-2xl font-bold text-t-primary mt-6 mb-2">{t.title}</h1>
        <p className="text-xs text-t-muted mb-8">{t.lastUpdated}</p>
        <div className="space-y-6 text-sm text-t-secondary leading-relaxed">
          {t.sections.map((s, i) => (
            <section key={i}>
              <h2 className="text-base font-semibold text-t-primary mb-2">{s.title}</h2>
              {s.content && <p>{s.content}</p>}
              {"extra" in s && s.extra && <p className="mt-2">{s.extra}</p>}
              {s.list && (
                <ul className="list-disc pl-5 space-y-1">
                  {s.list.map((item, j) => <li key={j}>{item}</li>)}
                </ul>
              )}
            </section>
          ))}
        </div>
        <div className="mt-12 pt-6 border-t border-border-primary text-xs text-t-muted">
          <Link href="/privacy" className="text-accent hover:text-accent-hover transition-colors">{t.privacyLink}</Link>
        </div>
      </div>
    </div>
  );
}
