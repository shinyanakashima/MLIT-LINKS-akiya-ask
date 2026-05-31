// ai.js — 二系統のAI検索クライアント
// 1) claude.ai アーティファクト内: window.claude.complete を直接利用
// 2) 公開時(Cloudflare Pages): /api/search (Pages Function, APIキー秘匿)
// どちらも使えない/失敗した場合は呼び出し側が Filter.parseKeywordQuery にフォールバックする。

(function (global) {
  "use strict";

  function hasArtifactAPI() {
    return typeof global.claude === "object" && global.claude && typeof global.claude.complete === "function";
  }

  // 利用可能なモードを判定: "artifact" | "function" | "none"
  // function モードの実在確認はリクエスト時に行う(起動時の余計なfetchを避ける)。
  function mode() {
    if (hasArtifactAPI()) return "artifact";
    // file:// で開いた静的版や GitHub Pages では Function は無い。
    if (global.location && /^https?:$/.test(global.location.protocol)) return "function";
    return "none";
  }

  async function viaArtifact(text) {
    const prompt = `${global.Prompt.SYSTEM}\n\n${global.Prompt.buildUserPrompt(text)}`;
    const raw = await global.claude.complete(prompt);
    const obj = global.Prompt.extractFilterJSON(raw);
    if (!obj) throw new Error("AI応答をJSONとして解釈できませんでした");
    return global.Filter.normalize(obj);
  }

  async function viaFunction(text) {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: text }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`/api/search ${res.status} ${detail.slice(0, 120)}`);
    }
    const data = await res.json();
    // Function は正規化前のフィルタを返す。クライアントでも正規化して二重に守る。
    return global.Filter.normalize(data.filter || data);
  }

  // 自然文 → 正規化済みフィルタ。失敗時は例外を投げる(呼び出し側でフォールバック)。
  async function search(text) {
    switch (mode()) {
      case "artifact": return viaArtifact(text);
      case "function": return viaFunction(text);
      default: throw new Error("AI検索は利用できません");
    }
  }

  const api = { search, mode, hasArtifactAPI };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.AISearch = api;
})(typeof window !== "undefined" ? window : globalThis);
