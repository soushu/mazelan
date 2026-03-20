# サーバーリソース最適化プロンプト

GCPインスタンス bitpoint-bot (e2-micro: 0.25vCPU / 1GB RAM) で複数プロジェクトが稼働しており、メモリが逼迫しています。
各プロジェクトのリソース使用を最適化してください。

---

## zenn-content (zenn-bot) 向けプロンプト

```
このプロジェクトはGCPの e2-micro (1GB RAM) で他の複数サービスと同居しています。
メモリが逼迫しているため、このサービスのリソース使用を最適化したいです。

現在のサービス定義:
- ファイル: /etc/systemd/system/zenn-bot.service
- 内容: uvicorn で slack_handler を 127.0.0.1:8001 に常駐起動
- ExecStart: /home/yutookiguchi/zenn-content/venv/bin/uvicorn scripts.slack_handler:app --host 127.0.0.1 --port 8001
- EnvironmentFile: /home/yutookiguchi/zenn-content/.env

このサービスは週に1〜2回しか使われていません。
以下を検討して、最適な方法を提案・実装してください:

1. **常駐が必要か判断**: slack_handler がSlack Webhookを待ち受けるサーバーなら常駐が必要。
   定期バッチ処理なら systemd timer に変更してオンデマンド実行にする。
2. **常駐が必要な場合の代替案**:
   - uvicorn のワーカー数を最小にする（--workers 1、既にデフォルトかも）
   - メモリ使用量を減らす他の方法があれば適用
   - または、使わない時間帯はstopするcron設定を提案
3. **常駐不要な場合**: systemd timer に変更して、必要な時だけ起動→処理→停止する構成に変更

サーバー情報:
- OS: Ubuntu 22.04
- ユーザー: yutookiguchi
- Python: venv (/home/yutookiguchi/zenn-content/venv)
- サーバーへの接続: gcloud compute ssh yutookiguchi@bitpoint-bot --zone=us-west1-b --tunnel-through-iap
- 同居サービス: claudia (Web app, 常時起動), PostgreSQL, Nginx

変更後、現在の使用メモリを free -h で確認してください。
```

---

## bitpoint_bot 向けプロンプト

```
このプロジェクトはGCPの e2-micro (1GB RAM) で他の複数サービスと同居しています。
メモリが逼迫しているため、このサービスのリソース使用を最小限にしたいです。

サーバー上のディレクトリ: /home/yutookiguchi/bitpoint_bot

このプロジェクトは週に1回程度しか実行されません。
以下の方針で構成してください:

1. **常駐サービスにしない**: systemd service + timer で週次実行、
   または cron で定期実行する構成にする
2. **実行時のメモリ使用を最小限に**: 処理が終わったらプロセスが完全に終了すること
3. **既存サービスへの影響なし**: 以下のポートは使用済みなので避ける
   - 8000/3000: claudia 本番
   - 8001: zenn-bot
   - 8002/3002: claudia ステージング

サーバー情報:
- OS: Ubuntu 22.04
- ユーザー: yutookiguchi
- サーバーへの接続: gcloud compute ssh yutookiguchi@bitpoint-bot --zone=us-west1-b --tunnel-through-iap
- 同居サービス: claudia (Web app, 常時起動), zenn-bot, PostgreSQL, Nginx

変更後、現在の使用メモリを free -h で確認してください。
```

---

## 使い方

それぞれのプロンプトを該当プロジェクトのAIに渡してください。
