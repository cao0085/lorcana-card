// 查卡核心邏輯。bot 和 CLI 共用。
// CLI 測試: node search.mjs 米奇
import { db } from './db.mjs';

// 卡號樣式: 1-001 / 1-P1-001 / Q1-007，也接受 1-1 這種沒補零的寫法
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

/** 查卡。回傳 { mode, rows }，mode 是 'card_no' | 'fts' | 'like' */
export function search(query, limit = 12) {
  const q = query.trim();
  if (!q) return { mode: 'empty', rows: [] };

  // 1. 卡號精確查詢
  const cardNo = normalizeCardNo(q);
  if (cardNo) {
    const rows = db.prepare(`${SELECT} WHERE c.card_no = ? LIMIT ?`).all(cardNo, limit);
    if (rows.length) return { mode: 'card_no', rows };
    // 卡號格式對但查無資料，往下走關鍵字查詢
  }

  // 2. 關鍵字。trigram 分詞需要 >= 3 字元，2 字查詢改走 LIKE 掃描
  //    (3226 筆全表掃描在 SQLite 是毫秒等級，不需要額外索引)
  if (q.length >= 3) {
    const rows = db.prepare(`
      ${SELECT}
      JOIN cards_fts f ON f.card_id = c.id
      WHERE cards_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(q, limit);
    if (rows.length) return { mode: 'fts', rows };
  }

  const like = `%${q}%`;
  const rows = db.prepare(`
    ${SELECT}
    WHERE c.full_name LIKE ? OR c.simple_name LIKE ?
       OR COALESCE(z.name_zh,'') LIKE ? OR COALESCE(z.version_zh,'') LIKE ?
    ORDER BY c.set_code, c.number
    LIMIT ?
  `).all(like, like, like, like, limit);
  return { mode: 'like', rows };
}

// --- CLI ---
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const q = process.argv.slice(2).join(' ');
  if (!q) {
    console.log('用法: node search.mjs <卡號或關鍵字>');
  } else {
    const t = performance.now();
    const { mode, rows } = search(q);
    const ms = (performance.now() - t).toFixed(1);
    console.log(`查詢 "${q}" -> 模式=${mode}, ${rows.length} 筆, ${ms}ms\n`);
    for (const r of rows) {
      const zh = r.name_zh ? ` 【${r.name_zh}${r.version_zh ? ' - ' + r.version_zh : ''}】` : '';
      console.log(`  ${r.card_no.padEnd(12)} ${r.full_name}${zh}`);
      console.log(`  ${''.padEnd(12)} ${r.type}/${r.color ?? '-'} 費${r.cost ?? '-'} ${r.rarity}`);
    }
  }
}
