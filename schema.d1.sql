-- Lorcana 繁中查卡 Bot — D1 (Cloudflare) schema
--
-- 與 Node 版 schema.sql 的差異：
--   1. 移除 PRAGMA journal_mode/foreign_keys（D1 不適用 session PRAGMA）
--   2. 移除 FTS5 虛擬表，改用 cards.search_blob 欄位 + LIKE 查詢
--      理由：trigram 在 D1 支援與否不確定；且「2 字中文」本來就得靠 LIKE；
--            資料僅 3226 筆，LIKE 全表掃描為毫秒級。一條路涵蓋所有情況。
--
-- 套用：wrangler d1 execute lorcana --local --file=./schema.d1.sql

DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS glossary;
DROP TABLE IF EXISTS card_zh;
DROP TABLE IF EXISTS cards;

-- ---------------------------------------------------------------
-- 卡牌原始資料（英文，來源 LorcanaJSON）
-- ---------------------------------------------------------------
CREATE TABLE cards (
  id              INTEGER PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,     -- LorcanaJSON 短碼，真正唯一鍵
  set_code        TEXT NOT NULL,
  number          INTEGER NOT NULL,
  variant         TEXT,
  promo_grouping  TEXT,
  full_identifier TEXT NOT NULL,
  card_no         TEXT NOT NULL,            -- 使用者輸入用；非唯一（Moana/Vaiana）

  full_name       TEXT NOT NULL,
  name            TEXT NOT NULL,
  version         TEXT,
  simple_name     TEXT NOT NULL,

  type            TEXT NOT NULL,
  color           TEXT,
  cost            INTEGER,
  inkwell         INTEGER,
  strength        INTEGER,
  willpower       INTEGER,
  lore            INTEGER,
  move_cost       INTEGER,
  rarity          TEXT,
  subtypes_text   TEXT,
  story           TEXT,

  full_text       TEXT,
  flavor_text     TEXT,

  image_full      TEXT,
  image_thumb     TEXT,

  -- 查詢用：卡號 + 中英卡名 + 分類 + 故事 + 效果全文，全部小寫合併。
  -- 查詢時對此欄位做 LIKE '%關鍵字%'。翻譯更新後要一併更新此欄。
  search_blob     TEXT NOT NULL DEFAULT '',

  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_cards_card_no    ON cards(card_no);
CREATE INDEX idx_cards_set_number ON cards(set_code, number);

-- ---------------------------------------------------------------
-- 繁中翻譯（與 cards 分離，重新匯入英文資料不影響翻譯）
-- ---------------------------------------------------------------
CREATE TABLE card_zh (
  card_id     INTEGER PRIMARY KEY REFERENCES cards(id),
  name_zh     TEXT,
  version_zh  TEXT,
  text_zh     TEXT,
  flavor_zh   TEXT,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','machine','reviewed')),
  note        TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_card_zh_status ON card_zh(status);

-- ---------------------------------------------------------------
-- 術語對照表
-- ---------------------------------------------------------------
CREATE TABLE glossary (
  term_en  TEXT PRIMARY KEY,
  term_zh  TEXT NOT NULL,
  category TEXT,
  note     TEXT
);

-- ---------------------------------------------------------------
-- 使用者（bot / 人工模式切換）
-- ---------------------------------------------------------------
CREATE TABLE users (
  line_user_id  TEXT PRIMARY KEY,
  display_name  TEXT,
  mode          TEXT NOT NULL DEFAULT 'bot'
                CHECK (mode IN ('bot','human')),
  mode_since    TEXT,
  is_blocked    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT
);

-- ---------------------------------------------------------------
-- 對話記錄（人工介入看上下文 / 推播額度對帳）
-- ---------------------------------------------------------------
CREATE TABLE messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  line_user_id TEXT NOT NULL,
  direction    TEXT NOT NULL CHECK (direction IN ('in','out')),
  send_type    TEXT CHECK (send_type IN ('reply','push')),
  text         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_messages_user ON messages(line_user_id, created_at);
CREATE INDEX idx_messages_push ON messages(send_type, created_at);
