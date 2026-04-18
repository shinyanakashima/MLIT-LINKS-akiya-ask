# Akiya Finder (MLIT-LINKS-akiya-ask)

日本語の自然文で、全国の格安空き家・移住物件を横断検索できる Web アプリです。
「予算300万以内、農地付き、海の近くで古民家」のように話し言葉で入力すると、
条件に合う物件の一覧が出ます。

🔗 **デモ**: https://mlit-links-akiya-ask.pages.dev/

データは国土交通省 Project LINKS の
[空き家バンク登録物件(2025年度)](https://www.geospatial.jp/ckan/dataset/links-akiyabank-2025)
(募集中 約7,500件)を利用しています。

---

## 何ができるか

- **自然文で検索**: 「築30年以内で改修不要、駐車場あり」のような日本語をそのまま入力。
- **手動絞り込み**: 都道府県・市区町村の選択、価格・築年・特徴タグでの絞り込み。
- **原典への誘導**: 各物件から、掲載元の自治体空き家バンクへリンク。
- **日本語 / 英語切替**: 画面右上のボタンでUIを切替(物件データ自体は日本語のまま)。

## 仕組み(重要)

このアプリの肝は **「AIは検索しない」** という点です。役割分担は次の通りです。

```
あなたの入力（自然文）
   │
   ▼  テキストだけを送信
 /api/search（サーバ関数）→ OpenAI
   │
   ▼  返ってくるのは「検索条件(JSON)」だけ（物件データは渡していない）
 { priceMax: 3000000, propertyTypes:["古民家"], features:["海近い"] }
   │
   ▼  この条件で…
 ブラウザ内の filter.js が、手元の物件JSONを1件ずつ照合
   │
   ▼
 合致した物件を表示
```

- **OpenAI の仕事は「自然文 → 検索条件(JSON)」の変換のみ。** 物件データは送られません
  (プライバシー面で安全、データが増えても AI コストは一定)。
- **実際の絞り込みはブラウザ内で完結**します(`filter.js`)。
- **AI が使えないときは自動でキーワード検索に切り替わります**(下記)。

### 2系統の検索とフォールバック

| 経路 | いつ使われるか | 仕組み |
| --- | --- | --- |
| **AI検索** | 通常時(`/api/search` が応答) | OpenAI が自然文を検索条件へ変換 |
| **キーワード検索** | サーバ関数が無い/失敗時(ローカル開発・APIエラー等) | `filter.js` の正規表現＋辞書で簡易抽出 |

どちらの経路でも最終的に同じ形の「フィルタJSON」になるため、表示側は経路を意識しません。
> 注: キーワード検索は日本語前提です。英語入力は AI検索でのみ機能します(英語UIに注記を表示)。

## 技術スタック

- **フロントエンド**: 素の HTML / CSS / JavaScript(フレームワーク・ビルド工程なし)。
- **サーバ処理**: Cloudflare Pages Functions(`functions/api/search.js`)1本のみ。
  OpenAI API キーをサーバ側に秘匿するためだけに存在します。
- **データ**: 静的 JSON(`data/akiya.json`)。DB はありません。

## クイックスタート(ローカル)

静的ファイルなので任意の静的サーバで動きます。

```bash
git clone https://github.com/shinyanakashima/mlit-links-akiya-ask.git
cd mlit-links-akiya-ask
python3 -m http.server 8000
# ブラウザで http://localhost:8000 を開く
```

- `data/akiya.json`(本番データ)が無ければ、自動で `data/akiya.sample.json`(12件)を表示します。
- ローカルでは `/api/search` が無いため、**キーワード検索**で動作します(AI検索は本番のみ)。
- AI検索もローカルで試したい場合は [デプロイ](#デプロイ) の `wrangler pages dev` を参照。

## テスト

```bash
node scripts/test.mjs
```

キーワードパーサ・マッチング・JSON抽出・データ取り込みアダプタの単体テスト(依存なし)。

## データの取り込み

物件データ `data/akiya.json` は別リポジトリ
[`MLIT-LINKS-akiya-pipeline`](https://github.com/shinyanakashima/MLIT-LINKS-akiya-pipeline)
の成果物(正規化済みデータセット)から生成します。
このリポジトリ自体は**データの正規化パイプラインを持たず**、その成果物を取り込むだけです。
`data/akiya.json` は Git 管理外(生成物)です。

### 推奨: リリース成果物から取得(1コマンド)

```bash
node scripts/fetch-dataset.mjs                 # 既定タグ data-2025.1.0 を取得→取り込み
node scripts/fetch-dataset.mjs data-2026.1.0   # 別バージョンに切替
```

GitHub Release の `akiya-<year>.json`(CC-BY-4.0)と `manifest.json` を取得し、
`manifest` の件数と取り込み結果を照合します(不一致なら exit 2)。

### 手動: 任意の JSON / CSV から生成

```bash
node scripts/import.mjs <input.json|input.csv> data/akiya.json
```

取り込みの対応付け(パイプラインのネスト/enum形式 → 本アプリのフラット形式)の詳細は
[`docs/schema.md`](docs/schema.md) を参照。

## デプロイ

**Cloudflare Pages**(GitHub 連携の自動デプロイ)で公開しています。
`main` への push で自動ビルド&デプロイされます(PR ごとにプレビューURLも生成)。

Cloudflare ダッシュボードでの設定:

1. リポジトリを Cloudflare Pages に接続(Production branch = `main`)。
2. ビルド設定:
   - **Framework preset**: None
   - **Build command**: `node scripts/fetch-dataset.mjs`
   - **Build output directory**: `/`(ルート)
   - ⚠️ `data/akiya.json` は Git 管理外なので、**ビルド時に上記コマンドで生成**します。
     省くと本番データが無く、サンプル12件にフォールバックします。
3. 環境変数 `OPENAI_API_KEY` を設定(サーバ側のみ参照。クライアントには出ません)。
   - 任意: `OPENAI_MODEL`(既定 `gpt-4o-mini`)、別オリジン配信時のみ `ALLOW_ORIGIN`。

ローカルで Functions(AI検索)を試す場合:

```bash
echo 'OPENAI_API_KEY = "sk-..."' > .dev.vars   # .gitignore 済み
npx wrangler pages dev .
```

## ディレクトリ構成

```
index.html                  画面本体
assets/css/style.css        スタイル
assets/js/i18n.js           日本語/英語の文言辞書と切替
assets/js/app.js            データ読込・UI制御・検索/絞り込み・段階描画
assets/js/filter.js         フィルタ定義・キーワードパーサ・マッチング(検索エンジン本体)
assets/js/ai.js             AI検索クライアント(/api/search 呼び出し+フォールバック)
assets/js/prompt.js         自然文→フィルタJSON の変換プロンプトとJSON抽出
functions/api/search.js     Cloudflare Pages Function(OpenAI 呼び出し・キー秘匿)
scripts/fetch-dataset.mjs   パイプライン成果物の取得→取り込み
scripts/import.mjs          成果物JSON/CSV → 本アプリ形式への変換アダプタ
scripts/test.mjs            単体テスト
data/akiya.sample.json      サンプルデータ(12件・コミット対象)
data/akiya.json             本番データ(生成物・Git管理外)
docs/architecture.md        構成図(Mermaid + 画像)
docs/schema.md              データ&フィルタのスキーマ設計
```

構成図は [`docs/architecture.md`](docs/architecture.md) を参照。

## ライセンス・データ出典

- **データ出典**: 国土交通省 Project LINKS「[空き家バンク登録物件(2025年度)](https://www.geospatial.jp/ckan/dataset/links-akiyabank-2025)」
  (ライセンス **CC-BY-4.0**)。
- **位置づけ**: 本アプリは物件探しの補助を目的とした**非公式サービス**です。
  掲載情報は取り込み時点のもので、実際の募集状況・価格・条件とは異なる場合があります。
- **重要**: 内見・申込・契約などの前に、**必ず各自治体の空き家バンク(原典)で最新情報をご確認ください。**
  各物件カードの「原典」リンクから確認できます。
