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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
