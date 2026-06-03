# Mazelan 開発ワークフロー詳細

CLAUDE.md から退避した開発・デプロイ・運用の詳細手順。CLAUDE.md は要点のみを保持し、判断・実行時に必要な詳細はこのファイルを参照する。

最終更新: 2026-05-27

---

## ブランチ戦略（詳細）

main(本番) → develop(統合) → feature/*(機能) の3層構成。

1. ソースコードの修正・追加は **必ず feature/* ブランチを切って行う**
2. feature/* → develop にマージ → ステージングで動作確認
3. ユーザーが **明示的に「mainにマージして」と指示するまで** develop → main へのマージは行わない
4. マージは **必ず `--no-ff`** で行う（`git merge --no-ff feature/*`）。fast-forwardマージ禁止。マージコミットを必ず残すこと

### 例外: ドキュメントのみの変更

CLAUDE.md・ドキュメント類（README.md / doc/*.md など）のみの変更は **main に直接コミット可**（develop を経由しない、デプロイには影響しないため）。

手順:
1. `git checkout main && git pull origin main`
2. ドキュメントを編集
3. `git add <doc files> && git commit`
4. `git push origin main`
5. develop は次の develop→main マージ時にまとめて反映される

### 禁止事項

- main に直接コミットしない（ドキュメントのみの変更は例外）
- develop に直接コミットしない（必ず feature/* 経由。上記例外を除く）
- feature ブランチはマージ後も削除しない
- fast-forwardマージしない（必ず `--no-ff` を付ける）
- feature ブランチの作業が全て完了してから develop にマージする（途中で何度もマージしない。develop への push のたびにデプロイが走るため）

---

## 開発フロー（9ステップ）

コード修正・機能追加する場合は以下のフローを必ず守る:

1. develop から feature/* ブランチを切る
2. コード修正・機能追加
3. TypeScript型チェック + ロジック確認
4. DEV バージョンインクリメント（`frontend/app/chat/page.tsx` 内の `DEV vX.X` を +0.1）
5. feature/* → develop にマージ（`--no-ff`）→ ステージングにデプロイ
6. **Playwright MCP でブラウザ動作確認**（dev.mazelan.ai）
7. 問題があれば 2 に戻り、**問題がなくなるまで繰り返す**
8. 問題がなくなったら **Slack 通知を送信**（SLACK_OPS_WEBHOOK_URL 経由、Python で送信。curl は Windows で日本語が文字化けするため使わない）
9. **main へのマージはユーザーの明示的な指示があるまで行わない**

### デプロイ前チェック

feature/* を develop にマージする前に必ず以下を実行:

1. TypeScript型チェック: `npx tsc --noEmit`
2. ロジックのダブルチェック（全変更ファイルを読み直し、全パターン確認）
3. DEV バッジバージョンのインクリメント（`frontend/app/chat/page.tsx` 内の `DEV vX.X` を +0.1）

---

## デプロイ仕組み

- 本番: main に push → GitHub Actions 自動デプロイ
- ステージング: develop に push → GitHub Actions 自動デプロイ
- Nginx conf はデプロイスクリプトで上書きしない（SSL設定が消える）
- concurrency group `deploy-gce` を他プロジェクトと共有（同時ビルド禁止、OOM対策）

### GCP インフラ

- インスタンス: e2-small (0.5vCPU / 2GB RAM), us-west1-b
- インスタンス名: `bitpoint-bot`（複数プロジェクト同居）
- 全プロジェクト共有のポート管理表: `~/.claude/PORT_REGISTRY.md`

### Nginx 設定

サーバー側の Nginx 設定ファイル:
- `/etc/nginx/sites-enabled/mazelan.conf`（本番）
- `/etc/nginx/sites-enabled/mazelan-staging.conf`（ステージング）

重要なヘッダ:
```nginx
add_header Permissions-Policy "camera=(), microphone=(self), geolocation=()" always;
```
`microphone=(self)` でないとブラウザの getUserMedia が完全ブロックされる（音声入力機能のため必須）。

---

## 有料APIキーの使用（詳細ルール）

フリーモデル（Gemini Flash Lite等）以外のモデル（Claude, GPT等）でテストする場合:

1. **コード解析を最優先** — APIを使う前に、コードを読んで原因を特定し、修正を完了させる
2. **修正が完了したと確信してから**初めてAPIを使って動作確認を行う（推測段階でAPIを消費しない）
3. **リクエスト回数は最小限** — 1回のテストで確認できるよう、事前に十分な解析を行う
4. APIキーはローカルの `.env` ファイルを参照する（設定されていない場合はユーザーに変数名を伝えて設定を依頼する）
5. **APIキーの値をチャットに絶対に表示しない** — Bashで読み取り、変数経由で使用する

---

## セキュリティ詳細

- APIキー、シークレット、パスワード、トークンなどの機密情報をチャット出力に **絶対に** 表示しない
- .env ファイルの中身を表示・出力しない
- コマンド実行結果に機密情報が含まれる場合は、該当部分を伏せて報告する
- Playwright evaluate やツールのパラメータにもAPIキーを含めない

---

## DEV バッジバージョン規則

ステージング環境の DEV バッジにバージョン番号を表示する（`frontend/app/chat/page.tsx` 内）。

- develop にマージするたびにパッチ番号をインクリメントする（例: v30.4 → v30.5）
- 大きい変更は整数を上げる（例: v60.95 → v61.0）

---

## Slack 通知（運用通知）

`SLACK_OPS_WEBHOOK_URL` 環境変数経由で Python から送信する（curl は Windows で日本語文字化けするため使わない）。

```python
import os, json, urllib.request

with open('.env') as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            os.environ.setdefault(k, v.strip().strip('"').strip("'"))

req = urllib.request.Request(
    os.environ['SLACK_OPS_WEBHOOK_URL'],
    data=json.dumps({"text": "メッセージ本文"}).encode('utf-8'),
    headers={'Content-Type': 'application/json'},
)
urllib.request.urlopen(req)
```
