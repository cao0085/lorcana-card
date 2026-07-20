// LINE Messaging API 最小封裝：簽章驗證 + reply / push。
import crypto from 'node:crypto';
import { db } from './db.mjs';

const API = 'https://api.line.me/v2/bot';
const SECRET = process.env.LINE_CHANNEL_SECRET ?? '';
const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? '';

/**
 * 驗證 webhook 簽章。
 * 必須用「未經解析的 raw body」計算，JSON.parse 後再 stringify 會因為
 * 空白與鍵順序改變而算出不同的雜湊。
 */
export function verifySignature(rawBody, signature) {
  if (!SECRET || !signature) return false;
  const expected = crypto.createHmac('SHA256', SECRET).update(rawBody).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  // 長度不同時 timingSafeEqual 會直接丟例外，要先擋掉
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// DRY_RUN=1 時不呼叫真正的 LINE API，只印出要送的內容。
// 用於沒有憑證時在本機跑通整條流程。
const DRY_RUN = process.env.DRY_RUN === '1';

async function callApi(path, payload) {
  if (DRY_RUN) {
    console.log(`\n[DRY_RUN] ${path}`);
    console.log(JSON.stringify(payload.messages, null, 2));
    return null;
  }

  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`LINE API ${path} ${res.status}: ${detail}`);
  }
  return res;
}

/**
 * 回覆訊息。reply token 只能用一次且約 1 分鐘失效，但「不計入推播額度」。
 * 能用 reply 就別用 push。
 */
export async function reply(replyToken, messages) {
  const list = Array.isArray(messages) ? messages : [messages];
  await callApi('/message/reply', { replyToken, messages: list });
}

/**
 * 主動推播。**會計入方案額度，且按人頭計費。**
 * 媒合通知這類非同步訊息才用，並盡量彙整後一次送出。
 */
export async function push(to, messages) {
  const list = Array.isArray(messages) ? messages : [messages];
  await callApi('/message/push', { to, messages: list });
}

/** 取得使用者資料。使用者未加好友或已封鎖時會失敗，呼叫端要容錯。 */
export async function getProfile(userId) {
  const res = await fetch(`${API}/profile/${userId}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) return null;
  return res.json();
}

/** 本月已使用的 push 則數，用來盯住方案額度 */
export function pushCountThisMonth() {
  const row = db.prepare(`
    SELECT COUNT(*) n FROM messages
    WHERE send_type = 'push' AND created_at >= date('now','start of month')
  `).get();
  return row.n;
}

export const isConfigured = () => Boolean(SECRET && TOKEN);
