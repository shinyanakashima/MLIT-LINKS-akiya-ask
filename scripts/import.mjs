#!/usr/bin/env node
// 取り込みスクリプト: MLIT-LINKS-akiya-pipeline の正規化JSON、または生CSVを
// 本アプリのスキーマ(docs/schema.md)へ変換し data/akiya.json を生成する。
//
// 使い方:
//   node scripts/import.mjs <input.json|input.csv> [output.json]
//   既定の出力先は data/akiya.json
//
// 正規化JSONがすでに本スキーマ準拠ならほぼ素通し。CSVは列名の部分一致で対応付ける。

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const FEATURE_SYNONYMS = {
  海近い: ["海", "海辺", "海沿い", "ビーチ", "漁港"],
  山近い: ["山", "里山", "高原"],
  川近い: ["川", "渓流", "川沿い"],
  農地付き: ["農地", "畑", "田んぼ", "田畑", "菜園"],
  温泉近い: ["温泉", "湯治"],
  駐車場あり: ["駐車場", "車庫", "ガレージ"],
};

function deriveFeatures(text) {
  const out = [];
  if (!text) return out;
  for (const canon in FEATURE_SYNONYMS) {
    if (FEATURE_SYNONYMS[canon].some((s) => text.includes(s))) out.push(canon);
  }
  return out;
}

// 「300万円」「3,000,000」等 → 円(number)
function parseYen(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[,\s円]/g, "");
  const oku = s.match(/([\d.]+)億/);
  const man = s.match(/([\d.]+)万/);
  if (oku || man) {
    let total = 0;
    if (oku) total += parseFloat(oku[1]) * 1e8;
    if (man) total += parseFloat(man[1]) * 1e4;
    return Math.round(total);
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : Math.round(n);
}

function toNumber(v) {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).replace(/[,\s]/g, ""));
  return isNaN(n) ? null : n;
}

// 和暦/西暦らしき建築年から西暦を推定
function parseYear(v) {
  if (v == null || v === "") return null;
  const s = String(v);
  const w = s.match(/西暦?(\d{4})|(\d{4})\s*年/);
  if (w) return parseInt(w[1] || w[2], 10);
  const era = s.match(/(昭和|平成|令和)\s*(\d+)/);
  if (era) {
    const base = { 昭和: 1925, 平成: 1988, 令和: 2018 }[era[1]];
    return base + parseInt(era[2], 10);
  }
  const n = parseInt(s, 10);
  return n >= 1800 && n <= 2100 ? n : null;
}

// --- 超軽量CSVパーサ(ダブルクオート対応) ---
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inStr = false; }
      else field += c;
    } else if (c === '"') inStr = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      if (field !== "" || row.length) { row.push(field); rows.push(row); row = []; field = ""; }
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ヘッダ名 → 内部キー の部分一致マップ
const COLUMN_HINTS = [
  ["prefecture", ["都道府県", "県名", "pref"]],
  ["municipality", ["市区町村", "市町村", "muni", "city"]],
  ["address", ["所在地", "住所", "address"]],
  ["price", ["価格", "金額", "price", "賃料"]],
  ["buildYear", ["築年", "建築年", "建築年月", "build"]],
  ["structure", ["構造", "structure"]],
  ["floorArea", ["延床", "建物面積", "床面積", "floor"]],
  ["landArea", ["土地面積", "敷地", "land"]],
  ["propertyType", ["種別", "物件種別", "type", "種類"]],
  ["strongPoints", ["strong", "PR", "ＰＲ", "おすすめ", "特徴", "備考", "コメント"]],
  ["sourceUrl", ["url", "ＵＲＬ", "リンク", "原典", "詳細"]],
  ["transactionType", ["取引", "売買賃貸", "種目"]],
  ["id", ["id", "ID", "管理番号", "物件番号"]],
];

function mapHeaders(headers) {
  const map = {};
  headers.forEach((h, idx) => {
    const lower = h.toLowerCase();
    for (const [key, hints] of COLUMN_HINTS) {
      if (map[key] != null) continue;
      if (hints.some((hint) => h.includes(hint) || lower.includes(hint.toLowerCase()))) { map[key] = idx; break; }
    }
  });
  return map;
}

function normalizeRecord(rec, i) {
  const price = parseYen(rec.price);
  const strong = rec.strongPoints || null;
  const tx = rec.transactionType
    ? (String(rec.transactionType).includes("賃") ? "賃貸" : String(rec.transactionType).includes("売") ? "売買" : null)
    : (price != null ? "売買" : null);
  // features: 既にあれば尊重、なければ所在地+PR文から推定
  let features = Array.isArray(rec.features) ? rec.features : [];
  if (!features.length) features = deriveFeatures([rec.address, strong].filter(Boolean).join(" "));
  return {
    id: rec.id != null && rec.id !== "" ? String(rec.id) : `rec-${String(i + 1).padStart(5, "0")}`,
    prefecture: rec.prefecture || null,
    municipality: rec.municipality || null,
    address: rec.address || null,
    price,
    priceText: rec.priceText || (price != null ? `${(price / 10000).toLocaleString("ja-JP")}万円` : "応相談"),
    transactionType: tx,
    buildYear: parseYear(rec.buildYear),
    structure: rec.structure || null,
    floorArea: toNumber(rec.floorArea),
    landArea: toNumber(rec.landArea),
    propertyType: rec.propertyType || null,
    renovationRequired: typeof rec.renovationRequired === "boolean" ? rec.renovationRequired : null,
    features,
    strongPoints: strong,
    sourceUrl: rec.sourceUrl || null,
  };
}

