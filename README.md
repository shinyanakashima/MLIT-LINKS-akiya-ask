# MLIT-LINKS-akiya-ask

日本語で問いかけて探す、格安空き家ファインダー。

国土交通省 Project LINKS の[空き家バンク登録物件(2025年度)](https://www.geospatial.jp/ckan/dataset/links-akiyabank-2025)(約7,700件)を、**DB不要の静的フロント**で全国横断検索する。「予算300万以内、農地付き、海の近くで古民家」のような日本語をそのまま投げて候補を得られる。

## 特徴

- **静的構成**: 物件データは静的JSON。検索・絞り込みはすべてクライアント側で完結。
- **二系統の検索**:
  - **AI検索** — 自然文を Anthropic API(`claude-sonnet-4-20250514`)で構造化フィルタJSONへ変換。
    公開時(Cloudflare Pages)は Pages Function `/api/search` 経由でAPIキーをサーバ側に秘匿する。
  - **キーワード検索** — サーバ(`/api/search`)が応答しない場合(ローカル開発・APIエラー・障害時)は
    `filter.js` の素朴なパーサに自動フォールバック。
- **絞り込み**: 都道府県/市区町村セレクト、価格・築年・特徴タグ。件数表示。
- **原典誘導**: 各物件から自治体バンク原典リンクへ。

## ディレクトリ構成

```
index.html                  画面
assets/css/style.css        スタイル
assets/js/prompt.js         自然文→フィルタJSON 変換プロンプト(共用)
assets/js/filter.js         フィルタスキーマ・キーワードパーサ・マッチング
assets/js/ai.js             AI検索クライアント(/api/search 経由)
assets/js/app.js            データ読込・UI制御・描画
functions/api/search.js     Cloudflare Pages Function(Anthropic API、キー秘匿)
data/akiya.sample.json      サンプルデータ(12件)
data/akiya.json             本番データ(取り込みで生成。gitignore)
scripts/import.mjs          pipeline JSON/CSV → 本スキーマ への変換
docs/schema.md              データ & フィルタスキーマ設計
```

## ローカルで動かす

静的ファイルなので任意の静的サーバでよい。

```bash
python3 -m http.server 8000
# http://localhost:8000 を開く
```

`data/akiya.json` が無ければ自動で `data/akiya.sample.json` を表示する。
この状態では AI検索は使えないため、自動でキーワード検索にフォールバックする。

## 本番データの取り込み

物件データ `data/akiya.json` は MLIT-LINKS-akiya-pipeline の成果物から生成する
(本ファイルは Git 管理外。`data/akiya.sample.json` が無い場合のみフォールバック)。

### 推奨: リリース成果物から取得(1コマンド)

[`MLIT-LINKS-akiya-pipeline`](https://github.com/shinyanakashima/MLIT-LINKS-akiya-pipeline)
の GitHub Release(成果物 `akiya-<year>.json`, CC-BY-4.0)を取得して取り込む。

```bash
node scripts/fetch-dataset.mjs            # 既定タグ data-2025.1.0 を取得→import
node scripts/fetch-dataset.mjs data-2026.1.0   # 翌年版に切替
```

`manifest.json` の `registered` 件数と取り込み結果を照合する(不一致なら exit 2)。

### 手動: 任意の JSON/CSV から生成

```bash
node scripts/import.mjs <input.json|input.csv> data/akiya.json
```

- パイプラインのネスト/enum形式JSON(`prompts/akiya-dataset.md`)は、`location`/`deal_type`/
  `tags` 等を検知して本スキーマへ射影する(成約済み `closed` は除外)。
- 生CSVは列名の部分一致で対応付ける(都道府県/価格/築年/PR文/URL 等)。

対応付けの詳細は [`docs/schema.md`](docs/schema.md) の「パイプライン出力からの対応付け」を参照。

## デプロイ

### Cloudflare Pages(GitHub 連携・自動デプロイ)

GitHub 連携を使い、`main` への push で自動デプロイする(PR ごとにプレビューURLも自動生成)。
Cloudflare ダッシュボードでの設定:

1. リポジトリを Cloudflare Pages に接続(Production branch = `main`)。
2. ビルド設定:
   - **Framework preset**: なし(None)
   - **Build command**: `node scripts/fetch-dataset.mjs`
   - **Build output directory**: `/`(ルート)
   - ⚠️ `data/akiya.json` は Git 管理外のため、**ビルド時に上記コマンドで生成**する。
     これを省くと本番データが無く `data/akiya.sample.json`(12件)にフォールバックする。
3. 環境変数に `ANTHROPIC_API_KEY` を設定(Functions から参照、クライアントには出ない)。
   - 別オリジンから叩く場合のみ `ALLOW_ORIGIN` を設定。
4. `functions/api/search.js` が自動でデプロイされ `/api/search` が有効になる。

> 翌年版データに切り替えるときは Build command の引数でタグを指定:
> `node scripts/fetch-dataset.mjs data-2026.1.0`

ローカルで Functions を試す場合(`wrangler` 利用):

```bash
echo 'ANTHROPIC_API_KEY = "sk-ant-..."' > .dev.vars   # gitignore 済み
npx wrangler pages dev .
```

`/api/search` が応答しない場合(APIエラー・障害時)は、自動でキーワード検索にフォールバックする。

## ライセンス / 出典

物件データの出典は国土交通省 Project LINKS。物件の最新状況は各自治体バンクの原典で確認すること。
