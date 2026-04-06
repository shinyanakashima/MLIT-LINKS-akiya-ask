// prompt.js — 自然文→フィルタJSON 変換プロンプト(クライアント/Functions 共用)
// JSONのみを返すよう厳格に指示する。

(function (global) {
  "use strict";

  const FILTER_SHAPE = `{
  "keywords": string[],          // PR文や所在地への部分一致語(任意の特徴語)
  "prefectures": string[],       // 都道府県名(例: "長崎県")。OR
  "municipalities": string[],    // 市区町村名(例: "南島原市")。OR
  "priceMin": number|null,       // 円
  "priceMax": number|null,       // 円(例: 300万円 → 3000000)
  "buildYearMin": number|null,   // 西暦
  "buildYearMax": number|null,   // 西暦
  "ageMax": number|null,         // 築年数上限(年)
  "floorAreaMin": number|null,   // 延床面積㎡
  "landAreaMin": number|null,    // 土地面積㎡
  "propertyTypes": string[],     // "古民家"|"一戸建て"|"マンション"|"土地"|"店舗"|"別荘" 等。OR
  "transactionType": "売買"|"賃貸"|null,
  "renovationRequired": true|false|null, // true=要改修のみ false=改修不要のみ null=不問
  "features": string[]           // "海近い"|"山近い"|"川近い"|"農地付き"|"温泉近い"|"駐車場あり" から該当を選ぶ。AND
}`;

  const SYSTEM = `あなたは日本の空き家・移住物件検索の入力解析器です。ユーザーの日本語の要望を、検索フィルタJSONに変換します。

出力は厳密に次のスキーマのJSONオブジェクト1つだけ。前後に説明文・コードフェンス・改行以外の文字を一切付けないこと。

スキーマ:
${FILTER_SHAPE}

規則:
- 価格「300万」「300万円」は円に換算(3000000)。「予算300万」「300万以内」「300万まで」は priceMax。
- 「築30年以内」は ageMax=30。年代「1980年以降」は buildYearMin=1980。
- features は列挙した6種から該当するものだけを選ぶ。新語を発明しない。表現が曖昧なら keywords に入れる。
- 該当しない項目は null または空配列 []。推測で埋めない。
- 都道府県/市区町村は要望に明示された地名のみ。`;

  function buildUserPrompt(text) {
    return `次の要望をフィルタJSONに変換してください。JSONのみ出力:\n\n要望: ${text}`;
  }

  // 任意テキストから最初のJSONオブジェクトを抜き出して安全にパース。
  function extractFilterJSON(raw) {
    if (typeof raw !== "string") return null;
    let s = raw.trim();
    // ```json ... ``` フェンス除去
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    // 最初の { から対応する } までを括弧カウントで抽出
    const start = s.indexOf("{");
    if (start === -1) return null;
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
      } else {
        if (c === '"') inStr = true;
        else if (c === "{") depth++;
        else if (c === "}") { depth--; if (depth === 0) { end = i; break; } }
      }
    }
    if (end === -1) return null;
    try {
      return JSON.parse(s.slice(start, end + 1));
    } catch (e) {
      return null;
    }
  }

  const api = { SYSTEM, buildUserPrompt, extractFilterJSON, FILTER_SHAPE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.Prompt = api;
})(typeof window !== "undefined" ? window : globalThis);
