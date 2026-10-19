# 維護與更新指南

日常操作手冊：翻譯、更新卡牌資料、部署、疑難排解。

## 部署事實（重要識別碼）

| 項目 | 值 |
|---|---|
| Worker 名稱 | `lorcana-bot` |
| 線上網址 | `https://lorcana-bot.codeing0085.workers.dev` |
| Webhook 端點 | `https://lorcana-bot.codeing0085.workers.dev/callback` |
| D1 資料庫名 | `lorcana-cardlist` |
| D1 database_id | `befbdbf2-3619-4c55-9c80-0571c53b35ba` |
| Cloudflare 帳號 | codeing0085@gmail.com |

LINE 憑證存為 Worker secret（`LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`），
不在程式碼裡。查看：`npx wrangler secret list`。

---

## 前置：認證

任何 `--remote` / `deploy` 指令需先登入。本機已用 OAuth 登入過；
換環境用 API Token：

```bash
export CLOUDFLARE_API_TOKEN=<token>     # Windows: $env:CLOUDFLARE_API_TOKEN="..."
npx wrangler whoami                      # 確認身分
```

換環境也要先 `npm install`（node_modules 不可跨平台共用）。
若 `data/allCards.en.json` 不在（gitignore），先 `node fetch-cards.mjs`。

---

## A. 翻譯（最常做）

翻譯的真相來源是 `translations/set-<N>.jsonl`（進版控）。
流程：**編輯 jsonl → 產 SQL → 灌 D1**。改 D1 不需重新部署，Worker 即時生效。

### 1. 編輯翻譯

打開對應系列檔，例如 `translations/set-12.jsonl`，每列一張卡：

```json
{"code":"HO","card_no":"12-001","name":"...","en":"英文原文","zh":"","status":"pending","note":""}
```

- 把 `zh` 填上繁中效果翻譯
- `status` 改為 `"machine"`（機翻）或 `"reviewed"`（已人工校對）
- **只翻效果**，卡名不翻；用詞依 `translations/glossary.md`
- 沒效果的卡不在檔內，不用管（保持 NULL）

### 2. 產 SQL 並灌 D1

```bash
node import-translations.mjs                                              # → data/translations.sql
npx wrangler d1 execute lorcana-cardlist --remote --file=./data/translations.sql
```

### 3. 驗證

手機查該卡，或：

```bash
npx wrangler d1 execute lorcana-cardlist --remote \
  --command "SELECT card_no, status FROM cards c JOIN card_zh z ON z.card_id=c.id WHERE text_zh IS NOT NULL"
```

### 移除「機器翻譯」提示

`status=machine` 會在卡片顯示「※ 機器翻譯，尚未校對」。
人工確認無誤後把該列 `status` 改成 `"reviewed"`，重跑步驟 2，提示即消失。

### 新增術語

編輯 `translations/glossary.md`（給人看）與 `glossary.seed.sql`（給 D1），然後：

```bash
npx wrangler d1 execute lorcana-cardlist --remote --file=./glossary.seed.sql
```

---

## B. 更新卡牌資料（出新系列時）

LorcanaJSON 更新後，同步英文資料到 D1。**翻譯不受影響**（存在 card_zh，另一條流程）。

```bash
node fetch-cards.mjs          # 抓最新英文 → data/allCards.en.json
node export-translations.mjs  # 補進新卡到 translations/set-*.jsonl（保留既有翻譯）
node gen-sync.mjs             # 產生非破壞式 cards upsert SQL
npx wrangler d1 execute lorcana-cardlist --remote --file=./data/sync-cards.d1.sql
```

上述同步只更新英文卡牌並替新卡建立 `pending` 翻譯列，不會改動既有翻譯、
users 或 messages。`gen-seed.mjs` + `schema.d1.sql` 僅供全新資料庫初始化；
`schema.d1.sql` 會 DROP TABLE，不可用於日常更新。

全新資料庫的初始化流程：

