// LINE Bot webhook 伺服器。
// 啟動: node --env-file=.env server.mjs
import http from 'node:http';
import { db } from './db.mjs';
import { search } from './search.mjs';
import { toMessage } from './format.mjs';
import { verifySignature, reply, getProfile, isConfigured, pushCountThisMonth } from './line.mjs';

const PORT = Number(process.env.PORT ?? 3000);
// 轉人工後多久自動轉回 bot（分鐘）
const HUMAN_MODE_TIMEOUT_MIN = Number(process.env.HUMAN_MODE_TIMEOUT_MIN ?? 30);

// --- 資料存取 ---------------------------------------------------

const upsertUser = db.prepare(`
  INSERT INTO users (line_user_id, display_name, last_seen_at)
  VALUES (?, ?, datetime('now'))
  ON CONFLICT(line_user_id) DO UPDATE SET
    display_name = COALESCE(excluded.display_name, users.display_name),
    last_seen_at = datetime('now')
`);

const getUser = db.prepare(`SELECT * FROM users WHERE line_user_id = ?`);

const setMode = db.prepare(`
  UPDATE users SET mode = ?, mode_since = datetime('now') WHERE line_user_id = ?
`);

const logMessage = db.prepare(`
  INSERT INTO messages (line_user_id, direction, send_type, text)
  VALUES (?, ?, ?, ?)
`);

/**
 * 取得使用者目前模式，順便處理轉人工逾時自動回復。
 * 避免使用者被永久卡在 human 模式而沒人理。
 */
function resolveMode(userId) {
  const u = getUser.get(userId);
  if (!u) return 'bot';
  if (u.mode !== 'human') return u.mode;

  const expired = db.prepare(`
    SELECT datetime(?, '+' || ? || ' minutes') < datetime('now') AS expired
  `).get(u.mode_since, HUMAN_MODE_TIMEOUT_MIN);

  if (expired?.expired) {
    setMode.run('bot', userId);
    return 'bot';
  }
  return 'human';
}

// --- 訊息處理 ---------------------------------------------------

const HELP = [
  'Lorcana 查卡機器人',
  '',
  '直接輸入以下內容即可查詢：',
  '・卡號 — 例如 1-001、1-P1-001',
  '・卡名關鍵字 — 例如 Elsa、Ariel',
  '',
  '輸入「真人」可轉接人工客服。',
].join('\n');

/** 產生要回覆的訊息物件；回傳 null 表示不回應（已轉人工） */
async function handleText(userId, text) {
  const q = text.trim();

  if (/^(help|說明|幫助|\?|？)$/i.test(q)) {
    return { type: 'text', text: HELP };
  }

  // 轉人工。Webhook 保持開啟，用 users.mode 控制 bot 是否回應，
  // 不要動 LINE 後台的聊天模式開關（那是全域的，會讓所有人的 bot 停擺）
  if (/^(真人|人工|客服|轉人工)$/.test(q)) {
    setMode.run('human', userId);
    return {
      type: 'text',
      text: `已為您轉接人工客服，稍後會有專人回覆。\n\n若 ${HUMAN_MODE_TIMEOUT_MIN} 分鐘內無人回應，將自動恢復自動查詢。`,
    };
  }

  if (resolveMode(userId) === 'human') return null;

  const { rows } = search(q);
  return toMessage(rows);
}

/** 處理單一 webhook 事件 */
async function handleEvent(event) {
  const userId = event.source?.userId;
  if (!userId) return;

  if (event.type === 'follow') {
    const profile = await getProfile(userId).catch(() => null);
    upsertUser.run(userId, profile?.displayName ?? null);
    await reply(event.replyToken, { type: 'text', text: HELP });
    logMessage.run(userId, 'out', 'reply', HELP);
    return;
  }

  if (event.type === 'unfollow') {
    db.prepare(`UPDATE users SET is_blocked = 1 WHERE line_user_id = ?`).run(userId);
    return;
  }

  if (event.type !== 'message' || event.message?.type !== 'text') return;

  const text = event.message.text;
  upsertUser.run(userId, null);
  logMessage.run(userId, 'in', null, text);

  const message = await handleText(userId, text);
  if (!message) return;   // 已轉人工，bot 不回應

  await reply(event.replyToken, message);
  logMessage.run(userId, 'out', 'reply', message.type === 'text' ? message.text : message.altText);
}

// --- HTTP ------------------------------------------------------

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    const cards = db.prepare('SELECT COUNT(*) n FROM cards').get().n;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      cards,
      lineConfigured: isConfigured(),
      pushThisMonth: pushCountThisMonth(),
    }));
    return;
  }

  if (req.method !== 'POST' || req.url !== '/callback') {
    res.writeHead(404).end('Not Found');
    return;
  }

  const raw = await readBody(req);

  if (!verifySignature(raw, req.headers['x-line-signature'])) {
    console.warn('簽章驗證失敗，拒絕請求');
    res.writeHead(401).end('Unauthorized');
    return;
  }

  // LINE 要求 webhook 盡快回 200，逾時會判定失敗並重送。
  // 先回應，再非同步處理事件。
  res.writeHead(200).end('OK');

  let body;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    console.error('webhook body 不是合法 JSON');
    return;
  }

  for (const event of body.events ?? []) {
    handleEvent(event).catch((err) => console.error('處理事件失敗:', err));
  }
});

server.listen(PORT, () => {
  console.log(`Lorcana bot 已啟動: http://localhost:${PORT}`);
  console.log(`  webhook 端點   POST /callback`);
  console.log(`  健康檢查       GET  /healthz`);
  if (!isConfigured()) {
    console.warn('\n⚠️  尚未設定 LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN');
    console.warn('    所有 webhook 請求都會因簽章驗證失敗而被拒絕。');
    console.warn('    請複製 .env.example 為 .env 並填入憑證。');
  }
});
