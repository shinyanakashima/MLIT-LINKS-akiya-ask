#!/usr/bin/env node
// 取得スクリプト: MLIT-LINKS-akiya-pipeline の GitHub Release 成果物を取得し、
// scripts/import.mjs(Stage2 アダプタ)で data/akiya.json を生成する。
//
// 使い方:
//   node scripts/fetch-dataset.mjs [tag] [--out <path>] [--keep-raw]
//   例) node scripts/fetch-dataset.mjs                 # 既定タグを取得→import
//       node scripts/fetch-dataset.mjs data-2026.1.0   # 翌年版に切替
//
// 成果物は CC-BY-4.0(出典: 国交省 Project LINKS 空き家バンク)。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadRecords } from "./import.mjs";

const REPO = "shinyanakashima/MLIT-LINKS-akiya-pipeline";
const DEFAULT_TAG = "data-2025.1.0";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
  const opts = { tag: DEFAULT_TAG, out: path.join(root, "data", "akiya.json"), keepRaw: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") opts.out = argv[++i];
    else if (a === "--keep-raw") opts.keepRaw = true;
    else rest.push(a);
  }
  if (rest[0]) opts.tag = rest[0];
  return opts;
}

// GitHub Release 資産URL。資産名はタグ年度から導出(akiya-<year>.json)。
function assetUrls(tag) {
  const m = tag.match(/(\d{4})/);
  if (!m) throw new Error(`タグから年度を判定できません: ${tag}`);
  const year = m[1];
  const base = `https://github.com/${REPO}/releases/download/${tag}`;
  return { year, dataset: `${base}/akiya-${year}.json`, manifest: `${base}/manifest.json` };
}

// ネットワーク失敗時は指数バックオフで最大4回リトライ。
async function download(url, dest) {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(dest, buf);
      return buf.length;
    } catch (e) { lastErr = e; }
  }
  throw new Error(`取得失敗(${4}回試行): ${lastErr && lastErr.message}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const urls = assetUrls(opts.tag);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "akiya-"));
  const rawPath = path.join(opts.keepRaw ? path.join(root, "data") : tmp, `akiya-${urls.year}.json`);
  const manifestPath = path.join(tmp, "manifest.json");

  console.log(`タグ ${opts.tag} の成果物を取得します...`);
  try {
    const mBytes = await download(urls.manifest, manifestPath);
    console.log(`  manifest.json  (${mBytes} bytes)`);
  } catch (e) {
    console.warn(`  manifest.json 取得スキップ: ${e.message}`); // 件数照合は任意
  }
  const dBytes = await download(urls.dataset, rawPath);
  console.log(`  akiya-${urls.year}.json  (${(dBytes / 1e6).toFixed(1)} MB)`);

  // Stage2 アダプタで本アプリのスキーマへ変換(closed 除外はアダプタ側で実施)。
  const records = loadRecords(rawPath);
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(opts.out, JSON.stringify(records, null, 0) + "\n", "utf8");
  console.log(`取り込み完了: ${records.length} 件 → ${path.relative(root, opts.out)}`);

  // manifest があれば件数を照合(我々は status==closed を除外 → registered と一致するはず)。
  if (fs.existsSync(manifestPath)) {
    try {
      const man = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const expected = man.record_counts && man.record_counts.registered;
      if (typeof expected === "number") {
        const ok = records.length === expected;
        console.log(`件数照合: 出力 ${records.length} / manifest.registered ${expected} → ${ok ? "一致 ✓" : "不一致 ⚠"}`);
        if (!ok) process.exitCode = 2;
      }
    } catch (e) { /* 照合は任意 */ }
  }

  if (!opts.keepRaw) fs.rmSync(tmp, { recursive: true, force: true });
}

// テストから import する場合は main を実行しない(直接起動時のみ取得を走らせる)。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("エラー:", e.message); process.exit(1); });
}

export { parseArgs, assetUrls, DEFAULT_TAG, REPO };
