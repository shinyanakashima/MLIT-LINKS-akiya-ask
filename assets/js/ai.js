// ai.js — AI検索クライアント(サーバ経路)
// 公開時(Cloudflare Pages): /api/search (Pages Function) 経由で Anthropic API を呼ぶ。
// APIキーはサーバ側に秘匿。サーバが無い/失敗した場合は呼び出し側が
// Filter.parseKeywordQuery(キーワード検索)にフォールバックする。

(function (global) {
  "use strict";

  // 利用可能なモードを判定: "ai" | "none"
  // file:// で開いた静的版にはサーバが無いので "none"。
  // http(s) でも /api/search が応答しない場合(APIエラー・障害時)は、リクエスト時に
  // 失敗 → 呼び出し側がキーワード検索へフォールバックする。
  function mode() {
    if (global.location && /^https?:$/.test(global.location.protocol)) return "ai";
    return "none";
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
    if (mode() === "ai") return viaFunction(text);
    throw new Error("AI検索は利用できません");
  }

  const api = { search, mode };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.AISearch = api;
})(typeof window !== "undefined" ? window : globalThis);
