// 查卡核心邏輯（D1 版）。
// 對照 Node 版 search.mjs：這裡把 node:sqlite 換成 D1，並移除 FTS 分支，
// 一律用 search_blob 的 LIKE（涵蓋卡號查無後的關鍵字、以及 2 字中文）。

const CARD_NO_RE = /^([0-9]{1,2}|Q[12])(?:-(P[1-4]|C[12]|D23|PD1))?-([0-9]{1,3})([a-e])?$/i;

const SELECT = `
  SELECT c.id, c.card_no, c.full_name, c.name, c.version, c.type, c.color,
         c.cost, c.strength, c.willpower, c.lore, c.rarity, c.subtypes_text,
         c.story, c.full_text, c.image_full, c.image_thumb,
         z.name_zh, z.version_zh, z.text_zh, z.status AS zh_status
  FROM cards c LEFT JOIN card_zh z ON z.card_id = c.id
`;

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
 * 查卡。回傳 { mode, rows }，mode 是 'card_no' | 'like' | 'empty'。
 * @param {D1Database} DB
 */
export async function search(DB, query, limit = 12) {
  const q = query.trim();
  if (!q) return { mode: 'empty', rows: [] };

  // 1. 卡號精確查詢
  const cardNo = normalizeCardNo(q);
  if (cardNo) {
    const { results } = await DB.prepare(`${SELECT} WHERE c.card_no = ? LIMIT ?`)
      .bind(cardNo, limit).all();
    if (results.length) return { mode: 'card_no', rows: results };
    // 卡號格式對但查無 → 往下走關鍵字
  }

  // 2. 關鍵字：對 search_blob 做 LIKE。3226 筆全表掃描為毫秒級。
  const like = `%${q.toLowerCase()}%`;
  const { results } = await DB.prepare(`
    ${SELECT}
    WHERE c.search_blob LIKE ?
       OR COALESCE(z.name_zh,'') LIKE ?
       OR COALESCE(z.version_zh,'') LIKE ?
       OR COALESCE(z.text_zh,'') LIKE ?
    ORDER BY c.set_code, c.number
    LIMIT ?
  `).bind(like, like, like, like, limit).all();

  return { mode: results.length ? 'like' : 'empty', rows: results };
}
