// 建立 schema 並把 LorcanaJSON 英文資料匯入 SQLite。
// 可重複執行：英文資料會覆蓋更新，card_zh 的翻譯不受影響。
// 用法: node import.mjs
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('./', import.meta.url);
const dbPath = fileURLToPath(new URL('./data/lorcana.db', root));
const schema = await readFile(new URL('./schema.sql', root), 'utf8');
const raw = JSON.parse(await readFile(new URL('./data/allCards.en.json', root), 'utf8'));

const db = new DatabaseSync(dbPath);
db.exec(schema);

// 卡號格式: '1-001'、'Q1-007'；promo 卡插入分組碼 -> '1-P1-001'
const cardNo = (c) => {
  const num = String(c.number).padStart(3, '0') + (c.variant ?? '');
  return c.promoGrouping ? `${c.setCode}-${c.promoGrouping}-${num}` : `${c.setCode}-${num}`;
};

const upsert = db.prepare(`
  INSERT INTO cards (
    id, code, set_code, number, variant, promo_grouping, full_identifier, card_no,
    full_name, name, version, simple_name,
    type, color, cost, inkwell, strength, willpower, lore, move_cost,
    rarity, subtypes_text, story, full_text, flavor_text,
    image_full, image_thumb, updated_at
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, datetime('now')
  )
  ON CONFLICT(id) DO UPDATE SET
    code=excluded.code, set_code=excluded.set_code, number=excluded.number,
    variant=excluded.variant, promo_grouping=excluded.promo_grouping,
    full_identifier=excluded.full_identifier, card_no=excluded.card_no,
    full_name=excluded.full_name, name=excluded.name, version=excluded.version,
    simple_name=excluded.simple_name, type=excluded.type, color=excluded.color,
    cost=excluded.cost, inkwell=excluded.inkwell, strength=excluded.strength,
    willpower=excluded.willpower, lore=excluded.lore, move_cost=excluded.move_cost,
    rarity=excluded.rarity, subtypes_text=excluded.subtypes_text, story=excluded.story,
    full_text=excluded.full_text, flavor_text=excluded.flavor_text,
    image_full=excluded.image_full, image_thumb=excluded.image_thumb,
    updated_at=datetime('now')
`);

// 每張卡都預先建立一筆 pending 的翻譯列，方便之後查「還有哪些沒翻」
const ensureZh = db.prepare(
  `INSERT INTO card_zh (card_id) VALUES (?) ON CONFLICT(card_id) DO NOTHING`
);

const cards = raw.cards ?? [];
db.exec('BEGIN');
for (const c of cards) {
  upsert.run(
    c.id,
    c.code,
    c.setCode,
    c.number,
    c.variant ?? null,
    c.promoGrouping ?? null,
    c.fullIdentifier,
    cardNo(c),
    c.fullName,
    c.name,
    c.version ?? null,
    c.simpleName,
    c.type,
    c.color ?? null,
    c.cost ?? null,
    c.inkwell ? 1 : 0,
    c.strength ?? null,
    c.willpower ?? null,
    c.lore ?? null,
    c.moveCost ?? null,
    c.rarity ?? null,
    c.subtypesText ?? null,
    c.story ?? null,
    c.fullText ?? null,
    c.flavorText ?? null,
    c.images?.full ?? null,
    c.images?.thumbnail ?? null
  );
  ensureZh.run(c.id);
}
db.exec('COMMIT');

// 重建全文檢索索引（中英合併，翻譯更新後也該重跑這段）
db.exec('BEGIN');
db.exec('DELETE FROM cards_fts');
db.exec(`
  INSERT INTO cards_fts (card_id, body)
  SELECT c.id,
         c.card_no || ' ' || c.full_name || ' ' || c.simple_name || ' ' ||
         COALESCE(c.subtypes_text,'') || ' ' || COALESCE(c.story,'') || ' ' ||
         COALESCE(c.full_text,'') || ' ' ||
         COALESCE(z.name_zh,'') || ' ' || COALESCE(z.version_zh,'') || ' ' ||
         COALESCE(z.text_zh,'')
  FROM cards c LEFT JOIN card_zh z ON z.card_id = c.id
`);
db.exec('COMMIT');

const one = (sql) => db.prepare(sql).get();
console.log(`匯入完成 -> ${dbPath}`);
console.log(`  卡片總數      ${one('SELECT COUNT(*) n FROM cards').n}`);
console.log(`  FTS 索引筆數  ${one('SELECT COUNT(*) n FROM cards_fts').n}`);
console.log('\n翻譯進度:');
for (const r of db.prepare('SELECT status, COUNT(*) n FROM card_zh GROUP BY status').all()) {
  console.log(`  ${String(r.status).padEnd(10)} ${r.n}`);
}
console.log(`\n唯一卡號數  ${one('SELECT COUNT(DISTINCT card_no) n FROM cards').n}`);
for (const r of db.prepare(
  `SELECT card_no, COUNT(*) n FROM cards GROUP BY card_no HAVING n > 1`
).all()) {
  console.log(`  (重複卡號) ${r.card_no} x${r.n}`);
}

console.log('\n卡號範例:');
for (const r of db.prepare(
  `SELECT card_no, full_name FROM cards
   WHERE card_no IN ('1-001','1-P1-001','2-C1-003','3-D23-003','Q1-001')
   ORDER BY card_no`
).all()) {
  console.log(`  ${r.card_no.padEnd(14)} ${r.full_name}`);
}
db.close();
