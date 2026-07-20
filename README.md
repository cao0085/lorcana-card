# Lorcana 繁中查卡 LINE Bot

Disney Lorcana TCG 的繁體中文查卡服務，以 LINE Bot 為載體。
長期目標包含卡片媒合（配對交換）功能。

狀態：**Phase 0 — 資料層完成**，尚未接 LINE。

---

## 環境需求

- **Node.js 22+**（用內建的 `node:sqlite`，需 v22.5 以上）
- 無外部相依套件。目前整個資料層是零 `npm install`。

實測環境：Node v22.21.1 / npm 10.9.4 / Windows 11。

> `node:sqlite` 目前是 experimental，執行時會出現 `ExperimentalWarning`，可忽略。
> 內建的 SQLite 已編入 **FTS5** 與 **trigram** 分詞器，兩者都已驗證可用。

---

## 快速開始

```bash
node fetch-cards.mjs      # 下載英文卡牌資料 -> data/allCards.en.json
node import.mjs           # 建表 + 匯入        -> data/lorcana.db
node search.mjs 米奇       # CLI 測試查詢
```

`import.mjs` 可重複執行：英文資料會 upsert 覆蓋，**翻譯不受影響**。

---

## 檔案

| 檔案 | 用途 |
|---|---|
| `fetch-cards.mjs` | 從 LorcanaJSON 下載英文卡牌資料，並印出欄位統計 |
| `schema.sql` | 資料庫結構（卡牌／翻譯／術語／全文索引／使用者／訊息） |
| `import.mjs` | 建立 schema、匯入卡牌、重建 FTS 索引 |
| `search.mjs` | 查卡核心邏輯，bot 與 CLI 共用；export `search()` 與 `normalizeCardNo()` |

---

## 資料來源

