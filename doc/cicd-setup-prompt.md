# CI/CD自動デプロイ環境構築プロンプト

以下のプロンプトを、対象プロジェクトのAIに渡してください。
`{{...}}` の部分はプロジェクトに合わせて置き換えてください。

---

## プロンプト（ここからコピー）

```
このプロジェクトにCI/CD自動デプロイ環境を構築してください。
既に稼働中のプロジェクト「claudia」と同じGCPインスタンス (bitpoint-bot, us-west1-b) にデプロイします。

## ブランチ戦略

main(本番) → develop(統合) → feature/*(機能) の3層構成です。

- mainにpush → 本番環境に自動デプロイ
- developにpush → ステージング環境に自動デプロイ
- 開発フロー: feature/* → developにマージ → ステージングで動作確認 → 問題なければ develop → main にマージして本番デプロイ

**絶対にmainに直接コミットしない。必ずdevelop経由。**

## プロジェクト情報

- プロジェクト名: {{PROJECT_NAME}}  (例: bitpoint-bot, zeitan-dev)
- GitHubリポジトリ: {{GITHUB_ORG}}/{{GITHUB_REPO}}
- 本番ドメイン: {{PROD_DOMAIN}}  (例: bot.soushu.biz)
- ステージングドメイン: {{STAGING_DOMAIN}}  (例: dev.bot.soushu.biz)

## ポート割り当て

claudiaが以下のポートを使用済みです。重複しないように設定してください:
- 8000/3000: claudia 本番 (backend/frontend)
- 8001: zenn-content (slack_handler) が占有
- 8002/3002: claudia ステージング (backend/frontend)

このプロジェクトのポート:
- 本番 backend: {{PROD_BACKEND_PORT}}  (例: 8003)
- 本番 frontend: {{PROD_FRONTEND_PORT}}  (例: 3003)
- ステージング backend: {{STAGING_BACKEND_PORT}}  (例: 8004)
- ステージング frontend: {{STAGING_FRONTEND_PORT}}  (例: 3004)

## GCPインスタンスの制約 (e2-micro: 0.25vCPU / 1GB RAM)

メモリが非常に少ないため、以下の対策が**必須**です:
1. ビルド前にsystemdサービスをstopしてメモリを解放する
2. Node.jsビルドには `NODE_OPTIONS="--max_old_space_size=384"` を付ける
3. `npm ci --prefer-offline` を使う（npm installではなく）
4. GitHub Actionsのconcurrency groupを `deploy-gce` に設定する（claudiaと共有。同時ビルドするとOOMで落ちる）

## 構築に必要なファイル一覧

以下のファイルを `deploy/` ディレクトリに作成してください:

### 1. GitHub Actions ワークフロー

`.github/workflows/deploy.yml` (本番用):
- トリガー: push to main
- GCP認証: Workload Identity Federation (JSON鍵なし)
- gcloud compute ssh でサーバーに接続し deploy-prod.sh を実行
- 最後にヘルスチェック (curl -sf http://127.0.0.1:{{PROD_BACKEND_PORT}}/health)

`.github/workflows/deploy-staging.yml` (ステージング用):
- トリガー: push to develop
- 同様の構成で deploy-staging.sh を実行
- ヘルスチェックはステージングポート

両方とも以下の設定:
```yaml
concurrency:
  group: deploy-gce        # claudiaと共有！同時デプロイ防止
  cancel-in-progress: false # キャンセルせず待つ

permissions:
  contents: read
  id-token: write          # WIF認証に必要
```

GitHub Secretsに以下が設定済み (claudiaと共有のため追加不要):
- GCP_WORKLOAD_IDENTITY_PROVIDER
- GCP_SERVICE_ACCOUNT
- GCP_PROJECT_ID

**ただし、WIF の attribute condition にこのリポジトリを追加する必要あり。**
以下のコマンドをサーバーセットアップ手順に含めること:
```bash
gcloud iam service-accounts add-iam-policy-binding \
  claudia-deploy@{{GCP_PROJECT_ID}}.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/{{GCP_PROJECT_NUMBER}}/locations/global/workloadIdentityPools/github-actions/attribute.repository/{{GITHUB_ORG}}/{{GITHUB_REPO}}"
```

### 2. デプロイスクリプト

`deploy/deploy-prod.sh`:
```bash
#!/bin/bash
set -euo pipefail
DEPLOY_DIR="/home/yutookiguchi/{{PROJECT_NAME}}"
BRANCH="main"

