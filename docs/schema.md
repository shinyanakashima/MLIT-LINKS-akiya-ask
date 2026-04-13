# データ & フィルタスキーマ設計

本プロジェクトは「物件データ(静的JSON)」と「検索フィルタ(構造化JSON)」の
2つのスキーマで成り立つ。自然文はフィルタJSONへ変換され、クライアント側で
物件データを絞り込む。

## 1. 物件データスキーマ (`data/akiya.json`)

MLIT-LINKS-akiya-pipeline の正規化済みJSON、または生CSVから取り込んだ配列。
各レコードは以下のフィールドを持つ(欠損は `null`)。

| フィールド            | 型               | 説明                                              |
| --------------------- | ---------------- | ------------------------------------------------- |
| `id`                  | string           | 一意ID                                            |
| `prefecture`          | string           | 都道府県(例: `"長崎県"`)                         |
| `municipality`        | string           | 市区町村(例: `"南島原市"`)                       |
| `address`             | string \| null   | 所在地表記(粒度は市区町村まで。緯度経度なし)     |
| `price`               | number \| null   | 価格(円)。賃貸/応相談は `null`                   |
| `priceText`           | string \| null   | 表示用価格文字列(例: `"300万円"`, `"応相談"`)   |
| `transactionType`     | string \| null   | `"売買"` \| `"賃貸"` \| `null`                    |
| `buildYear`           | number \| null   | 建築年(西暦)                                     |
| `structure`           | string \| null   | 構造(例: `"木造"`)                              |
| `floorArea`           | number \| null   | 延床面積(㎡)                                     |
| `landArea`            | number \| null   | 土地面積(㎡)                                     |
| `propertyType`        | string \| null   | 種別(例: `"一戸建て"`, `"古民家"`, `"土地"`)    |
| `renovationRequired`  | boolean \| null  | 要改修なら `true`                                 |
| `features`            | string[]         | 付帯条件タグ(例: `["農地付き","海近い"]`)        |
| `strongPoints`        | string \| null   | PR文(STRONG_POINTS)。全文検索対象               |
| `sourceUrl`           | string \| null   | 自治体バンク原典URL                               |

### パイプライン出力からの対応付け(Stage2)

`scripts/import.mjs` は MLIT-LINKS-akiya-pipeline のネスト/enum形式
(`prompts/akiya-dataset.md`)を上表のフラットスキーマへ射影する。主な対応:

| パイプライン                              | 本スキーマ            | 備考                                            |
| ----------------------------------------- | --------------------- | ----------------------------------------------- |
| `location.prefecture` / `location.city`   | `prefecture` / `municipality` | `address` は両者連結                    |
| `deal_type` (`sale`/`rent`)               | `transactionType`     | 売買 / 賃貸                                     |
| `price_yen`                               | `price`               | **売買のみ**。賃貸は `price=null`               |
| `rent_monthly_yen`                        | `priceText`           | 賃貸は「◯万円/月」表記のみ(金額フィルタ対象外) |
| `building.construction_year` / `structure` / `building_area_sqm` | `buildYear` / `structure` / `floorArea` |                |
| `land.land_area_sqm`                      | `landArea`            |                                                 |
| `use_type` / `tags.labels.kominka` / `flags.retail_premises` | `propertyType` | land→土地, commercial/retail→店舗, kominka→古民家, residential→一戸建て |
| `tags.labels.renovation_needed`           | `renovationRequired`  | required→true, done/as_is→false, **unknown→null** |
| `flags.farmland` / `tags.labels.farmland_attached` | `features:["農地付き"]` | 陽性のみ(`false`=「言及なし」≠非該当) |
| `tags.labels.parking_emphasized`          | `features:["駐車場あり"]` |                                             |
| `strong_points`                           | `strongPoints` + `features` 補完 | `view_nature` は粒度不足のためPR文から海/山/川/温泉を抽出 |
| `provenance.source_url`                   | `sourceUrl`           |                                                 |

- `status == "closed"`(成約済み)のレコードは取り込み時に除外する。
- `null` は「不明」であり 0/非該当ではない(`unknown`→`null` を維持)。

## 2. フィルタスキーマ (AI / キーワードパーサの出力)

自然文(例:「予算300万以内、農地付き、海の近くで古民家」)を変換した結果。
**OpenAI API はこのJSONのみを返す**ようプロンプトで指示する。
未指定の項目は `null` または空配列。

```jsonc
{
  "keywords":        ["古民家"],   // strongPoints/address 等への部分一致語
  "prefectures":     ["長崎県"],   // 都道府県完全一致(OR)
  "municipalities":  [],           // 市区町村完全一致(OR)
  "priceMin":        null,         // 円。以上
  "priceMax":        3000000,      // 円。以下
  "buildYearMin":    null,         // 西暦。以降
  "buildYearMax":    null,         // 西暦。以前
  "ageMax":          null,         // 築年数(年)上限。基準は現在年
  "floorAreaMin":    null,         // ㎡。以上
  "landAreaMin":     null,         // ㎡。以上
  "propertyTypes":   [],           // 種別(OR)
  "transactionType": null,         // "売買" | "賃貸" | null
  "renovationRequired": null,      // true=要改修のみ / false=改修不要のみ / null=不問
  "features":        ["農地付き", "海近い"] // featuresタグへの含意(AND)
}
```

### マッチング規則(クライアント側 `filter.js`)
- `keywords`: `strongPoints + address + municipality + propertyType` の連結文字列に
  すべての語が含まれる(AND)。
- `prefectures` / `municipalities` / `propertyTypes`: 配列内いずれかに一致(OR)。
  空配列なら無条件通過。
- `priceMin/Max`: `price` が `null` の物件は価格条件指定時に除外。
- `ageMax`: `現在年 - buildYear <= ageMax`。`buildYear` が `null` なら除外。
- `features`: 指定タグをすべて含む物件のみ(AND)。タグ名は表記ゆれを
  `featureSynonyms`(filter.js)で正規化。
- `renovationRequired`: `true`/`false` 指定時は一致必須。`null` は不問。