[**LorcanaJSON**](https://lorcanajson.org/) — 開源結構化卡牌資料。

- 端點：`https://lorcanajson.org/files/current/en/allCards.json`
- 支援語言：**en / fr / de / it**（英法為完整驗證）
- **沒有任何中文**，繁中翻譯必須自行建立

目前資料：**3,226 張卡**，15 個系列（`1`–`13` 正規系列 + `Q1`/`Q2`），
資料格式版本 2.3.4，來源產生日期 2026-07-17。

其他評估過的來源：Lorcana-api.com、Lorcania、inkDecks——皆為純英文。
中國於 2025-01 推出**簡體中文**官方版（代理商 Saka Saka），
社群有微信小程式「Lorcana妙妙屋」可查卡，但為簡體且在微信生態內。
**繁體中文目前沒有任何現成服務**，這是本專案的切入點。

---

## 資料庫設計

### 卡號 `card_no`

使用者輸入用的卡號，格式：

| 樣式 | 範例 | 說明 |
|---|---|---|
| `{系列}-{編號}` | `1-001`、`Q1-007` | 一般卡 |
| `{系列}-{促銷碼}-{編號}` | `1-P1-001`、`3-D23-003` | 促銷卡 |

促銷碼有 `P1` `P2` `P3` `P4` `C1` `C2` `D23` `PD1`。

**為什麼需要促銷碼**：促銷卡沿用同一個 `setCode` 但編號另外計，
單用 `(setCode, number)` 會產生 **149 組衝突**。加入 `promoGrouping`
後降到 1 組。

**`card_no` 不是唯一鍵**。僅存的衝突是 `7-P2-026`
（Moana / Vaiana — 同一張卡的歐洲版譯名差異，來源資料本身如此）。
查到多筆時應讓使用者選，不要假設唯一。

真正的唯一鍵是 `cards.code`（LorcanaJSON 內部短碼，如 `aD`、`j9`），
但不可讀，僅供內部關聯使用。

`normalizeCardNo()` 會容錯處理使用者輸入：`1-1` → `1-001`。

### 主要資料表

| 表 | 用途 |
|---|---|
| `cards` | 英文原始資料，可重新匯入覆蓋 |
| `card_zh` | 繁中翻譯，**與 `cards` 分離**，重新匯入不會被蓋掉 |
| `glossary` | 術語對照表，確保翻譯一致性（目前為空） |
| `cards_fts` | FTS5 全文索引（中英合併，trigram 分詞） |
| `users` | LINE 使用者，含 `mode` 欄位控制 bot／人工 |
| `messages` | 對話記錄，人工介入看上下文用；`send_type` 供推播額度對帳 |

`card_zh.status`：`pending`（未翻）→ `machine`（機翻未校對）→ `reviewed`（人工已校對）。

---

## 查詢邏輯

`search()` 依序嘗試三種模式：

1. **`card_no`** — 輸入符合卡號格式 → 精確查詢
2. **`fts`** — 查詢長度 ≥ 3 字元 → FTS5 全文檢索
3. **`like`** — 其餘情況 → `LIKE '%q%'` 全表掃描

### 為什麼需要 LIKE 這條路

**SQLite 的 trigram 分詞查不到 2 個字元以下的字串。**
而「米奇」「艾莎」「老鼠」正是使用者最常輸入的形式。

已實測確認：

```
查 "人魚"   (2字) -> 0 筆   ← trigram 失效
查 "美人魚" (3字) -> 1 筆
```

3,226 筆的 `LIKE` 全表掃描實測約 10ms，完全可接受，不需額外索引。

### 已知限制

英文查詢的子字串比對會誤中：查 `ice` 會撞到 `Alice`、`Maleficent`。
中文不受影響。後續可加排序權重讓完全符合者優先。

實測查詢耗時：**2–10ms**。

---

## ⚠️ 翻譯資料的保存

`data/lorcana.db` 已列入 `.gitignore`（8MB，且可重建）。
但**翻譯成果存在這個 DB 裡**——若只依賴這個檔案，等於翻譯沒有版控也沒有備份。

**動手翻譯前必須先做**：把 `card_zh` 匯出成可版控的文字檔
（建議 `translations/*.csv` 或 `*.json`，依系列切檔），
並在 `import.mjs` 之後加一個匯入步驟，讓 DB 可以從該檔完整重建。

流程應為：`翻譯檔（進版控）` → `DB（可拋棄）`，而不是反過來。

---

## 成本

| 項目 | 費用 |
|---|---|
| 查卡（reply 回覆） | **NT$0** — reply message 不計入額度 |
| 主機 | NT$0 起（Render／Cloud Run 免費層足夠） |
| 網域（自架才需要） | 約 NT$300/年 |

LINE 官方帳號方案（台灣）：

| 方案 | 月費 | 含訊息則數 | 可加購 |
|---|---|---|---|
| 輕用量 | NT$0 | 200 | ✗ |
| 中用量 | NT$800 | 3,000 | ✗ |
| 高用量 | NT$1,200 | 6,000 | ✓ NT$0.2/則起 |

**只做查卡 → 免費方案完全夠用**（純 reply，不吃額度）。

**做媒合就會吃額度**：媒合通知是非同步的，reply token 早已失效，
只能用 push message，且按人頭計費。200 則約等於 100 次雙向媒合通知。

省額度做法：**每日彙整一次推播**，把當天所有媒合結果合併成一則訊息。

中用量性價比明顯較差（NT$0.27/則 vs 高用量 NT$0.20/則），
且不可加購——真要做媒合建議直接上高用量。

---

## 架構注意事項

**Webhook 必須全程開啟**，人工介入靠 `users.mode` 在程式內控制。
不要用 LINE 後台的「聊天模式」開關——那是**全域**的，
一切過去所有使用者的 bot 都會停擺。

```
訊息進來 → 查 users.mode
  ├─ 'bot'   → 自動處理（查卡／媒合指令）
  ├─ 'human' → 不回應，轉發到管理端
  └─ 逾時    → 自動轉回 'bot'
```

⚠️ **LINE Notify 已於 2025-03-31 終止服務**，管理端通知不要再用它。
可行替代：Discord／Telegram webhook，或自建 Web 管理後台。

其他部署要求：webhook 端點必須是 **HTTPS 且為受信任 CA 憑證**（自簽不可），
開發階段用 cloudflared tunnel 或 ngrok 即可。

---

## 待辦

### Phase 1 — 翻譯
- [ ] 建立 `glossary` 術語表（關鍵字 Shift／Bodyguard／Challenger／Evasive、
      六色 Amber／Amethyst／Emerald／Ruby／Sapphire／Steel、Lore／Ink／Quest）
- [ ] 翻譯匯出／匯入機制（見上方「翻譯資料的保存」）
- [ ] 以 Claude API 批次機翻 3,226 張，狀態標 `machine`
- [ ] 人工校對，狀態改 `reviewed`

### Phase 2 — Bot
- [ ] LINE Messaging API Channel、取得 Secret／Token
- [ ] Webhook 伺服器 + 簽章驗證
- [ ] Flex Message 卡片版面、多筆結果用 Carousel
- [ ] `users` / `messages` 寫入

### Phase 3 — 媒合
- [ ] `inventory` 表（誰有什麼卡、想要什麼卡）
- [ ] `matches` 表與媒合邏輯
- [ ] 每日彙整推播（省額度）
- [ ] Web 管理後台（待處理清單、對話記錄、媒合審核）

---

## 授權注意

Lorcana 為迪士尼 IP，卡牌文字與卡圖均有版權。
非營利查詢工具通常可接受（Lorcania、inkDecks 皆在運作），
但若後續媒合功能商業化，需自行評估風險。

**卡圖一律熱連官方 CDN（`api.lorcana.ravensburger.com`），不自行儲存。**