// --- MLIT-LINKS-akiya-pipeline 正規化出力(ネスト/enum)→ 本アプリのフラットスキーマ ---
// パイプラインは Stage1(生データ→構造化・enum化・PR文のAI分類)を担う。ここは
// その出力を表示用スキーマへ射影する Stage2 アダプタ。
// 参照: prompts/akiya-dataset.md(pipeline リポジトリ)

// パイプライン形式の判定: ネストキーや enum 列の存在で見分ける。
function isPipelineRecord(r) {
  return !!r && typeof r === "object" &&
    (r.location != null || r.deal_type != null || r.use_type != null || r.provenance != null || r.tags != null);
}

// use_type / tags / flags から本アプリの種別 enum を導出。
function derivePropertyType(rec) {
  const labels = (rec.tags && rec.tags.labels) || {};
  const flags = rec.flags || {};
  if (labels.kominka) return "古民家";
  if (rec.use_type === "land") return "土地";
  if (rec.use_type === "commercial" || flags.retail_premises) return "店舗";
  if (rec.use_type === "residential") return "一戸建て"; // 既定
  return null;
}

// renovation_needed(required/done/as_is/unknown)→ 三値。
// unknown と欠損は「不明」= null(false へ丸めない)。
function deriveRenovation(rec) {
  const v = rec.tags && rec.tags.labels && rec.tags.labels.renovation_needed;
  if (v === "required") return true;
  if (v === "done" || v === "as_is") return false;
  return null;
}

function fromPipeline(rec, i) {
  const loc = rec.location || {};
  const bld = rec.building || {};
  const land = rec.land || {};
  const labels = (rec.tags && rec.tags.labels) || {};
  const flags = rec.flags || {};
  const prov = rec.provenance || {};

  const isRent = rec.deal_type === "rent";
  const tx = rec.deal_type === "sale" ? "売買" : isRent ? "賃貸" : null;
  // 価格: 売買のみ price に金額を入れる。賃貸は price=null とし、月額は priceText で表示。
  const salePrice = parseYen(rec.price_yen);
  const rentMonthly = parseYen(rec.rent_monthly_yen);
  const price = isRent ? null : salePrice;
  const man = (yen) => `${(yen / 10000).toLocaleString("ja-JP")}万円`;
  const priceText = isRent
    ? (rentMonthly != null ? `${man(rentMonthly)}/月` : "応相談")
    : (salePrice != null ? man(salePrice) : "応相談");

  // features: タグ由来(陽性のみ)+ PR文由来を統合。tags の false は「言及なし」≠「非該当」なので
  // 陽性のみ採用。view_nature は粒度不足のため strong_points から海/山/川/温泉を補完。
  const feats = new Set();
  if (flags.farmland || labels.farmland_attached) feats.add("農地付き");
  if (labels.parking_emphasized) feats.add("駐車場あり");
  for (const f of deriveFeatures(rec.strong_points)) feats.add(f);

  const prefecture = loc.prefecture || null;
  const municipality = loc.city || null;
  const address = [prefecture, municipality].filter(Boolean).join("") || null;

  return {
    id: rec.id != null && rec.id !== "" ? String(rec.id) : `rec-${String(i + 1).padStart(5, "0")}`,
    prefecture,
    municipality,
    address,
    price,
    priceText,
    transactionType: tx,
    buildYear: parseYear(bld.construction_year),
    structure: bld.structure || null,
    floorArea: toNumber(bld.building_area_sqm),
    landArea: toNumber(land.land_area_sqm),
    propertyType: derivePropertyType(rec),
    renovationRequired: deriveRenovation(rec),
    features: [...feats],
    strongPoints: rec.strong_points || null,
    sourceUrl: prov.source_url || null,
  };
}

function loadRecords(file) {
  const raw = fs.readFileSync(file, "utf8");
  if (file.toLowerCase().endsWith(".json")) {
    const json = JSON.parse(raw);
    const arr = Array.isArray(json) ? json : json.items || json.data || json.records || [];
    const out = [];
    arr.forEach((r, i) => {
      if (isPipelineRecord(r)) {
        if (r.status === "closed") return; // 成約済みは除外(募集中のみ表示)
        out.push(fromPipeline(r, i));
      } else {
        out.push(normalizeRecord(r, i)); // 既にフラット/汎用JSON
      }
    });
    return out;
  }
  // CSV
  const rows = parseCSV(raw).filter((r) => r.length && r.some((c) => c !== ""));
  if (!rows.length) return [];
  const headers = rows[0];
  const map = mapHeaders(headers);
  return rows.slice(1).map((cols, i) => {
    const rec = {};
    for (const key in map) rec[key] = (cols[map[key]] || "").trim();
    return normalizeRecord(rec, i);
  });
}

function main() {
  const [input, output = path.join("data", "akiya.json")] = process.argv.slice(2);
  if (!input) {
    console.error("使い方: node scripts/import.mjs <input.json|input.csv> [output.json]");
    process.exit(1);
  }
  const records = loadRecords(input);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(records, null, 0) + "\n", "utf8");
  console.log(`${records.length} 件を ${output} に書き出しました。`);
}

// テストから import する場合は main を実行しない(直接起動時のみ実行)。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

export { fromPipeline, isPipelineRecord, derivePropertyType, deriveRenovation, normalizeRecord, loadRecords };
