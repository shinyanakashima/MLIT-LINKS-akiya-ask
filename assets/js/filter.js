// filter.js — フィルタスキーマ、キーワードパーサ(フォールバック)、マッチング
// 依存なし。ブラウザ/Functions の両方から import せず、グローバル window.Filter として公開。

(function (global) {
  "use strict";

  const CURRENT_YEAR = new Date().getFullYear();

  // 空のフィルタ。AI/パーサ出力はこれにマージして正規化する。
  function emptyFilter() {
    return {
      keywords: [],
      prefectures: [],
      municipalities: [],
      priceMin: null,
      priceMax: null,
      buildYearMin: null,
      buildYearMax: null,
      ageMax: null,
      floorAreaMin: null,
      landAreaMin: null,
      propertyTypes: [],
      transactionType: null,
      renovationRequired: null,
      features: [],
    };
  }

  // 外部(AI)由来の値を安全に正規化。未知キーは捨てる。
  function normalize(raw) {
    const f = emptyFilter();
    if (!raw || typeof raw !== "object") return f;
    const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()) : []);
    const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
    f.keywords = arr(raw.keywords);
    f.prefectures = arr(raw.prefectures);
    f.municipalities = arr(raw.municipalities);
    f.propertyTypes = arr(raw.propertyTypes);
    f.features = arr(raw.features).map(canonicalFeature);
    f.priceMin = num(raw.priceMin);
    f.priceMax = num(raw.priceMax);
    f.buildYearMin = num(raw.buildYearMin);
    f.buildYearMax = num(raw.buildYearMax);
    f.ageMax = num(raw.ageMax);
    f.floorAreaMin = num(raw.floorAreaMin);
    f.landAreaMin = num(raw.landAreaMin);
    if (raw.transactionType === "売買" || raw.transactionType === "賃貸") f.transactionType = raw.transactionType;
    if (raw.renovationRequired === true || raw.renovationRequired === false) f.renovationRequired = raw.renovationRequired;
    return f;
  }

  // featuresタグの表記ゆれ正規化
  const FEATURE_SYNONYMS = {
    海近い: ["海", "海辺", "海沿い", "オーシャン", "ビーチ", "漁港"],
    山近い: ["山", "山間", "里山", "高原"],
    川近い: ["川", "河川", "渓流", "川沿い"],
    農地付き: ["農地", "畑", "田んぼ", "田畑", "菜園", "農地付", "畑付き"],
    温泉近い: ["温泉", "湯治"],
    駐車場あり: ["駐車場", "車庫", "ガレージ"],
  };
  function canonicalFeature(word) {
    const w = String(word).trim();
    for (const canon in FEATURE_SYNONYMS) {
      if (w === canon) return canon;
      if (FEATURE_SYNONYMS[canon].some((s) => w.includes(s))) return canon;
    }
    return w;
  }

  // ---- キーワードパーサ(公開時/AIなし時のフォールバック) ----
  // 完全な自然言語理解は行わず、価格・築年・地名・特徴の素朴な抽出に徹する。
  const PREF_LIST = [
    "北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県",
    "埼玉県","千葉県","東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県",
    "岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県",
    "鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県",
    "佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県",
  ];
  const PROPERTY_TYPES = ["古民家", "一戸建て", "戸建", "マンション", "アパート", "土地", "店舗", "別荘"];

  // 「300万」「300万円」「3000000円」等 → 円
  function parseYen(text, anchorRegex) {
    const m = text.match(anchorRegex);
    if (!m) return null;
    const numStr = m[1].replace(/,/g, "");
    let val = parseFloat(numStr);
    if (isNaN(val)) return null;
    if (m[2] === "万") val *= 10000;
    else if (m[2] === "億") val *= 100000000;
    return Math.round(val);
  }

  function parseKeywordQuery(text) {
    const f = emptyFilter();
    if (!text || !text.trim()) return f;
    const q = text.trim();

    // 価格上限: 「〜以内」「〜以下」「予算〜」「〜まで」
    f.priceMax =
      parseYen(q, /(\d[\d,\.]*)\s*(万|億)?円?\s*(?:以内|以下|まで)/) ||
      parseYen(q, /予算\s*(\d[\d,\.]*)\s*(万|億)?円?/);
    // 価格下限: 「〜以上」「〜から」
    f.priceMin = parseYen(q, /(\d[\d,\.]*)\s*(万|億)?円?\s*(?:以上|から)/);

    // 築年数上限: 「築30年以内」
    const ageM = q.match(/築\s*(\d+)\s*年\s*(?:以内|以下|まで)?/);
    if (ageM) f.ageMax = parseInt(ageM[1], 10);
    // 西暦下限: 「1980年以降」
    const byMin = q.match(/(\d{4})\s*年\s*(?:以降|以後|より新しい)/);
    if (byMin) f.buildYearMin = parseInt(byMin[1], 10);

    // 都道府県
    f.prefectures = PREF_LIST.filter((p) => q.includes(p) || q.includes(p.replace(/[都道府県]$/, "")));

    // 種別
    for (const t of PROPERTY_TYPES) {
      if (q.includes(t)) {
        const norm = t === "戸建" ? "一戸建て" : t;
        if (!f.propertyTypes.includes(norm)) f.propertyTypes.push(norm);
      }
    }

    // 取引種別
    if (q.includes("賃貸")) f.transactionType = "賃貸";
    else if (q.includes("売買") || q.includes("購入") || q.includes("売り")) f.transactionType = "売買";

    // 改修
    if (/(改修不要|リフォーム不要|改装済|リフォーム済|即入居)/.test(q)) f.renovationRequired = false;
    else if (/(要改修|要リフォーム|要修繕|DIY)/.test(q)) f.renovationRequired = true;

    // 特徴タグ
    const seen = new Set();
    for (const canon in FEATURE_SYNONYMS) {
      if (FEATURE_SYNONYMS[canon].some((s) => q.includes(s)) || q.includes(canon)) {
        if (!seen.has(canon)) { f.features.push(canon); seen.add(canon); }
      }
    }

    // 残った特徴的な語をキーワードに(地名・特徴・種別・数値を除いた素の語は拾いにくいので
    // ここでは「古民家」等の種別語をキーワードにも入れて全文検索の取りこぼしを防ぐ)
    for (const t of PROPERTY_TYPES) if (q.includes(t)) f.keywords.push(t);

    return f;
  }

  // ---- マッチング ----
  function matches(item, f) {
    // キーワード(AND・全文)
    if (f.keywords.length) {
      const hay = [item.strongPoints, item.address, item.municipality, item.prefecture, item.propertyType, (item.features || []).join(" ")]
        .filter(Boolean).join(" ");
      if (!f.keywords.every((k) => hay.includes(k))) return false;
    }
    // 都道府県(OR)
    if (f.prefectures.length && !f.prefectures.some((p) => item.prefecture && item.prefecture.includes(p.replace(/[都道府県]$/, "")))) return false;
    // 市区町村(OR)
    if (f.municipalities.length && !f.municipalities.some((m) => item.municipality === m || (item.municipality && item.municipality.includes(m)))) return false;
    // 種別(OR)
    if (f.propertyTypes.length && !f.propertyTypes.includes(item.propertyType)) return false;
    // 取引種別
    if (f.transactionType && item.transactionType !== f.transactionType) return false;
    // 価格
    if (f.priceMin != null) { if (item.price == null || item.price < f.priceMin) return false; }
    if (f.priceMax != null) { if (item.price == null || item.price > f.priceMax) return false; }
    // 築年
    if (f.buildYearMin != null) { if (item.buildYear == null || item.buildYear < f.buildYearMin) return false; }
    if (f.buildYearMax != null) { if (item.buildYear == null || item.buildYear > f.buildYearMax) return false; }
    if (f.ageMax != null) { if (item.buildYear == null || (CURRENT_YEAR - item.buildYear) > f.ageMax) return false; }
    // 面積
    if (f.floorAreaMin != null) { if (item.floorArea == null || item.floorArea < f.floorAreaMin) return false; }
    if (f.landAreaMin != null) { if (item.landArea == null || item.landArea < f.landAreaMin) return false; }
    // 改修
    if (f.renovationRequired != null && item.renovationRequired !== f.renovationRequired) return false;
    // 特徴(AND)
    if (f.features.length) {
      const tags = (item.features || []).map(canonicalFeature);
      if (!f.features.every((feat) => tags.includes(feat))) return false;
    }
    return true;
  }

  function applyFilter(items, f) {
    return items.filter((it) => matches(it, f));
  }

  // フィルタが実質「空(条件なし)」か
  function isEmpty(f) {
    return (
      !f.keywords.length && !f.prefectures.length && !f.municipalities.length &&
      !f.propertyTypes.length && !f.features.length &&
      f.priceMin == null && f.priceMax == null && f.buildYearMin == null &&
      f.buildYearMax == null && f.ageMax == null && f.floorAreaMin == null &&
      f.landAreaMin == null && !f.transactionType && f.renovationRequired == null
    );
  }

  const api = { emptyFilter, normalize, parseKeywordQuery, applyFilter, matches, isEmpty, canonicalFeature, CURRENT_YEAR };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.Filter = api;
})(typeof window !== "undefined" ? window : globalThis);
