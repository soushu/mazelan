# Mazelan プロジェクトルール

最終更新: 2026-05-27

## 情報の置き場所

- **詳細な開発・デプロイ手順**: [doc/dev-workflow.md](doc/dev-workflow.md)
- **基本設計・詳細設計**: [doc/basic-design.md](doc/basic-design.md) / [doc/detailed-design.md](doc/detailed-design.md)
- **Claude 向けの作業 feedback / プロジェクト状態**: `~/.claude/projects/c--Users-yutoo-dev-mazelan/memory/MEMORY.md`

## 環境

| 環境 | ブランチ | ドメイン | Backend | Frontend | DB |
|------|----------|----------|---------|----------|-----|
| 本番 | main | mazelan.ai | :8000 | :3000 | claudia |
| ステージング | develop | dev.mazelan.ai | :8002 | :3002 | claudia_staging |

GCP: e2-small (us-west1-b)、インスタンス名 `bitpoint-bot`（複数プロジェクト同居）。

## ブランチ戦略（要点）

main(本番) → develop(統合) → feature/*(機能) の3層。

- ソース変更は **feature/* → develop → main**、すべて **`--no-ff`** マージ
- main マージは **ユーザーの明示的指示**まで待つ
- **例外**: ドキュメントのみ（README.md / doc/*.md / CLAUDE.md）は **main 直接コミット可**
- 詳細手順: [doc/dev-workflow.md](doc/dev-workflow.md)

## デプロイ前の必須チェック

1. `npx tsc --noEmit`（frontend）
2. 全変更ファイルの読み直し
3. DEV バッジバージョンを `frontend/app/chat/page.tsx` 内で +0.1

詳細フロー（9ステップ）は [doc/dev-workflow.md](doc/dev-workflow.md) 参照。

## コーディングルール（コード依存）

- モバイル100vh問題: `h-screen` ではなく `h-dvh` を使う
- メッセージ取得: 必ず `order_by(created_at)` で取得
- エラーメッセージ: `[ERROR: ...]` 形式ではなく `⚠️ ...` 形式
- 送信方法: Enter=送信、Shift+Enter/Ctrl+Enter=改行
- Python venv: サーバーでは `pip` ではなく `venv/bin/pip` を使う
- StreamingResponse: stream内で `SessionLocal()` を直接生成する（`Depends(get_db)` 不可）
- google-genai: `google-generativeai` は非推奨、`google-genai` を使う
- OpenAI o-series: `max_tokens` ではなく `max_completion_tokens` を使う
- Gemini streaming: `client.aio.models.generate_content_stream()` は `await` してから `async for`

## 環境変数

**追加・変更時は本番とステージング両方の `.env` に必ず反映する。**

ローカル `.env` のテスト・通知用:

| 変数 | 用途 |
|------|------|
| `TEST_MAIL` / `TEST_PASS` | ステージングのブラウザテスト用ログイン |
| `SLACK_OPS_WEBHOOK_URL` | 動作確認完了後の運用通知（Python で送信、curl不可） |
| `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | 各プロバイダーAPI |
| `SCRAPEDO_TOKEN` | Scrape.do Amazon検索API |

## セキュリティ（最低限）

- APIキー・パスワード・トークンなど機密はチャット出力やツールパラメータに**絶対に含めない**
- .env の中身を表示しない
- Bashで env から読み取り変数経由で使う

詳細: [doc/dev-workflow.md](doc/dev-workflow.md#セキュリティ詳細)

## 有料API使用の原則

フリーモデル（Gemini Flash Lite等）以外のモデルでテストする場合:

- **コード解析を優先**、修正を確信してから API を使う
- **リクエスト回数は最小限**

詳細: [doc/dev-workflow.md](doc/dev-workflow.md#有料apiキーの使用詳細ルール)

## Nginx 設定

サーバー側の Nginx conf はデプロイスクリプトで上書きしない（SSL設定が消える）。手動で更新する。マイク機能のため `Permissions-Policy` の `microphone=(self)` が必須。
