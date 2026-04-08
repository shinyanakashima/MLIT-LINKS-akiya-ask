// app.js — データ読込・UI制御・検索/絞り込み・描画
(function () {
  "use strict";

  const F = window.Filter;
  const state = {
    all: [],          // 全物件
    filter: F.emptyFilter(),
    manual: { prefecture: "", municipality: "" }, // 手動セレクト
    results: [],
  };

  const $ = (sel) => document.querySelector(sel);
  const yen = (n) => (n == null ? "応相談" : "¥" + n.toLocaleString("ja-JP"));
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
          setStatus(url.endsWith("sample.json") ? "サンプルデータを表示中(data/akiya.json を置くと本番データに切替)" : `${json.length}件のデータを読込`);
          return json;
        }
      } catch (e) { /* 次の候補へ */ }
    }
    setStatus("データを読み込めませんでした。data/akiya.json または data/akiya.sample.json を配置してください。", true);
    return [];
  }

  // ---- 都道府県/市区町村セレクト構築 ----
  function buildLocationSelects() {
    const prefSel = $("#pref-select");
    const muniSel = $("#muni-select");
    const prefs = [...new Set(state.all.map((x) => x.prefecture).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
    prefSel.innerHTML = '<option value="">都道府県(すべて)</option>' + prefs.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("");

    function refreshMuni() {
      const p = prefSel.value;
      const munis = [...new Set(state.all.filter((x) => !p || x.prefecture === p).map((x) => x.municipality).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
      muniSel.innerHTML = '<option value="">市区町村(すべて)</option>' + munis.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
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
  function render() {
    const f = effectiveFilter();
    state.results = F.applyFilter(state.all, f);
    $("#count").textContent = `${state.results.length}件`;
    renderChips(f);
    const list = $("#results");
    if (!state.results.length) {
      list.innerHTML = '<li class="empty">条件に合う物件がありません。条件をゆるめてみてください。</li>';
      return;
    }
    list.innerHTML = state.results.map(cardHTML).join("");
  }

  function cardHTML(it) {
    const meta = [
      it.propertyType,
      it.buildYear ? `築${F.CURRENT_YEAR - it.buildYear}年(${it.buildYear})` : null,
      it.structure,
      it.floorArea ? `${it.floorArea}㎡` : null,
      it.renovationRequired === true ? "要改修" : it.renovationRequired === false ? "改修不要" : null,
    ].filter(Boolean);
    const tags = (it.features || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
    const link = it.sourceUrl ? `<a class="source" href="${esc(it.sourceUrl)}" target="_blank" rel="noopener noreferrer">自治体バンク原典 ↗</a>` : "";
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
    if (f.keywords.length) chips.push(`キーワード: ${f.keywords.join(" / ")}`);
    if (f.prefectures.length) chips.push(`都道府県: ${f.prefectures.join("・")}`);
    if (f.municipalities.length) chips.push(`市区町村: ${f.municipalities.join("・")}`);
    if (f.priceMax != null) chips.push(`〜${yen(f.priceMax)}`);
    if (f.priceMin != null) chips.push(`${yen(f.priceMin)}〜`);
    if (f.ageMax != null) chips.push(`築${f.ageMax}年以内`);
    if (f.buildYearMin != null) chips.push(`${f.buildYearMin}年以降`);
    if (f.propertyTypes.length) chips.push(`種別: ${f.propertyTypes.join("・")}`);
    if (f.transactionType) chips.push(f.transactionType);
    if (f.renovationRequired === true) chips.push("要改修");
    if (f.renovationRequired === false) chips.push("改修不要");
    f.features.forEach((x) => chips.push(x));
    $("#chips").innerHTML = chips.length ? chips.map((c) => `<span class="chip">${esc(c)}</span>`).join("") : '<span class="chip muted">条件なし(全件)</span>';
  }

  function setStatus(msg, isError) {
    const el = $("#status");
    el.textContent = msg;
    el.classList.toggle("error", !!isError);
  }

  function setSearching(on) {
    $("#search-btn").disabled = on;
    $("#search-btn").textContent = on ? "検索中…" : "検索";
  }

  // ---- 検索実行 ----
  async function runSearch() {
    const text = $("#query").value.trim();
    if (!text) { state.filter = F.emptyFilter(); render(); return; }
    setSearching(true);
    try {
      let filter, via;
      try {
        filter = await window.AISearch.search(text);
        via = "AI";
      } catch (aiErr) {
        // フォールバック: キーワードパーサ
        filter = F.parseKeywordQuery(text);
        via = "キーワード検索";
        console.warn("AI検索フォールバック:", aiErr && aiErr.message);
      }
      state.filter = filter;
      setStatus(`「${text}」を${via}で解析しました`);
      render();
    } finally {
      setSearching(false);
    }
  }

  function bindUI() {
    $("#search-btn").addEventListener("click", runSearch);
    $("#query").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) { e.preventDefault(); runSearch(); } });
    $("#clear-btn").addEventListener("click", () => {
      $("#query").value = "";
      $("#pref-select").value = ""; $("#muni-select").value = "";
      state.manual = { prefecture: "", municipality: "" };
      state.filter = F.emptyFilter();
      $("#pref-select").dispatchEvent(new Event("change"));
      setStatus("条件をクリアしました");
    });
    // 例文クリック
    document.querySelectorAll(".example").forEach((b) =>
      b.addEventListener("click", () => { $("#query").value = b.textContent; runSearch(); }));
    // モード表示
    const m = window.AISearch.mode();
    $("#mode-badge").textContent = m === "ai" ? "AI検索 + キーワード" : "キーワード検索";
  }

  async function init() {
    bindUI();
    state.all = await loadData();
    buildLocationSelects();
    render();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