```bash
node gen-seed.mjs
npx wrangler d1 execute lorcana-cardlist --remote --file=./schema.d1.sql       # 重建結構（會清空）
npx wrangler d1 execute lorcana-cardlist --remote --file=./data/seed.d1.sql    # 灌卡牌
npx wrangler d1 execute lorcana-cardlist --remote --file=./glossary.seed.sql   # 術語
node import-translations.mjs
npx wrangler d1 execute lorcana-cardlist --remote --file=./data/translations.sql  # 還原翻譯
```

---

## C. 改程式後部署

改 `src/`、`format.mjs` 後：

```bash
npm run deploy
```

改資料（D1）**不需要**部署，只有改 Worker 程式才要。

本機測試（不動線上）：

```bash
npm run dev                                    # 起本機 Worker (8787)
# 另一終端，用 .dev.vars 裡的 secret：
LINE_CHANNEL_SECRET=<值> node test-webhook.mjs 1-001
```

> 本機 D1 目前是空的（database_id 改過）。要本機測資料先重建本機庫：
> `npm run db:local`（跑 schema + seed 到 --local）再灌 glossary/translations 的 --local 版。

---

## D. 疑難排解

| 症狀 | 檢查 |
|---|---|
| bot 沒回應 | `curl .../healthz` 看 `ok` 與 `lineConfigured` |
| 看即時 log | `npx wrangler tail lorcana-bot` 然後手機傳訊息 |
| LINE Verify 失敗 | secret 是否正確：`wrangler secret list`；webhook URL 結尾要 `/callback` |
| 收到兩則回應 | LINE Official Account Manager 的「自動回應/歡迎訊息」沒關 |
| 某卡查不到 | `wrangler d1 execute ... --command "SELECT * FROM cards WHERE card_no='X'"` |
| 改了翻譯沒變 | 有沒有跑 `import-translations.mjs` + `execute --file`；D1 是改 remote 不是 local |

### 留言模式（人工處理）

使用者輸入「留言／真人／人工／客服／轉人工」會進入**留言模式**：bot 停止自動回覆，
其訊息標記為留言（`messages.is_memo = 1`）供人工事後翻閱。10 分鐘無動作自動恢復，
或使用者輸入「查卡」立即恢復。

查看待處理留言（含顯示名稱 + 時間）：

```bash
npx wrangler d1 execute lorcana-cardlist --remote \
  --command "SELECT u.display_name, m.created_at, m.text FROM messages m JOIN users u ON u.line_user_id = m.line_user_id WHERE m.is_memo = 1 ORDER BY m.created_at DESC LIMIT 20"
```

> 目前僅記錄留言，**沒有回覆介面**（量小先人工，之後可接定時排程或管理後台）。
> 逾時分鐘數由 secret `HUMAN_MODE_TIMEOUT_MIN` 控制（未設時預設 10）。

### 常用查詢

```bash
# 翻譯進度
npx wrangler d1 execute lorcana-cardlist --remote \
  --command "SELECT status, COUNT(*) n FROM card_zh GROUP BY status"

# 本月 push 則數（LINE 額度對帳）
npx wrangler d1 execute lorcana-cardlist --remote \
  --command "SELECT COUNT(*) FROM messages WHERE send_type='push' AND created_at >= date('now','start of month')"
```

---

## npm 指令速查

| 指令 | 作用 |
|---|---|
| `npm run dev` | 本機 Worker（.dev.vars、本機 D1） |
| `npm run deploy` | 部署到 Cloudflare |
| `npm run seed:gen` | allCards.en.json → data/seed.d1.sql |
| `npm run sync:gen` | allCards.en.json → 非破壞式 cards upsert SQL |
| `npm run db:local` | 本機建庫 + 灌卡牌 |
| `npm run db:remote` | 遠端建庫 + 灌卡牌（⚠️ 會 DROP TABLE） |
| `npm run db:check` | 本機查 1-001 |

（`db:create` 已執行過，不需再跑。）
