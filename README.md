# Lorcana 繁中查卡 LINE Bot

Disney Lorcana TCG 的繁體中文查卡服務，以 LINE Bot 為介面。
使用者輸入卡號或關鍵字，回傳卡片資訊（Flex 卡片）。
長期目標包含卡片媒合（配對交換）。

執行於 **Cloudflare Worker + D1**，serverless、免維護伺服器。

- 線上網址：`https://lorcana-bot.codeing0085.workers.dev`
- 健康檢查：`https://lorcana-bot.codeing0085.workers.dev/healthz`

> 日常更新、翻譯、部署、疑難排解 → 見 **[MAINTENANCE.md](./MAINTENANCE.md)**

---

## 架構

```
LINE 使用者
   │ 傳訊息
   ▼
LINE Platform ──webhook(POST /callback)──▶ Cloudflare Worker ──▶ D1 (SQLite)
   ▲                                          │ 查卡 / 記錄
   └──────────── reply (Flex 卡片) ◀──────────┘
```

- **Worker**：webhook 進入點、簽章驗證、查卡、組 Flex、reply。無伺服器可維護。
- **D1**：卡牌資料 + 繁中翻譯 + 使用者狀態 + 對話記錄。
- **卡圖**：熱連官方 CDN（`api.lorcana.ravensburger.com`），不自存。

### 資料來源

[LorcanaJSON](https://lorcanajson.org/) — 開源結構化卡牌資料（僅英/法/德/義，**無中文**）。
繁中翻譯為本專案自建，這也是專案的切入點（市面無繁中查卡服務）。

目前上游共 **3,556 筆卡牌資料**，17 系列（`1`–`14` + `Q1`/`Q2`/`Q3`）。

---

## 檔案結構

```
wrangler.jsonc          Worker 設定（D1 綁定）
package.json            指令集（見下）
src/
  index.js              Worker 進入點：/callback、/healthz、事件處理、轉人工
  search.js             查卡（卡號精確 + search_blob LIKE）
  line.js               LINE API：簽章(Web Crypto)、reply/push
format.mjs              查詢結果 → LINE 訊息（Flex/文字），中英 fallback 在這

schema.d1.sql           D1 結構
fetch-cards.mjs         下載英文源資料 → data/allCards.en.json
gen-seed.mjs            allCards.en.json → data/seed.d1.sql（灌卡牌用）
gen-sync.mjs            allCards.en.json → 非破壞式 cards upsert SQL（日常更新用）

translations/           ★ 翻譯真相來源（進版控）
  glossary.md           術語對照表（翻譯依據）
  set-<N>.jsonl         各系列待翻/已翻的效果文字
export-translations.mjs 產出/更新 translations/set-*.jsonl
import-translations.mjs translations/*.jsonl → data/translations.sql
glossary.seed.sql       術語表載入 D1

test-webhook.mjs        本機模擬 LINE 請求（對 wrangler dev）
```

不進版控（gitignore）：`data/*.json`、`data/*.sql`、`.dev.vars`、`.wrangler/`、
`node_modules/`、`line-key-note.md` 等。

---

## 資料庫重點

### 卡號 `card_no`

| 樣式 | 範例 |
|---|---|
| `{系列}-{編號}` | `1-001`、`Q1-007` |
| `{系列}-{促銷碼}-{編號}` | `1-P1-001`、`3-D23-003` |

促銷卡沿用系列碼但另編號，需加促銷碼（P1/P2/P3/P4/C1/C2/D23/PD1）才唯一。
**`card_no` 非唯一**：`7-P2-026` 為 Moana/Vaiana 同卡異名，查到多筆時讓使用者選。
真正唯一鍵是 `cards.code`（LorcanaJSON 內部短碼，內部用）。

### 主要表

| 表 | 用途 |
|---|---|
| `cards` | 英文原始資料 + `search_blob`（查詢用合併欄） |
| `card_zh` | 繁中翻譯，**與 cards 分離**，重灌卡牌不影響 |
| `glossary` | 術語對照 |
| `users` | 使用者，`mode` 控制 bot／人工 |
| `messages` | 對話記錄（人工介入看上下文 / 推播額度對帳） |

`card_zh.status`：`pending`（未翻）→ `machine`（機翻）→ `reviewed`（已校對）。

### 查詢

`search.js` 依序：**卡號精確** → **`search_blob` LIKE**。
不用 FTS——trigram 查不到 2 字中文（如「米奇」），LIKE 全表掃描 3226 筆為毫秒級，一條路涵蓋所有情況。

---

## Bot 行為

| 輸入 | 回應 |
|---|---|
| 卡號（`1-001`） | Flex 單卡 |
| 關鍵字（`Elsa`） | Carousel（最多 12 張） |
| `說明` / `help` / `?` | 使用說明 |
| `真人` / `人工` / `客服` | 轉人工，bot 停止回應（逾時 30 分自動恢復） |

### 翻譯如何生效

`format.mjs` 全部走 `zhOr(中文, 英文)`：有翻譯用翻譯，沒有退回英文。
**填 `card_zh` 後顯示自動變中文，不需改 code、不需重新部署**（Worker 即時讀 D1）。
`status=machine` 會標「※ 機器翻譯，尚未校對」；`pending` 但無效果的卡不顯示提示。

---

## 成本

- **查卡（reply）免費**——reply message 不計入 LINE 方案額度。
- 主機 = Cloudflare 免費額度。純查卡型 bot 用 LINE 輕用量（免費）即可。
- **媒合會吃 push 額度**（非同步通知只能 push，按人頭計費）——見 Roadmap。

---

## Roadmap

- **Phase 1（機翻完成，待校對）翻譯**：`1`–`14` + `Q1`/`Q2` 共 3,138 張
  有效果的卡已機翻（`status=machine`）。下一步為人工校對；流程見 MAINTENANCE.md。
- **Phase 2（完成）Bot**：查卡、Flex、轉人工、上線。
- **Phase 3（未開始）媒合**：`inventory`／`matches` 表、每日彙整推播（省 push 額度）、
  Web 管理後台。注意媒合會產生 push 費用。

---

## 授權注意

Lorcana 為迪士尼 IP，卡牌文字與卡圖有版權。非營利查詢工具通常可接受
（Lorcania、inkDecks 皆運作中），媒合商業化需自行評估。卡圖一律熱連官方 CDN。