cd "$DEPLOY_DIR"
git fetch origin "$BRANCH"
git reset --hard "origin/${BRANCH}"

# バックエンド依存関係 + マイグレーション（該当する場合）
venv/bin/pip install -q -r requirements.txt   # Python の場合
venv/bin/alembic upgrade head                  # Alembic の場合

# サービス停止（メモリ解放のため）
sudo systemctl stop {{PROJECT_NAME}}-backend
sudo systemctl stop {{PROJECT_NAME}}-frontend

# フロントエンドビルド
cd frontend
npm ci --prefer-offline
NODE_OPTIONS="--max_old_space_size=384" npm run build
cd ..

# サービス再開
sudo systemctl start {{PROJECT_NAME}}-backend
sudo systemctl start {{PROJECT_NAME}}-frontend

# ヘルスチェック（最大120秒待機）
for i in $(seq 1 60); do
  curl -sf http://127.0.0.1:{{PROD_BACKEND_PORT}}/health > /dev/null 2>&1 && echo "Healthy" && exit 0
  [ "$i" -eq 60 ] && echo "FAIL" && sudo journalctl -u {{PROJECT_NAME}}-backend --no-pager -n 20 && exit 1
  sleep 2
done
```

`deploy/deploy-staging.sh`: 同様の構成で、ディレクトリ・ブランチ・ポートをステージング用に変更。

**重要ポイント:**
- Pythonは `venv/bin/pip` を使うこと（system pipだとvenvにパッケージが入らず起動失敗する）
- バックエンドの起動に30-60秒かかる（e2-micro制約）ので、ヘルスチェックは120秒タイムアウト

### 3. systemd サービスファイル

本番backend: `deploy/{{PROJECT_NAME}}-backend.service`
本番frontend: `deploy/{{PROJECT_NAME}}-frontend.service`
ステージングbackend: `deploy/{{PROJECT_NAME}}-staging-backend.service`
ステージングfrontend: `deploy/{{PROJECT_NAME}}-staging-frontend.service`

テンプレート（backend例）:
```ini
[Unit]
Description={{PROJECT_NAME}} Backend
After=network.target postgresql.service

[Service]
User=yutookiguchi
WorkingDirectory=/home/yutookiguchi/{{PROJECT_NAME}}
ExecStart=/home/yutookiguchi/{{PROJECT_NAME}}/venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port {{PORT}}
EnvironmentFile=/home/yutookiguchi/{{PROJECT_NAME}}/.env
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

テンプレート（frontend例）:
```ini
[Unit]
Description={{PROJECT_NAME}} Frontend
After=network.target {{PROJECT_NAME}}-backend.service

[Service]
User=yutookiguchi
WorkingDirectory=/home/yutookiguchi/{{PROJECT_NAME}}/frontend
ExecStart=/usr/bin/node /home/yutookiguchi/{{PROJECT_NAME}}/frontend/node_modules/.bin/next start -p {{PORT}}
EnvironmentFile=/home/yutookiguchi/{{PROJECT_NAME}}/frontend/.env.local
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 4. Nginx設定

`deploy/nginx/{{PROJECT_NAME}}.conf` (本番用)
`deploy/nginx/{{PROJECT_NAME}}-staging.conf` (ステージング用)

APIルーティングはプロジェクトのエンドポイント構成に合わせて設定。
共通ルール:
- バックエンドAPIは `proxy_pass http://127.0.0.1:{{BACKEND_PORT}}`
- フロントエンドはcatch-all `location /` で `proxy_pass http://127.0.0.1:{{FRONTEND_PORT}}`
- SSE（ストリーミング）がある場合は `proxy_buffering off; proxy_cache off;`
- SSL設定はcertbotが自動追加するので、confファイルには書かない

**Nginx SSL設定の注意:**
- `sudo certbot --nginx -d {{DOMAIN}} --non-interactive --agree-tos -m admin@soushu.biz` で設定
- デプロイスクリプトでnginx confを上書きしないこと（SSL設定が消える）

### 5. バックエンドのヘルスチェックエンドポイント

バックエンドに `/health` エンドポイントがない場合は追加してください:
```python
@app.get("/health")
def health():
    return {"status": "ok"}
```

## サーバー初回セットアップ手順

上記のファイルを作成した後、以下の手順を実行する必要があります。
この手順もREADMEやsetup.shに含めてください:

### 0. DNS設定（Nginx・certbotより先に必要）

ドメインのDNS管理画面で、本番・ステージング両方のAレコードを追加してください。
GCPインスタンスのIP: `136.117.90.183`

