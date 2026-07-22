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
  '輸入「留言」可轉為留言模式，將訊息交給專人。',
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

// isMemo=1 標記「留言模式下收到的留言」，供人工事後翻閱處理
function logMessage(env, userId, direction, sendType, text, isMemo = 0) {
  return env.DB.prepare(
    `INSERT INTO messages (line_user_id, direction, send_type, text, is_memo)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(userId, direction, sendType, text, isMemo).run();
}

/** 取得使用者模式，順便處理留言模式逾時自動恢復。mode='human' 即留言模式 */
async function resolveMode(env, userId) {
  const u = await env.DB.prepare(`SELECT mode, mode_since FROM users WHERE line_user_id = ?`)
    .bind(userId).first();
  if (!u || u.mode !== 'human') return u?.mode ?? 'bot';

  const timeout = Number(env.HUMAN_MODE_TIMEOUT_MIN ?? 10);
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

const ENTER_MEMO = /^(留言|真人|人工|客服|轉人工)$/;   // 轉入留言模式
const EXIT_MEMO = /^(查卡|返回)$/;                    // 轉回查卡模式

/**
 * 處理文字訊息。回傳 { reply, isMemo }：
 *   reply  — 要回覆的訊息物件（或陣列），null 表示不回應
 *   isMemo — 這則來訊是否為「留言」（需標記供人工處理）
 */
async function handleText(env, userId, text) {
  const q = text.trim();
  const min = Number(env.HUMAN_MODE_TIMEOUT_MIN ?? 10);

  if (/^(help|說明|幫助|\?|？)$/i.test(q)) {
    return { reply: { type: 'text', text: HELP }, isMemo: false };
  }

  const mode = await resolveMode(env, userId);

  // 已在留言模式
  if (mode === 'human') {
    if (EXIT_MEMO.test(q)) {
      await setMode(env, userId, 'bot');
      return {
        reply: { type: 'text', text: '已恢復自動查詢模式，可直接輸入卡號或卡名查詢。' },
        isMemo: false,
      };
    }
    // 一般訊息即為留言：標記起來、不回應
    return { reply: null, isMemo: true };
  }

  // 轉入留言模式（順便抓取顯示名稱，方便人工辨識）
  if (ENTER_MEMO.test(q)) {
    const profile = await getProfile(userId, env).catch(() => null);
    if (profile?.displayName) await upsertUser(env, userId, profile.displayName);
    await setMode(env, userId, 'human');
    return {
      reply: {
        type: 'text',
        text: `已為您轉為留言模式，您的訊息將由專人查看並回覆。\n\n${min} 分鐘後將自動恢復自動查詢模式，或輸入「查卡」立即恢復。`,
      },
      isMemo: false,
    };
  }

  // 一般查卡
  const { rows, total } = await search(env.DB, q);
  return { reply: toMessage(rows, { query: q, total }), isMemo: false };
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

  const { reply: message, isMemo } = await handleText(env, userId, text);
  // 來訊記錄：留言模式下標記 is_memo=1，供人工事後翻閱
  await logMessage(env, userId, 'in', null, text, isMemo ? 1 : 0);

  if (!message) return;   // 留言模式：bot 不回應

  await reply(event.replyToken, message, env);
  // message 可能是單一物件或陣列（多筆結果會附一則提示文字）
  const last = Array.isArray(message) ? message[message.length - 1] : message;
  await logMessage(env, userId, 'out', 'reply',
    last.type === 'text' ? last.text : last.altText);
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
