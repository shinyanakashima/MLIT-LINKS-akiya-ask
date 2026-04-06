// Cloudflare Pages Function: POST /api/search
// 自然文クエリを Anthropic API でフィルタJSONへ変換して返す。APIキーはサーバ側に秘匿。
// 必要な環境変数: ANTHROPIC_API_KEY
// 任意: ALLOW_ORIGIN(CORS用。未設定なら同一オリジン想定で省略)

const MODEL = "claude-sonnet-4-20250514";

// プロンプトは assets/js/prompt.js と同一仕様(Workers ランタイムのため自己完結で再掲)。
const SYSTEM = `あなたは日本の空き家・移住物件検索の入力解析器です。ユーザーの日本語の要望を、検索フィルタJSONに変換します。

出力は厳密に次のスキーマのJSONオブジェクト1つだけ。前後に説明文・コードフェンス・改行以外の文字を一切付けないこと。

スキーマ:
{
  "keywords": string[],
  "prefectures": string[],
  "municipalities": string[],
  "priceMin": number|null,
  "priceMax": number|null,
  "buildYearMin": number|null,
  "buildYearMax": number|null,
  "ageMax": number|null,
  "floorAreaMin": number|null,
  "landAreaMin": number|null,
  "propertyTypes": string[],
  "transactionType": "売買"|"賃貸"|null,
  "renovationRequired": true|false|null,
  "features": string[]
}

規則:
- 価格「300万」「300万円」は円に換算(3000000)。「予算300万」「300万以内」「300万まで」は priceMax。
- 「築30年以内」は ageMax=30。年代「1980年以降」は buildYearMin=1980。
- features は "海近い"|"山近い"|"川近い"|"農地付き"|"温泉近い"|"駐車場あり" から該当するものだけを選ぶ。新語を発明しない。曖昧なら keywords に入れる。
- 該当しない項目は null または空配列 []。推測で埋めない。
- 都道府県/市区町村は要望に明示された地名のみ。`;

function jsonResponse(obj, status, env) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (env && env.ALLOW_ORIGIN) {
    headers["Access-Control-Allow-Origin"] = env.ALLOW_ORIGIN;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
  }
  return new Response(JSON.stringify(obj), { status: status || 200, headers });
}

// 応答テキストから最初のJSONオブジェクトを括弧カウントで抽出。
function extractFilterJSON(raw) {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch (e) { return null; }
}

export async function onRequestOptions({ env }) {
  return jsonResponse({}, 204, env);
}

export async function onRequestPost({ request, env }) {
  if (!env.ANTHROPIC_API_KEY) {
    return jsonResponse({ error: "ANTHROPIC_API_KEY が未設定です" }, 500, env);
  }
  let query = "";
  try {
    const body = await request.json();
    query = (body && typeof body.query === "string") ? body.query.trim() : "";
  } catch (e) {
    return jsonResponse({ error: "リクエストボディが不正です" }, 400, env);
  }
  if (!query) return jsonResponse({ error: "query が空です" }, 400, env);
  if (query.length > 500) query = query.slice(0, 500);

  try {
    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 512,
        system: SYSTEM,
        messages: [{ role: "user", content: `次の要望をフィルタJSONに変換してください。JSONのみ出力:\n\n要望: ${query}` }],
      }),
    });
    if (!apiRes.ok) {
      const detail = await apiRes.text().catch(() => "");
      return jsonResponse({ error: "Anthropic API エラー", status: apiRes.status, detail: detail.slice(0, 200) }, 502, env);
    }
    const data = await apiRes.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    const filter = extractFilterJSON(text);
    if (!filter) return jsonResponse({ error: "応答をJSONとして解釈できませんでした", raw: text.slice(0, 200) }, 502, env);
    return jsonResponse({ filter }, 200, env);
  } catch (e) {
    return jsonResponse({ error: "サーバ内部エラー", detail: String(e && e.message || e) }, 500, env);
  }
}
