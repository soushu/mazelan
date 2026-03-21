# Mazelan プロジェクトルール

## ブランチ戦略（厳守）

main(本番) → develop(統合) → feature/*(機能) の3層構成。

1. ソースコードの修正・追加は **必ず feature/* ブランチを切って行う**
2. feature/* → develop にマージ → ステージングで動作確認
3. ユーザーが **明示的に「mainにマージして」と指示するまで** develop → main へのマージは行わない
4. マージは **必ず `--no-ff`** で行う（`git merge --no-ff feature/*`）。fast-forwardマージ禁止。マージコミットを必ず残すこと

**例外:**
- CLAUDE.md・ドキュメントのみの変更は develop に直接コミット可（デプロイに影響しないため）

**禁止事項:**
- main に直接コミットしない
- develop に直接コミットしない（必ず feature/* 経由。上記例外を除く）
- feature ブランチはマージ後も削除しない
- fast-forwardマージしない（必ず `--no-ff` を付ける）
- feature ブランチの作業が全て完了してから develop にマージする（途中で何度もマージしない。develop への push のたびにデプロイが走るため）

## 開発フロー（厳守）

コード修正・機能追加する場合は以下のフローを必ず守る:

1. develop から feature/* ブランチを切る
2. コード修正・機能追加
3. TypeScript型チェック + ロジック確認
4. DEV バージョンインクリメント
5. feature/* → develop にマージ（`--no-ff`）→ ステージングにデプロイ
6. **Playwright MCP でブラウザ動作確認**（dev.mazelan.ai）
7. 問題があれば 2 に戻り、**問題がなくなるまで繰り返す**
8. 問題がなくなったら **Slack 通知を送信**（SLACK_OPS_WEBHOOK_URL 経由）
9. **main へのマージはユーザーの明示的な指示があるまで行わない**

## デプロイ前チェック（厳守）

feature/* を develop にマージする前に必ず以下を実行:
1. TypeScript型チェック: `npx tsc --noEmit`
2. ロジックのダブルチェック（全変更ファイルを読み直し、全パターン確認）
3. DEV バッジバージョンのインクリメント（`frontend/app/chat/page.tsx` 内の `DEV vX.X` を +0.1）

## コーディングルール

- モバイル100vh問題: `h-screen` ではなく `h-dvh` を使う
- メッセージ取得: 必ず `order_by(created_at)` で取得
- エラーメッセージ: `[ERROR: ...]` 形式ではなく `⚠️ ...` 形式
- 送信方法: Enter=送信、Shift+Enter/Ctrl+Enter=改行
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
| 本番 | main | mazelan.ai | :8000 | :3000 | claudia |
| ステージング | develop | dev.mazelan.ai | :8002 | :3002 | claudia_staging |

GCP: e2-small (0.5vCPU / 2GB RAM), us-west1-b
全プロジェクト共有のポート管理表: `~/.claude/PORT_REGISTRY.md`

**環境変数の追加・変更時は必ず本番とステージング両方の `.env` に反映すること。**

## 有料APIキーの使用（厳守）

フリーモデル（Gemini Flash Lite等）以外のモデル（Claude, GPT等）でテストする場合:

1. **コード解析を最優先** — APIを使う前に、コードを読んで原因を特定し、修正を完了させる
2. **修正が完了したと確信してから**初めてAPIを使って動作確認を行う（推測段階でAPIを消費しない）
3. **リクエスト回数は最小限** — 1回のテストで確認できるよう、事前に十分な解析を行う
4. APIキーはローカルの `.env` ファイルを参照する（設定されていない場合はユーザーに変数名を伝えて設定を依頼する）
5. **APIキーの値をチャットに絶対に表示しない** — Bashで読み取り、変数経由で使用する

## セキュリティ

- APIキー、シークレット、パスワード、トークンなどの機密情報をチャット出力に **絶対に** 表示しない
- .env ファイルの中身を表示・出力しない
- コマンド実行結果に機密情報が含まれる場合は、該当部分を伏せて報告する
- Playwright evaluate やツールのパラメータにもAPIキーを含めない

## DEV バッジバージョン

ステージング環境の DEV バッジにバージョン番号を表示する（`frontend/app/chat/page.tsx` 内）。
- develop にマージするたびにパッチ番号をインクリメントする（例: v30.4 → v30.5）
