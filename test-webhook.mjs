// 在本機模擬 LINE 送來的 webhook 請求（含正確簽章），
// 用來在還沒有 LINE 憑證時驗證整條流程。
//
// 用法（兩個終端機）:
//   1) DRY_RUN=1 LINE_CHANNEL_SECRET=testsecret LINE_CHANNEL_ACCESS_TOKEN=x node server.mjs
//   2) LINE_CHANNEL_SECRET=testsecret node test-webhook.mjs 1-001
import crypto from 'node:crypto';

const SECRET = process.env.LINE_CHANNEL_SECRET ?? 'testsecret';
const URL_ = process.env.WEBHOOK_URL ?? 'http://localhost:3000/callback';
const text = process.argv.slice(2).join(' ') || '1-001';

const body = JSON.stringify({
  destination: 'Utest',
  events: [{
    type: 'message',
    replyToken: 'dummy-reply-token',
    source: { type: 'user', userId: 'Utest0000000000000000000000000001' },
    timestamp: Date.now(),
    message: { type: 'text', id: '1', text },
  }],
});

const signature = crypto.createHmac('SHA256', SECRET).update(body).digest('base64');

const res = await fetch(URL_, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-line-signature': signature },
  body,
});

console.log(`送出 "${text}" -> HTTP ${res.status} ${await res.text()}`);
console.log('（回覆內容請看 server 那邊的 [DRY_RUN] 輸出）');
