# チャットツール 機能追加 — 引き継ぎ資料

## 前提

チャットアプリ本体はすでに完成済み。
このドキュメントは以下の新機能を追加するための指示書。

---

## 追加する機能

1. **文脈管理機能**（Mem0による自動抽出 + 一覧・編集・削除・カテゴリ管理）
2. **AI議論モード**（複数のAIが議論して統合回答を出す）

---

## 機能1：文脈管理（Context Memory）

### 概要

会話から重要な情報をMem0が自動抽出・保存し、次回以降の会話に自動反映する。
ユーザーは保存された文脈を一覧で確認・編集・削除・カテゴリ管理できる。
トークン使用量も大幅に削減される（過去の全履歴ではなく抽出された文脈だけを送信するため）。

### インストール

```bash
pip install mem0ai
```

### DBスキーマ追加

既存のDBに以下のテーブルを追加する。

```sql
CREATE TABLE contexts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  category VARCHAR NOT NULL,
  source VARCHAR DEFAULT 'auto',   -- 'auto'（自動抽出）or 'manual'（手動追加）
  session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,  -- falseにすると会話への付与をスキップ
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### バックエンドへの追加

#### 既存の chat.py に追記

会話終了後にMem0が自動抽出し、次の会話開始時に文脈をシステムプロンプトへ自動付与する。

```python
# 会話開始時：アクティブな文脈をシステムプロンプトに付与
contexts = get_active_contexts(user_id)
system_prompt = f"""
あなたは親切なアシスタントです。

【ユーザーの文脈情報】
{format_contexts(contexts)}

この情報を踏まえて回答してください。
"""

# 会話終了後：Mem0で自動抽出してcontextsテーブルに保存
mem0.extract_and_save(conversation, user_id)
```

#### 新規ルーター：routers/contexts.py

```
GET    /api/contexts              # 文脈一覧取得（カテゴリ別）
POST   /api/contexts              # 手動で文脈を追加
PATCH  /api/contexts/{id}         # 文脈を編集
DELETE /api/contexts/{id}         # 文脈を削除
PATCH  /api/contexts/{id}/toggle  # 有効/無効の切り替え
```

### フロントエンドへの追加

#### 新規ページ：/contexts（文脈管理画面）

```
📁 投資
  └ ETHを毎週25,000円積立中    [編集] [削除] [●有効]
  └ BitPoint使用中              [編集] [削除] [●有効]

📁 開発環境
  └ Lightsailを使用中           [編集] [削除] [●有効]
  └ Python / FastAPIが得意      [編集] [削除] [○無効]

📁 ビジネス
  └ 暗号資産税務ツール開発中     [編集] [削除] [●有効]

[+ 手動で追加する]  [+ カテゴリを追加する]
```

#### 既存のチャット画面に追加

- サイドバーに「文脈管理」へのリンクを追加するだけ

### 環境変数追加

```bash
# ローカルで動かす場合はAPIキー不要
# Mem0のクラウドAPIを使う場合のみ
MEM0_API_KEY=your-mem0-api-key
```

---

## 機能2：AI議論モード

### 概要

通常モードはClaudeだけが回答するが、議論モードをONにすると
ClaudeとGPT-4oが互いの回答を批評し合い、最終的に統合回答を出す。

### 流れ

```
ユーザーが質問
        ↓
① ClaudeとGPT-4oが各自回答を生成
        ↓
② お互いの回答を見て批評・補足し合う（1〜2ターン）
        ↓
③ Claudeが議長として全意見を統合して最終回答を出す
        ↓
ユーザーに表示（議論の過程も折りたたんで見られる）
```

### インストール

```bash
pip install openai
```

### 環境変数追加

```bash
OPENAI_API_KEY=your-openai-api-key
```

### バックエンドへの追加

#### 新規ルーター：routers/debate.py

```
POST /api/debate   # 議論モードでの質問送信
```

```python
# debate.py の処理概要

# Step1：ClaudeとGPT-4oに同じ質問を並列で投げる
claude_answer = ask_claude(question)
gpt_answer = ask_gpt(question)

# Step2：互いの回答を見せて批評させる
claude_critique = ask_claude(f"GPT-4oの回答：{gpt_answer}\nこれに対する批評と補足を述べてください")
gpt_critique = ask_gpt(f"Claudeの回答：{claude_answer}\nこれに対する批評と補足を述べてください")

# Step3：Claudeが全意見を統合して最終回答を出す
final_answer = ask_claude(f"""
以下の議論を踏まえて最終的な統合回答を出してください。
Claude初回回答：{claude_answer}
GPT-4o初回回答：{gpt_answer}
Claudeの批評：{claude_critique}
GPT-4oの批評：{gpt_critique}
""")
```

### フロントエンドへの追加

#### 既存の入力エリアに追加

送信ボタンの横に「議論モード」トグルを追加するだけ。

```
[質問を入力...]  [議論モード 🔀]  [送信]
```

#### 議論モードの回答表示

```
▼ 議論の過程（クリックで展開）
  Claude初回：「...」
  GPT-4o初回：「...」
  Claudeの批評：「...」
  GPT-4oの批評：「...」

━━━━━━━━━━━━━━
📝 統合回答
「...」
━━━━━━━━━━━━━━
```

---

## 実装の優先順位

1. DBマイグレーション（contextsテーブル追加）
2. Mem0のインストールと自動抽出処理
3. /api/contexts エンドポイント実装
4. システムプロンプトへの文脈自動付与
5. フロントエンド：文脈管理画面（/contexts）
6. フロントエンド：サイドバーにリンク追加
7. OpenAI APIキーの設定
8. /api/debate エンドポイント実装
9. フロントエンド：議論モードのトグルと表示
EOF
