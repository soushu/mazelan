# Claudia プロジェクトルール

## ブランチ戦略（厳守）

main(本番) → develop(統合) → feature/*(機能) の3層構成。

1. ソースコードの修正・追加は **必ず feature/* ブランチを切って行う**
2. feature/* → develop にマージ → ステージングで動作確認
3. ユーザーが **明示的に「mainにマージして」と指示するまで** develop → main へのマージは行わない

**禁止事項:**
- main に直接コミットしない
- develop に直接コミットしない（必ず feature/* 経由）
- feature ブランチはマージ後も削除しない
- feature ブランチの作業が全て完了してから develop にマージする（途中で何度もマージしない。develop への push のたびにデプロイが走るため）

## デプロイ前チェック（厳守）

feature/* を develop にマージする前に必ず以下を実行:
1. TypeScript型チェック: `npx tsc --noEmit`
2. ロジックのダブルチェック（全変更ファイルを読み直し、全パターン確認）

## コーディングルール

- モバイル100vh問題: `h-screen` ではなく `h-dvh` を使う
- メッセージ取得: 必ず `order_by(created_at)` で取得
- エラーメッセージ: `[ERROR: ...]` 形式ではなく `⚠️ ...` 形式
- 送信方法: Enter=改行、Cmd+Enter(Mac)/Ctrl+Enter(Win)=送信
- Python venv: サーバーでは `pip` ではなく `venv/bin/pip` を使う
- StreamingResponse: stream内で `SessionLocal()` を直接生成する（`Depends(get_db)` 不可）
- google-genai: `google-generativeai` は非推奨、`google-genai` を使う
- OpenAI o-series: `max_tokens` ではなく `max_completion_tokens` を使う
- Gemini streaming: `client.aio.models.generate_content_stream()` は `await` してから `async for`

## デプロイ

- 本番: main に push → GitHub Actions 自動デプロイ
- ステージング: develop に push → GitHub Actions 自動デプロイ
- Nginx conf はデプロイスクリプトで上書きしない（SSL設定が消える）
- concurrency group `deploy-gce` を他プロジェクトと共有（同時ビルド禁止、OOM対策）

## 環境

| 環境 | ブランチ | ドメイン | Backend | Frontend | DB |
|------|----------|----------|---------|----------|-----|
| 本番 | main | claudia.soushu.biz | :8000 | :3000 | claudia |
| ステージング | develop | dev.claudia.soushu.biz | :8002 | :3002 | claudia_staging |

GCP: e2-small (0.5vCPU / 2GB RAM), bitpoint-bot, us-west1-b
全プロジェクト共有のポート管理表: `~/.claude/PORT_REGISTRY.md`

## DEV バッジバージョン

ステージング環境の DEV バッジにバージョン番号を表示する（`frontend/app/chat/page.tsx` 内）。
- develop にマージするたびにパッチ番号をインクリメントする（例: v30.4 → v30.5）
- 現在のバージョン: **v30.4**