| ホスト名 | タイプ | 値 |
|----------|--------|-----|
| {{PROD_DOMAIN}} | A | 136.117.90.183 |
| {{STAGING_DOMAIN}} | A | 136.117.90.183 |

**注意:**
- DNS反映には数分〜最大48時間かかる場合がある（通常は数分）
- certbotはドメインの名前解決ができないとSSL証明書の発行に失敗するため、DNSが反映されてからステップ7を実行すること
- 反映確認: `dig {{PROD_DOMAIN}} +short` で `136.117.90.183` が返ればOK

### 以下、サーバー上での作業

1. リポジトリをclone:
   ```bash
   cd /home/yutookiguchi
   git clone https://github.com/{{GITHUB_ORG}}/{{GITHUB_REPO}}.git {{PROJECT_NAME}}
   git clone https://github.com/{{GITHUB_ORG}}/{{GITHUB_REPO}}.git {{PROJECT_NAME}}-staging
   cd {{PROJECT_NAME}}-staging && git checkout develop
   ```

2. Python venv作成（Pythonバックエンドの場合）:
   ```bash
   python3 -m venv venv
   venv/bin/pip install -r requirements.txt
   ```

3. 環境変数ファイル配置:
   ```bash
   # .env と frontend/.env.local を配置
   ```

4. DBセットアップ（PostgreSQL共有インスタンス）:
   ```bash
   sudo -u postgres psql -c "CREATE DATABASE {{DB_NAME}} OWNER claudia;"
   sudo -u postgres psql -c "CREATE DATABASE {{DB_NAME}}_staging OWNER claudia;"
   ```

5. systemdサービス登録:
   ```bash
   sudo cp deploy/*.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable {{PROJECT_NAME}}-backend {{PROJECT_NAME}}-frontend
   sudo systemctl enable {{PROJECT_NAME}}-staging-backend {{PROJECT_NAME}}-staging-frontend
   ```

6. Nginx設定:
   ```bash
   sudo cp deploy/nginx/{{PROJECT_NAME}}.conf /etc/nginx/sites-available/
   sudo cp deploy/nginx/{{PROJECT_NAME}}-staging.conf /etc/nginx/sites-available/
   sudo ln -s /etc/nginx/sites-available/{{PROJECT_NAME}}.conf /etc/nginx/sites-enabled/
   sudo ln -s /etc/nginx/sites-available/{{PROJECT_NAME}}-staging.conf /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```

7. SSL証明書:
   ```bash
   sudo certbot --nginx -d {{PROD_DOMAIN}} --non-interactive --agree-tos -m admin@soushu.biz
   sudo certbot --nginx -d {{STAGING_DOMAIN}} --non-interactive --agree-tos -m admin@soushu.biz
   ```

8. WIF にリポジトリを追加（上記のgcloudコマンド実行）

9. 初回デプロイテスト: developにpushしてGitHub Actionsが動くか確認

## 既存サービスとの共存に関する注意

このサーバーでは以下が稼働中です。絶対に影響を与えないこと:
- claudia (8000/3000) + claudia-staging (8002/3002)
- zenn-content slack_handler (8001)
- PostgreSQL (共有)
- Nginx (共有、sites-enabled方式)

concurrency group `deploy-gce` を必ず設定して、claudiaのデプロイと同時実行されないようにすること。
```

---

## リファレンス

不明点や迷うことがあれば、claudiaプロジェクトの実装を参照してください。
同じGCPインスタンス上で同じ構成で稼働中の実例です。

リポジトリ: https://github.com/soushu/claudia
ローカルパス（同じマシンにある場合）: /Users/yutookiguchi/Work/claudia

特に参考になるファイル:
- `.github/workflows/deploy.yml` / `deploy-staging.yml` — GitHub Actionsワークフロー
- `deploy/deploy-prod.sh` / `deploy-staging.sh` — デプロイスクリプト
- `deploy/claudia-backend.service` 等 — systemdサービス定義
- `deploy/nginx/claudia.conf` / `claudia-staging.conf` — Nginxリバースプロキシ設定
- `deploy/setup.sh` — サーバー初回セットアップスクリプト
```

---

## 使い方

1. 上記プロンプトの `{{...}}` を実際の値に置き換える
2. 対象プロジェクトのAIに渡す
3. AIがファイルを生成したら、サーバー初回セットアップを実行
4. developにpushしてステージング動作確認 → mainにマージで本番デプロイ
