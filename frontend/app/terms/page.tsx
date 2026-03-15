import Link from "next/link";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-theme-base">
      <div className="max-w-2xl mx-auto px-4 py-12">
        <Link
          href="/login"
          className="text-sm text-accent hover:text-accent-hover transition-colors"
        >
          &larr; Back
        </Link>

        <h1 className="text-2xl font-bold text-t-primary mt-6 mb-2">利用規約</h1>
        <p className="text-xs text-t-muted mb-8">最終更新日: 2026年3月15日</p>

        <div className="space-y-6 text-sm text-t-secondary leading-relaxed">
          <section>
            <h2 className="text-base font-semibold text-t-primary mb-2">1. サービスについて</h2>
            <p>
              claudia（以下「本サービス」）は、個人が運営するAIチャットインターフェースです。
              本サービスは、ユーザーが自身で取得したAPIキーを使用して、複数のAIプロバイダー（Anthropic、OpenAI、Google）と対話するためのプラットフォームを提供します。
            </p>
            <p className="mt-2">
              本サービスはAI機能を直接提供するものではなく、ユーザーと各AIプロバイダー間の橋渡しをするインターフェースです。
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-t-primary mb-2">2. アカウント</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>本サービスのご利用には、アカウント登録が必要です。</li>
              <li>ユーザーはアカウント情報の管理に責任を負います。</li>
              <li>1人につき1アカウントの使用を原則とします。</li>
              <li>18歳未満の方のご利用は想定しておりません。</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-t-primary mb-2">3. APIキーについて</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>ユーザーは自身のAPIキーを使用して各AIプロバイダーにアクセスします。</li>
              <li>APIキーの利用に伴う料金は、ユーザーが各プロバイダーに直接支払います。</li>
              <li>本サービスは、APIキーの利用により発生する料金について一切の責任を負いません。</li>
              <li>ユーザーは各AIプロバイダーの利用規約も遵守する必要があります。</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-t-primary mb-2">4. AI生成コンテンツに関する免責</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>AIの回答は不正確、不完全、または誤解を招く場合があります。</li>
              <li>AI生成コンテンツを医療、法律、金融等の専門的判断に使用しないでください。</li>
              <li>AI生成コンテンツの利用はユーザーの自己責任とします。</li>
              <li>本サービスは、AI生成コンテンツの正確性・完全性を保証しません。</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-t-primary mb-2">5. 禁止事項</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>法令に違反する行為、または違反するおそれのある行為</li>
              <li>他者の権利を侵害するコンテンツの生成</li>
              <li>サービスの逆コンパイル、リバースエンジニアリング</li>
              <li>サービスへの不正アクセスまたは過度な負荷をかける行為</li>
              <li>第三者へのアカウントの譲渡・貸与</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-t-primary mb-2">6. コンテンツの権利</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>ユーザーが入力したコンテンツの権利はユーザーに帰属します。</li>
              <li>AI生成コンテンツの権利は、各AIプロバイダーの利用規約に準じます。</li>
              <li>本サービスはユーザーのコンテンツに対する所有権を主張しません。</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-t-primary mb-2">7. サービスの提供</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>本サービスは「現状のまま」提供され、可用性やサービス品質の保証はありません。</li>
              <li>本サービスは個人プロジェクトであり、予告なく変更・停止する場合があります。</li>
              <li>メンテナンスやサーバー障害等により、一時的に利用できない場合があります。</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-t-primary mb-2">8. 免責事項</h2>
            <p>
              本サービスの利用によって生じたいかなる損害（直接的・間接的を問わず）についても、
              運営者は一切の責任を負いません。これには、データの損失、APIキーの不正利用、
              AI生成コンテンツに起因する損害を含みますが、これらに限りません。
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-t-primary mb-2">9. アカウントの停止・削除</h2>
            <p>
              運営者は、ユーザーが本規約に違反した場合、事前の通知なくアカウントを停止または削除する権利を有します。
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-t-primary mb-2">10. 規約の変更</h2>
            <p>
              本規約は予告なく変更される場合があります。変更後の規約は、本ページに掲載された時点で効力を生じます。
              重要な変更がある場合は、サービス上で通知いたします。
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-t-primary mb-2">11. 準拠法</h2>
            <p>
              本規約は日本法に準拠するものとします。
            </p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t border-border-primary text-xs text-t-muted">
          <Link href="/privacy" className="text-accent hover:text-accent-hover transition-colors">
            プライバシーポリシー
          </Link>
        </div>
      </div>
    </div>
  );
}
