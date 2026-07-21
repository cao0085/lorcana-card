// LINE Messaging API（Worker 版）。
// 對照 Node 版 line.mjs：node:crypto → Web Crypto（crypto.subtle），
// 簽章驗證改為 async；reply/push 的 fetch 不變。

const API = 'https://api.line.me/v2/bot';

/**
 * 驗證 webhook 簽章（HMAC-SHA256 → base64，比對 X-Line-Signature）。
 * 必須用未經解析的 raw body 計算。
 * @param {ArrayBuffer} rawBody
 */
export async function verifySignature(rawBody, signature, secret) {
  if (!secret || !signature) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, rawBody);
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  // 長度不同直接判否；長度相同做常數時間比對
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

async function callApi(path, payload, env) {
  // DRY_RUN：不打真正的 LINE API，只印出要送的內容（本機測試用）
  if (env.DRY_RUN === '1') {
    console.log(`[DRY_RUN] ${path}`, JSON.stringify(payload.messages));
    return;
  }
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`LINE API ${path} ${res.status}: ${detail}`);
  }
}

/** 回覆訊息（reply token 一次性、約 1 分鐘失效，但不計推播額度） */
export function reply(replyToken, messages, env) {
  const list = Array.isArray(messages) ? messages : [messages];
  return callApi('/message/reply', { replyToken, messages: list }, env);
}

/** 主動推播（計入方案額度，按人頭計費，媒合通知才用） */
export function push(to, messages, env) {
  const list = Array.isArray(messages) ? messages : [messages];
  return callApi('/message/push', { to, messages: list }, env);
}

/** 取得使用者資料，失敗回 null */
export async function getProfile(userId, env) {
  if (env.DRY_RUN === '1') return null;
  const res = await fetch(`${API}/profile/${userId}`, {
    headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
  });
  return res.ok ? res.json() : null;
}
