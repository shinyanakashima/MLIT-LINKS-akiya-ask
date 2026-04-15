// app.js — データ読込・UI制御・検索/絞り込み・描画
(function () {
  "use strict";

  const F = window.Filter;
  const T = window.I18N;
  const state = {
    all: [],          // 全物件
    filter: F.emptyFilter(),
    manual: { prefecture: "", municipality: "" }, // 手動セレクト
    results: [],
    shown: 0,         // 現在描画済みの件数(段階描画用)
    lang: "ja",       // UI言語
    status: null,     // 直近ステータスの生成関数(言語切替時に再評価)
    statusError: false,
  };

  const $ = (sel) => document.querySelector(sel);
  const yen = (n) => (n == null ? T.t("priceAsk") : "¥" + n.toLocaleString("ja-JP"));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---- データ読込: 正規化JSON優先、なければサンプル ----
  async function loadData() {
    const candidates = ["data/akiya.json", "data/akiya.sample.json"];
    for (const url of candidates) {
      try {
        const res = await fetch(url, { cache: "no-cache" });
        if (!res.ok) continue;
        const json = await res.json();
        if (Array.isArray(json) && json.length) {
          if (url.endsWith("sample.json")) setStatus(() => T.t("statusSample"));
          else setStatus(() => T.t("loaded", json.length));
          return json;
        }
      } catch (e) { /* 次の候補へ */ }
    }
    setStatus(() => T.t("statusLoadError"), true);
    return [];
  }

  // ---- 都道府県/市区町村セレクト構築 ----
  function buildLocationSelects() {
    const prefSel = $("#pref-select");
    const muniSel = $("#muni-select");
    const prefs = [...new Set(state.all.map((x) => x.prefecture).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
    prefSel.innerHTML = `<option value="">${esc(T.t("prefAll"))}</option>` + prefs.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("");

    function refreshMuni() {
      const p = prefSel.value;
      const munis = [...new Set(state.all.filter((x) => !p || x.prefecture === p).map((x) => x.municipality).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
      muniSel.innerHTML = `<option value="">${esc(T.t("muniAll"))}</option>` + munis.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
      muniSel.disabled = munis.length === 0;
    }
    refreshMuni();
    prefSel.addEventListener("change", () => { state.manual.prefecture = prefSel.value; refreshMuni(); state.manual.municipality = ""; render(); });
    muniSel.addEventListener("change", () => { state.manual.municipality = muniSel.value; render(); });
  }

  // 手動セレクトを現在のフィルタにマージ(手動が優先・追加条件)
  function effectiveFilter() {
    const f = F.normalize(state.filter);
    if (state.manual.prefecture) f.prefectures = [state.manual.prefecture];
    if (state.manual.municipality) f.municipalities = [state.manual.municipality];
    return f;
  }

  // ---- 描画 ----
  // 全件(最大7千件超)を一度に innerHTML へ流すと重いので、PAGE_SIZE 単位で
  // 段階描画する。「もっと見る」で続きを追記。
  const PAGE_SIZE = 60;

  function render() {
    const f = effectiveFilter();
    state.results = F.applyFilter(state.all, f);
    $("#count").textContent = T.t("count", state.results.length);
    renderChips(f);
    const list = $("#results");
    if (!state.results.length) {
      list.innerHTML = `<li class="empty">${esc(T.t("empty"))}</li>`;
      state.shown = 0;
      updateMore();
      return;
    }
    // 先頭ページを描画(置き換え)。
    state.shown = Math.min(PAGE_SIZE, state.results.length);
    list.innerHTML = state.results.slice(0, state.shown).map(cardHTML).join("");
    updateMore();
  }

  // 続きを追記(全置換せず append でDOM負荷を抑える)。
  function showMore() {
    const next = Math.min(state.shown + PAGE_SIZE, state.results.length);
    const html = state.results.slice(state.shown, next).map(cardHTML).join("");
    $("#results").insertAdjacentHTML("beforeend", html);
    state.shown = next;
    updateMore();
  }

  // 「もっと見る」ボタンの表示・文言を現在の表示件数に合わせる。
  function updateMore() {
    const more = $("#more");
    const remaining = state.results.length - state.shown;
    if (remaining > 0) {
      $("#more-btn").textContent = T.t("more", remaining);
      more.hidden = false;
    } else {
      more.hidden = true;
    }
  }

  function cardHTML(it) {
    const meta = [
      it.propertyType ? T.propertyType(it.propertyType) : null,
      it.buildYear ? T.t("ageMeta", F.CURRENT_YEAR - it.buildYear, it.buildYear) : null,
      it.structure,
      it.floorArea ? `${it.floorArea}㎡` : null,
      it.renovationRequired === true ? T.t("renovReq") : it.renovationRequired === false ? T.t("renovNo") : null,
    ].filter(Boolean);
    const tags = (it.features || []).map((t) => `<span class="tag">${esc(T.feature(t))}</span>`).join("");
    const link = it.sourceUrl ? `<a class="source" href="${esc(it.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(T.t("source"))}</a>` : "";
    return `<li class="card">
      <div class="card-head">
        <span class="place">${esc(it.prefecture || "")} ${esc(it.municipality || "")}</span>
        <span class="price">${esc(it.priceText || yen(it.price))}</span>
      </div>
      <div class="meta">${meta.map((m) => `<span>${esc(m)}</span>`).join("")}</div>
      ${tags ? `<div class="tags">${tags}</div>` : ""}
      ${it.strongPoints ? `<p class="pr">${esc(it.strongPoints)}</p>` : ""}
      ${link}
    </li>`;
  }

  // 適用中条件のチップ表示
  function renderChips(f) {
    const chips = [];
    if (f.keywords.length) chips.push(`${T.t("chipKeyword")}: ${f.keywords.join(" / ")}`);
    if (f.prefectures.length) chips.push(`${T.t("chipPref")}: ${f.prefectures.join("・")}`);
    if (f.municipalities.length) chips.push(`${T.t("chipMuni")}: ${f.municipalities.join("・")}`);
    if (f.priceMax != null) chips.push(T.t("priceMax", yen(f.priceMax)));
    if (f.priceMin != null) chips.push(T.t("priceMin", yen(f.priceMin)));
    if (f.ageMax != null) chips.push(T.t("ageMax", f.ageMax));
    if (f.buildYearMin != null) chips.push(T.t("buildYearMin", f.buildYearMin));
    if (f.propertyTypes.length) chips.push(`${T.t("chipType")}: ${f.propertyTypes.map((t) => T.propertyType(t)).join("・")}`);
    if (f.transactionType) chips.push(f.transactionType === "売買" ? T.t("txSale") : T.t("txRent"));
    if (f.renovationRequired === true) chips.push(T.t("renovReq"));
    if (f.renovationRequired === false) chips.push(T.t("renovNo"));
    f.features.forEach((x) => chips.push(T.feature(x)));
    $("#chips").innerHTML = chips.length ? chips.map((c) => `<span class="chip">${esc(c)}</span>`).join("") : `<span class="chip muted">${esc(T.t("noCondition"))}</span>`;
  }

  // ステータスは「生成関数」で保持し、言語切替時に再評価できるようにする。
  function setStatus(producer, isError) {
    state.status = typeof producer === "function" ? producer : (producer ? () => producer : null);
    state.statusError = !!isError;
    const el = $("#status");
    el.textContent = state.status ? state.status() : "";
    el.classList.toggle("error", !!isError);
  }

  function setSearching(on) {
    $("#search-btn").disabled = on;
    $("#search-btn").textContent = on ? T.t("searching") : T.t("search");
  }

  // 例文ボタンを現在の言語で描画(クリックで本文を検索)。
  function renderExamples() {
    const box = $("#examples");
    const label = `<span>${esc(T.t("examplesLabel"))}</span>`;
    const btns = T.t("examples").map((ex) => `<button class="example">${esc(ex)}</button>`).join("");
    box.innerHTML = label + btns;
    box.querySelectorAll(".example").forEach((b) =>
      b.addEventListener("click", () => { $("#query").value = b.textContent; runSearch(); }));
  }

  function updateBadge() {
    $("#mode-badge").textContent = window.AISearch.mode() === "ai" ? T.t("modeAi") : T.t("modeKeyword");
  }

  // 言語を適用(静的ラベル・属性・例文・セレクト・バッジ・結果・ステータスを再描画)。
  function applyLang(lang) {
    state.lang = lang;
    T.setLang(lang);
    try { localStorage.setItem("akiya-lang", lang); } catch (e) { /* 無視 */ }
    document.documentElement.lang = lang;
    document.title = T.t("title");
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = T.t(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = T.t(el.dataset.i18nHtml); });
    document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = T.t(el.dataset.i18nPh); });
    document.querySelectorAll("[data-i18n-aria]").forEach((el) => { el.setAttribute("aria-label", T.t(el.dataset.i18nAria)); });
    const langBtn = $("#lang-btn");
    langBtn.textContent = T.t("langBtn");
    langBtn.setAttribute("aria-label", T.t("langBtnAria"));
    renderExamples();
    // セレクトの「すべて」ラベルを更新(選択値は保持)。
    const ps = $("#pref-select"), ms = $("#muni-select");
    if (ps.options[0]) ps.options[0].textContent = T.t("prefAll");
    if (ms.options[0]) ms.options[0].textContent = T.t("muniAll");
    if (!$("#search-btn").disabled) $("#search-btn").textContent = T.t("search");
    updateBadge();
    render();
    // ステータスを現在言語で再評価。
    const el = $("#status");
    el.textContent = state.status ? state.status() : "";
    el.classList.toggle("error", state.statusError);
  }

  // ---- 検索実行 ----
  async function runSearch() {
    const text = $("#query").value.trim();
    if (!text) { state.filter = F.emptyFilter(); render(); return; }
    setSearching(true);
    try {
      let filter, viaKey;
      try {
        filter = await window.AISearch.search(text);
        viaKey = "viaAI";
      } catch (aiErr) {
        // フォールバック: キーワードパーサ
        filter = F.parseKeywordQuery(text);
        viaKey = "viaKeyword";
        console.warn("AI検索フォールバック:", aiErr && aiErr.message);
      }
      state.filter = filter;
      setStatus(() => T.t("parsed", text, T.t(viaKey)));
      render();
    } finally {
      setSearching(false);
    }
  }

  function bindUI() {
    $("#search-btn").addEventListener("click", runSearch);
    $("#more-btn").addEventListener("click", showMore);
    $("#lang-btn").addEventListener("click", () => applyLang(state.lang === "ja" ? "en" : "ja"));
    $("#query").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) { e.preventDefault(); runSearch(); } });
    $("#clear-btn").addEventListener("click", () => {
      $("#query").value = "";
      $("#pref-select").value = ""; $("#muni-select").value = "";
      state.manual = { prefecture: "", municipality: "" };
      state.filter = F.emptyFilter();
      $("#pref-select").dispatchEvent(new Event("change"));
      setStatus(() => T.t("statusCleared"));
    });
  }

  async function init() {
    let saved = "ja";
    try { saved = localStorage.getItem("akiya-lang") || "ja"; } catch (e) { /* 無視 */ }
    state.lang = saved; T.setLang(saved);
    bindUI();
    state.all = await loadData();
    buildLocationSelects();
    applyLang(saved); // 静的ラベル・例文・結果・ステータスを一括描画
  }

  document.addEventListener("DOMContentLoaded", init);
})();
