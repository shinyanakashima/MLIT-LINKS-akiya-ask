// i18n.js — UI文言の日本語/英語辞書とヘルパー(window.I18N)
// 物件データ(住所・PR文・価格表記など)は翻訳対象外。UIラベルと、種別/特徴タグの
// 有限な語彙のみ英語化する。app.js から t()/feature()/propertyType() で参照する。

(function (global) {
  "use strict";

  const DICT = {
    ja: {
      title: "空き家ファインダー｜日本語で問いかけて探す格安空き家",
      appName: "空き家ファインダー",
      lead: "日本語で問いかけて探す、格安空き家・移住先。",
      placeholder: "例)予算300万以内、農地付き、海の近くで古民家",
      search: "検索", searching: "検索中…", clear: "クリア",
      examplesLabel: "例:",      examples: [
        "予算300万以内、農地付き、海の近くで古民家",
        "築30年以内で改修不要、駐車場あり",
        "高知県の川の近く、200万円まで",
        "離島で温泉が近い物件",
      ],
      prefAll: "都道府県(すべて)", muniAll: "市区町村(すべて)",
      prefAria: "都道府県", muniAria: "市区町村",
      langBtn: "EN", langBtnAria: "Switch to English",
      keywordNote: "", // 日本語モードでは非表示(英語モードのみ表示)
      modeAi: "AI検索 + キーワード", modeKeyword: "キーワード検索",
      empty: "条件に合う物件がありません。条件をゆるめてみてください。",
      source: "自治体バンク原典 ↗",
      renovReq: "要改修", renovNo: "改修不要", priceAsk: "応相談",
      footerHtml: 'データ出典: 国土交通省 Project LINKS <a href="https://www.geospatial.jp/ckan/dataset/links-akiyabank-2025" target="_blank" rel="noopener noreferrer">空き家バンク登録物件(2025年度)</a>。物件の最新状況は各自治体バンク原典をご確認ください。',
      chipKeyword: "キーワード", chipPref: "都道府県", chipMuni: "市区町村", chipType: "種別",
      noCondition: "条件なし(全件)", txSale: "売買", txRent: "賃貸",
      statusSample: "サンプルデータを表示中(data/akiya.json を置くと本番データに切替)",
      statusLoadError: "データを読み込めませんでした。data/akiya.json または data/akiya.sample.json を配置してください。",
      statusCleared: "条件をクリアしました",
      viaAI: "AI", viaKeyword: "キーワード検索",
      count: (n) => `${n.toLocaleString("ja-JP")}件`,
      loaded: (n) => `${n.toLocaleString("ja-JP")}件のデータを読込`,
      more: (n) => `もっと見る(残り${n.toLocaleString("ja-JP")}件)`,
      parsed: (q, via) => `「${q}」を${via}で解析しました`,
      ageMeta: (age, year) => `築${age}年(${year})`,
      priceMax: (s) => `〜${s}`,
      priceMin: (s) => `${s}〜`,
      ageMax: (n) => `築${n}年以内`,
      buildYearMin: (n) => `${n}年以降`,
    },
    en: {
      title: "Akiya Finder — search cheap vacant houses across Japan",
      appName: "Akiya Finder",
      lead: "Search Japan's vacant-house listings by asking in plain language.",
      placeholder: "e.g. kominka near the sea with farmland, under 3M yen",
      search: "Search", searching: "Searching…", clear: "Clear",
      examplesLabel: "Examples:",
      examples: [
        "kominka near the sea with farmland, under 3M yen",
        "no renovation needed, built within 30 years, with parking",
        "near a river in Kochi, up to 2M yen",
        "near a hot spring on a remote island",
      ],
      prefAll: "Prefecture (all)", muniAll: "City / town (all)",
      prefAria: "Prefecture", muniAria: "City / town",
      langBtn: "日本語", langBtnAria: "日本語に切り替え",
      keywordNote: "Note: English queries work via AI search only. The keyword fallback (used when AI search is unavailable) supports Japanese input only.",
      modeAi: "AI + keyword", modeKeyword: "Keyword",
      empty: "No properties match. Try loosening your criteria.",
      source: "Source: municipal bank ↗",
      renovReq: "Needs renovation", renovNo: "Move-in ready", priceAsk: "Ask",
      footerHtml: 'Data: MLIT Project LINKS <a href="https://www.geospatial.jp/ckan/dataset/links-akiyabank-2025" target="_blank" rel="noopener noreferrer">Vacant House Bank listings (FY2025)</a>. Check each municipal bank for the latest status.',
      chipKeyword: "Keywords", chipPref: "Prefecture", chipMuni: "City/town", chipType: "Type",
      noCondition: "No filter (all)", txSale: "For sale", txRent: "For rent",
      statusSample: "Showing sample data (add data/akiya.json for production data)",
      statusLoadError: "Failed to load data. Place data/akiya.json or data/akiya.sample.json.",
      statusCleared: "Filters cleared",
      viaAI: "AI", viaKeyword: "keyword search",
      count: (n) => `${n.toLocaleString("en-US")} ${n === 1 ? "result" : "results"}`,
      loaded: (n) => `Loaded ${n.toLocaleString("en-US")} records`,
      more: (n) => `Show more (${n.toLocaleString("en-US")} remaining)`,
      parsed: (q, via) => `Parsed “${q}” via ${via}`,
      ageMeta: (age, year) => `${age} yrs (${year})`,
      priceMax: (s) => `up to ${s}`,
      priceMin: (s) => `from ${s}`,
      ageMax: (n) => `≤ ${n} yrs old`,
      buildYearMin: (n) => `${n} or newer`,
    },
  };

  // 種別 enum(有限)の英語ラベル
  const PROPERTY_TYPE_EN = {
    "古民家": "Kominka", "一戸建て": "House", "マンション": "Condo",
    "アパート": "Apartment", "土地": "Land", "店舗": "Shop", "別荘": "Villa",
  };
  // 特徴タグ(正規6種)の英語ラベル
  const FEATURE_EN = {
    "海近い": "Near sea", "山近い": "Near mountains", "川近い": "Near river",
    "農地付き": "With farmland", "温泉近い": "Near hot spring", "駐車場あり": "Parking",
  };

  let lang = "ja";

  function t(key, ...args) {
    const table = DICT[lang] || DICT.ja;
    const v = key in table ? table[key] : DICT.ja[key];
    if (typeof v === "function") return v(...args);
    return v == null ? key : v;
  }
  // 物件データ由来の有限語彙。日本語モードでは原文のまま返す。
  function propertyType(jp) { return lang === "en" ? (PROPERTY_TYPE_EN[jp] || jp) : jp; }
  function feature(canon) { return lang === "en" ? (FEATURE_EN[canon] || canon) : canon; }

  function setLang(l) { lang = DICT[l] ? l : "ja"; }
  function getLang() { return lang; }

  const api = { t, propertyType, feature, setLang, getLang };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.I18N = api;
})(typeof window !== "undefined" ? window : globalThis);
