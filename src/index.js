// Lorcana Bot — Cloudflare Worker 進入點（取代 Node 版 server.mjs）。
//
// 路由:
//   GET  /healthz   健康檢查（回卡片數等）
//   POST /callback  LINE webhook
//
// 本機: npm run dev   （需先 npm run db:local 灌好本機 D1）
// 測試 #1~#3 見 PLAN.md
import { toMessage } from '../format.mjs';
import { search } from './search.js';
import { verifySignature, reply, getProfile } from './line.js';

const HELP = [
  'Lorcana 查卡機器人',
  '',
  '直接輸入以下內容即可查詢：',
  '・卡號 — 例如 1-001、1-P1-001',
  '・卡名關鍵字 — 例如 Elsa、Ariel',
  '',
  '輸入「真人」可轉接人工客服。',
].join('\n');

// --- D1 存取 ----------------------------------------------------

async function upsertUser(env, userId, displayName) {
  await env.DB.prepare(`
    INSERT INTO users (line_user_id, display_name, last_seen_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(line_user_id) DO UPDATE SET
      display_name = COALESCE(excluded.display_name, users.display_name),
      last_seen_at = datetime('now')
  `).bind(userId, displayName ?? null).run();
}

function setMode(env, userId, mode) {
  return env.DB.prepare(
    `UPDATE users SET mode = ?, mode_since = datetime('now') WHERE line_user_id = ?`
  ).bind(mode, userId).run();
}

function logMessage(env, userId, direction, sendType, text) {
  return env.DB.prepare(
    `INSERT INTO messages (line_user_id, direction, send_type, text) VALUES (?, ?, ?, ?)`
  ).bind(userId, direction, sendType, text).run();
}

/** 取得使用者模式，順便處理轉人工逾時自動恢復 */
async function resolveMode(env, userId) {
  const u = await env.DB.prepare(`SELECT mode, mode_since FROM users WHERE line_user_id = ?`)
    .bind(userId).first();
  if (!u || u.mode !== 'human') return u?.mode ?? 'bot';

  const timeout = Number(env.HUMAN_MODE_TIMEOUT_MIN ?? 30);
  const row = await env.DB.prepare(
    `SELECT datetime(?, '+' || ? || ' minutes') < datetime('now') AS expired`
  ).bind(u.mode_since, timeout).first();

  if (row?.expired) {
    await setMode(env, userId, 'bot');
    return 'bot';
  }
  return 'human';
}

// --- 訊息處理 ---------------------------------------------------

/** 回傳要回覆的訊息物件；null 表示不回應（已轉人工） */
async function handleText(env, userId, text) {
  const q = text.trim();

  if (/^(help|說明|幫助|\?|？)$/i.test(q)) {
    return { type: 'text', text: HELP };
  }

  if (/^(真人|人工|客服|轉人工)$/.test(q)) {
    await setMode(env, userId, 'human');
    const min = Number(env.HUMAN_MODE_TIMEOUT_MIN ?? 30);
    return {
      type: 'text',
      text: `已為您轉接人工客服，稍後會有專人回覆。\n\n若 ${min} 分鐘內無人回應，將自動恢復自動查詢。`,
    };
  }

  if ((await resolveMode(env, userId)) === 'human') return null;

  const { rows } = await search(env.DB, q);
  return toMessage(rows);
}

async function handleEvent(env, event) {
  const userId = event.source?.userId;
  if (!userId) return;

  if (event.type === 'follow') {
    const profile = await getProfile(userId, env).catch(() => null);
    await upsertUser(env, userId, profile?.displayName ?? null);
    await reply(event.replyToken, { type: 'text', text: HELP }, env);
    await logMessage(env, userId, 'out', 'reply', HELP);
    return;
  }

  if (event.type === 'unfollow') {
    await env.DB.prepare(`UPDATE users SET is_blocked = 1 WHERE line_user_id = ?`)
      .bind(userId).run();
    return;
  }

  if (event.type !== 'message' || event.message?.type !== 'text') return;

  const text = event.message.text;
  await upsertUser(env, userId, null);
  await logMessage(env, userId, 'in', null, text);

  const message = await handleText(env, userId, text);
  if (!message) return;

  await reply(event.replyToken, message, env);
  await logMessage(env, userId, 'out', 'reply',
    message.type === 'text' ? message.text : message.altText);
}

// --- HTTP -------------------------------------------------------

async function healthz(env) {
  let cards = null;
  try {
    cards = (await env.DB.prepare('SELECT COUNT(*) n FROM cards').first())?.n ?? null;
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
  return Response.json({
    ok: true,
    cards,
    lineConfigured: Boolean(env.LINE_CHANNEL_SECRET && env.LINE_CHANNEL_ACCESS_TOKEN),
    dryRun: env.DRY_RUN === '1',
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/healthz') {
      return healthz(env);
    }

    if (request.method !== 'POST' || url.pathname !== '/callback') {
      return new Response('Not Found', { status: 404 });
    }

    const raw = await request.arrayBuffer();
    const signature = request.headers.get('x-line-signature');

    if (!(await verifySignature(raw, signature, env.LINE_CHANNEL_SECRET))) {
      return new Response('Unauthorized', { status: 401 });
    }

    let body;
    try {
      body = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    // 事件處理放到 waitUntil，先回 200 給 LINE（避免逾時重送）
    ctx.waitUntil(
      Promise.all((body.events ?? []).map((ev) =>
        handleEvent(env, ev).catch((err) => console.error('處理事件失敗:', err))
      ))
    );

    return new Response('OK');
  },
};
