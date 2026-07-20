-- Lorcana 繁中查卡 Bot — 資料庫 schema
-- SQLite (Node 內建 node:sqlite)

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------
-- 卡牌原始資料（英文，來源 LorcanaJSON，可隨時重新匯入覆蓋）
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cards (
  id              INTEGER PRIMARY KEY,      -- LorcanaJSON 的 id
  code            TEXT NOT NULL UNIQUE,     -- LorcanaJSON 內部短碼，真正的唯一鍵
  set_code        TEXT NOT NULL,            -- '1'..'13', 'Q1', 'Q2'
  number          INTEGER NOT NULL,         -- 系列內編號
  variant         TEXT,                     -- 少數卡有 'a'/'b' 變體
  promo_grouping  TEXT,                     -- P1/P2/P3/P4/C1/C2/D23/PD1
  full_identifier TEXT NOT NULL,            -- '1/204 • EN • 1'
  -- 使用者輸入用的卡號: '1-001'、promo 為 '1-P1-001'。
  -- 注意: 非唯一。Moana/Vaiana 這類同卡異名會共用卡號，查到多筆時讓使用者選。
  card_no         TEXT NOT NULL,

  full_name       TEXT NOT NULL,            -- 'Ariel - On Human Legs'
  name            TEXT NOT NULL,            -- 'Ariel'
  version         TEXT,                     -- 'On Human Legs'
  simple_name     TEXT NOT NULL,            -- 小寫無標點，英文模糊查詢用

  type            TEXT NOT NULL,            -- Character / Action / Item / Location
  color           TEXT,                     -- Amber / Amethyst / ...
  cost            INTEGER,
  inkwell         INTEGER,                  -- 0/1
  strength        INTEGER,
  willpower       INTEGER,
  lore            INTEGER,
  move_cost       INTEGER,                  -- Location 專用
  rarity          TEXT,
  subtypes_text   TEXT,                     -- 'Storyborn • Hero • Princess'
  story           TEXT,                     -- 'The Little Mermaid'

  full_text       TEXT,                     -- 英文效果全文
  flavor_text     TEXT,                     -- 英文風味敘述

  image_full      TEXT,                     -- 官方 CDN 卡圖（熱連，不自存）
  image_thumb     TEXT,

  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cards_card_no     ON cards(card_no);
CREATE INDEX IF NOT EXISTS idx_cards_set_number  ON cards(set_code, number);
CREATE INDEX IF NOT EXISTS idx_cards_simple_name ON cards(simple_name);

-- ---------------------------------------------------------------
-- 繁中翻譯（與原始資料分離，重新匯入英文資料不會覆蓋翻譯）
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS card_zh (
  card_id     INTEGER PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  name_zh     TEXT,      -- '愛麗兒'
  version_zh  TEXT,      -- '人類雙腿'
  text_zh     TEXT,      -- 效果翻譯
  flavor_zh   TEXT,      -- 風味敘述翻譯
  -- pending: 未翻譯 / machine: 機翻未校對 / reviewed: 人工已校對
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','machine','reviewed')),
  note        TEXT,      -- 校對備註
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_card_zh_status ON card_zh(status);

-- ---------------------------------------------------------------
-- 術語對照表（Shift/Bodyguard 等關鍵字，確保翻譯一致性）
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS glossary (
  term_en  TEXT PRIMARY KEY,
  term_zh  TEXT NOT NULL,
  category TEXT,          -- keyword / type / color / rarity
  note     TEXT
);

-- ---------------------------------------------------------------
-- 全文檢索索引（中英合併）
-- 注意: trigram 分詞只對「3 字元以上」的查詢有效，
--       2 字查詢（如「米奇」）需在應用層改走 LIKE。
-- ---------------------------------------------------------------
CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
  card_id UNINDEXED,
  body,                       -- 中英文可搜尋內容合併後的字串
  tokenize = 'trigram'
);

-- ---------------------------------------------------------------
-- 使用者（Phase 1 就建好，之後人工客服／媒合會用到）
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  line_user_id  TEXT PRIMARY KEY,
  display_name  TEXT,
  -- bot: 自動回覆 / human: 已轉人工，bot 不回應
  mode          TEXT NOT NULL DEFAULT 'bot'
                CHECK (mode IN ('bot','human')),
  mode_since    TEXT,        -- 轉人工的時間，用來做逾時自動轉回
  is_blocked    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT
);

-- ---------------------------------------------------------------
-- 對話記錄（人工介入時需要看上下文）
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  line_user_id TEXT NOT NULL REFERENCES users(line_user_id) ON DELETE CASCADE,
  direction    TEXT NOT NULL CHECK (direction IN ('in','out')),
  -- out 訊息才需要區分，用來對帳推播額度
  send_type    TEXT CHECK (send_type IN ('reply','push')),
  text         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(line_user_id, created_at DESC);
-- 用來統計每月 push 則數，避免超出方案額度
CREATE INDEX IF NOT EXISTS idx_messages_push ON messages(send_type, created_at);
