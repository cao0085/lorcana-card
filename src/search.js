// 查卡核心邏輯（D1 版）。
//
// 規則：
//   1. 卡號（1-001 / 1-P1-001 / Q1-007）    → 精確查詢
//   2. 精準卡名：去空格+小寫後 == name       → 去重版本、最新優先、取 6
//   3. 模糊：把輸入拆詞，每詞都要在卡名裡     → 去重版本、最新優先、取 5
//
// 「去重」= 同一 full_name（版本）只留最新印刷一張，避免不同稀有度佔位。
// 「最新優先」= 系列號大者在前（促銷/Q 系列排在正規系列之後）。

const CARD_NO_RE = /^([0-9]{1,2}|Q[12])(?:-(P[1-4]|C[12]|D23|PD1))?-([0-9]{1,3})([a-e])?$/i;

const EXACT_LIMIT = 6;
const FUZZY_LIMIT = 5;

// 取卡欄位 + 翻譯，並算出「系列排序值」與「同版本內的新舊序」
const BASE = `
  SELECT c.id, c.card_no, c.full_name, c.name, c.version, c.type, c.color,
         c.cost, c.strength, c.willpower, c.lore, c.rarity, c.subtypes_text,
         c.story, c.full_text, c.image_full, c.image_thumb,
         z.name_zh, z.version_zh, z.text_zh, z.status AS zh_status,
         CAST(c.set_code AS INTEGER) AS set_rank,
         ROW_NUMBER() OVER (
           PARTITION BY c.full_name
           ORDER BY CAST(c.set_code AS INTEGER) DESC, c.number DESC
         ) AS rn
  FROM cards c LEFT JOIN card_zh z ON z.card_id = c.id
`;

const COLS =
  'id, card_no, full_name, name, version, type, color, cost, strength, willpower, ' +
  'lore, rarity, subtypes_text, story, full_text, image_full, image_thumb, ' +
  'name_zh, version_zh, text_zh, zh_status, set_rank';

const norm = (s) => s.toLowerCase().replace(/\s+/g, '');

/** 把使用者輸入的卡號正規化成資料庫格式，不是卡號則回傳 null */
export function normalizeCardNo(input) {
  const m = CARD_NO_RE.exec(input.trim());
  if (!m) return null;
  const [, set, promo, num, variant] = m;
  const body = String(Number(num)).padStart(3, '0') + (variant?.toLowerCase() ?? '');
  const setCode = set.toUpperCase().startsWith('Q') ? set.toUpperCase() : set.replace(/^0+(?=\d)/, '');
  return promo ? `${setCode}-${promo.toUpperCase()}-${body}` : `${setCode}-${body}`;
}

/**
 * 查卡。回傳 { mode, rows, total }。
 *   mode : 'card_no' | 'exact' | 'fuzzy' | 'empty'
 *   total: 去重後的版本總數（可能大於 rows.length，用來提示「共 N 個版本」）
 * @param {D1Database} DB
 */
export async function search(DB, query) {
  const q = query.trim();
  if (!q) return { mode: 'empty', rows: [], total: 0 };

  // 1. 卡號精確查詢（卡號不去重、不排序，直接列出）
  const cardNo = normalizeCardNo(q);
  if (cardNo) {
    const { results } = await DB.prepare(`
      SELECT ${COLS} FROM (${BASE} WHERE c.card_no = ?)
    `).bind(cardNo).all();
    if (results.length) return { mode: 'card_no', rows: results, total: results.length };
    // 卡號格式對但查無 → 往下當關鍵字處理
  }

  // 2. 精準卡名：normalize(輸入) == normalize(name)，去重取最新 6
  const exact = await DB.prepare(`
    SELECT ${COLS}, COUNT(*) OVER () AS total FROM (${BASE}
      WHERE replace(lower(c.name), ' ', '') = ?
    ) WHERE rn = 1
    ORDER BY set_rank DESC, card_no DESC
    LIMIT ${EXACT_LIMIT}
  `).bind(norm(q)).all();
  if (exact.results.length) {
    return { mode: 'exact', rows: exact.results, total: exact.results[0].total };
  }

  // 3. 模糊：拆詞，每個詞都要出現在 simple_name（AND），去重取最新 5
  const words = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5);
  const conds = words.map(() => 'c.simple_name LIKE ?').join(' AND ');
  const binds = words.map((w) => `%${w}%`);
  const fuzzy = await DB.prepare(`
    SELECT ${COLS}, COUNT(*) OVER () AS total FROM (${BASE}
      WHERE ${conds}
    ) WHERE rn = 1
    ORDER BY set_rank DESC, card_no DESC
    LIMIT ${FUZZY_LIMIT}
  `).bind(...binds).all();

  if (fuzzy.results.length) {
    return { mode: 'fuzzy', rows: fuzzy.results, total: fuzzy.results[0].total };
  }
  return { mode: 'empty', rows: [], total: 0 };
}
