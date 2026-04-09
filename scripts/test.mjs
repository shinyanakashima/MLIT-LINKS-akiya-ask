#!/usr/bin/env node
// 簡易テスト: キーワードパーサ・マッチング・JSON抽出の動作確認(依存なし)。
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const Filter = require(path.join(root, "assets/js/filter.js"));
const Prompt = require(path.join(root, "assets/js/prompt.js"));
const data = JSON.parse(fs.readFileSync(path.join(root, "data/akiya.sample.json"), "utf8"));

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.error(`FAIL  ${name}`); }
}

console.log("# キーワードパーサ");
const f1 = Filter.parseKeywordQuery("予算300万以内、農地付き、海の近くで古民家");
check("priceMax=3000000", f1.priceMax === 3000000);
check("features に 農地付き", f1.features.includes("農地付き"));
check("features に 海近い", f1.features.includes("海近い"));
check("propertyTypes に 古民家", f1.propertyTypes.includes("古民家"));

const f2 = Filter.parseKeywordQuery("築30年以内で改修不要、駐車場あり");
check("ageMax=30", f2.ageMax === 30);
check("renovationRequired=false", f2.renovationRequired === false);
check("features に 駐車場あり", f2.features.includes("駐車場あり"));

const f3 = Filter.parseKeywordQuery("高知県の川の近く、200万円まで");
check("prefectures に 高知県", f3.prefectures.includes("高知県"));
check("priceMax=2000000", f3.priceMax === 2000000);
check("features に 川近い", f3.features.includes("川近い"));

console.log("# マッチング");
const r1 = Filter.applyFilter(data, f1);
check("『予算300万 農地付き 海 古民家』が1件以上", r1.length >= 1);
check("結果すべて price<=300万", r1.every((x) => x.price != null && x.price <= 3000000));
check("結果すべて 古民家", r1.every((x) => x.propertyType === "古民家"));

const r3 = Filter.applyFilter(data, f3);
check("高知県の結果がすべて高知県", r3.every((x) => x.prefecture === "高知県"));

console.log("# JSON抽出");
check("コードフェンス除去", JSON.stringify(Prompt.extractFilterJSON('```json\n{"priceMax":3000000}\n```')) === '{"priceMax":3000000}');
check("前後テキスト混在", Prompt.extractFilterJSON('はい:{"a":{"b":1}} 以上です').a.b === 1);
check("不正入力はnull", Prompt.extractFilterJSON("JSONなし") === null);

console.log("# 正規化(未知キー破棄・型ガード)");
const n = Filter.normalize({ priceMax: 3000000, features: ["海", 5, "畑"], evil: "x", transactionType: "賃貸" });
check("priceMax 保持", n.priceMax === 3000000);
check("features 正規化(海近い・農地付き)", n.features.includes("海近い") && n.features.includes("農地付き"));
check("数値以外の特徴語は除外", n.features.length === 2);
check("未知キー破棄", n.evil === undefined);
check("transactionType=賃貸", n.transactionType === "賃貸");

console.log("# パイプライン取り込み(Stage2 アダプタ)");
const Import = await import(path.join(root, "scripts/import.mjs"));

// 売買・古民家・農地・要改修のパイプラインレコード
const pSale = {
  id: "p-001", status: "registered", deal_type: "sale", use_type: "residential",
  price_yen: 3000000, rent_monthly_yen: null,
  location: { prefecture: "長崎県", city: "南島原市" },
  building: { construction_year: 1968, structure: "木造", building_area_sqm: 96.5 },
  land: { land_area_sqm: 320 },
  strong_points: "目の前が有明海。畑付きの古民家。",
  tags: { labels: { kominka: true, farmland_attached: true, renovation_needed: "required", parking_emphasized: true }, confidence: "high" },
  flags: { farmland: true },
  provenance: { source_url: "https://example.jp/p001" },
};
const m = Import.fromPipeline(pSale, 0);
check("pipeline 検知", Import.isPipelineRecord(pSale));
check("location → prefecture/municipality", m.prefecture === "長崎県" && m.municipality === "南島原市");
check("deal_type sale → 売買", m.transactionType === "売買");
check("price_yen → price", m.price === 3000000);
check("priceText 万円表記", m.priceText === "300万円");
check("construction_year → buildYear", m.buildYear === 1968);
check("building_area_sqm → floorArea", m.floorArea === 96.5);
check("land_area_sqm → landArea", m.landArea === 320);
check("kominka → propertyType 古民家", m.propertyType === "古民家");
check("renovation_needed required → true", m.renovationRequired === true);
check("farmland → 農地付き", m.features.includes("農地付き"));
check("parking_emphasized → 駐車場あり", m.features.includes("駐車場あり"));
check("strong_points(有明海)→ 海近い 補完", m.features.includes("海近い"));
check("source_url → sourceUrl", m.sourceUrl === "https://example.jp/p001");
// 取り込んだレコードはアプリのフィルタでそのまま絞り込める
check("マッピング結果がフィルタに乗る", Filter.applyFilter([m], f1).length === 1);

// 賃貸: price=null、priceText は月額
const pRent = { id: "p-002", status: "registered", deal_type: "rent", use_type: "residential",
  rent_monthly_yen: 50000, location: { prefecture: "高知県", city: "四万十町" },
  tags: { labels: { renovation_needed: "unknown" } } };
const mr = Import.fromPipeline(pRent, 1);
check("賃貸 price=null", mr.price === null);
check("賃貸 priceText 月額", mr.priceText === "5万円/月");
check("deal_type rent → 賃貸", mr.transactionType === "賃貸");
check("renovation unknown → null", mr.renovationRequired === null);

// 成約済みは loadRecords で除外される
const tmp = path.join(root, "data/_pipeline_test.json");
fs.writeFileSync(tmp, JSON.stringify([pSale, { ...pSale, id: "p-closed", status: "closed" }]));
const loaded = Import.loadRecords(tmp);
fs.unlinkSync(tmp);
check("closed は取り込み除外(1件のみ)", loaded.length === 1 && loaded[0].id === "p-001");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
