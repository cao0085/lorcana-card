// 把 data/allCards.en.json 轉成 D1 可匯入的 SQL（多列批次 INSERT）。
// 產出 data/seed.d1.sql，再用 `wrangler d1 execute --file` 匯入。
//
// 用法: node gen-seed.mjs
import { readFile, writeFile } from 'node:fs/promises';

const raw = JSON.parse(
  await readFile(new URL('./data/allCards.en.json', import.meta.url), 'utf8')
);
const cards = raw.cards ?? [];

// SQL 字串字面值跳脫：單引號變兩個單引號，null → NULL
const q = (v) => {
  if (v === null || v === undefined || v === '') return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
};
const n = (v) => (v === null || v === undefined ? 'NULL' : Number(v));

const cardNo = (c) => {
  const num = String(c.number).padStart(3, '0') + (c.variant ?? '');
  return c.promoGrouping ? `${c.setCode}-${c.promoGrouping}-${num}` : `${c.setCode}-${num}`;
};

// 查詢用合併字串：卡號 + 中英卡名(此時僅英文) + 分類 + 故事 + 效果，全小寫
const searchBlob = (c) =>
  [
    cardNo(c), c.fullName, c.simpleName,
    c.subtypesText, c.story, c.fullText,
  ].filter(Boolean).join(' ').toLowerCase();

const COLS =
  'id, code, set_code, number, variant, promo_grouping, full_identifier, card_no, ' +
  'full_name, name, version, simple_name, type, color, cost, inkwell, strength, ' +
  'willpower, lore, move_cost, rarity, subtypes_text, story, full_text, flavor_text, ' +
  'image_full, image_thumb, search_blob';

const rowSql = (c) =>
  '(' + [
    n(c.id), q(c.code), q(c.setCode), n(c.number), q(c.variant), q(c.promoGrouping),
    q(c.fullIdentifier), q(cardNo(c)),
    q(c.fullName), q(c.name), q(c.version), q(c.simpleName), q(c.type), q(c.color),
    n(c.cost), c.inkwell ? 1 : 0, n(c.strength), n(c.willpower), n(c.lore), n(c.moveCost),
    q(c.rarity), q(c.subtypesText), q(c.story), q(c.fullText), q(c.flavorText),
    q(c.images?.full), q(c.images?.thumbnail), q(searchBlob(c)),
  ].join(', ') + ')';

// 每批 50 列，避免單一 statement 過大
const BATCH = 50;
const out = [
  '-- 由 gen-seed.mjs 產生，勿手改。來源 data/allCards.en.json',
  `-- 卡片數: ${cards.length}`,
  '',
];

for (let i = 0; i < cards.length; i += BATCH) {
  const chunk = cards.slice(i, i + BATCH);
  out.push(`INSERT INTO cards (${COLS}) VALUES`);
  out.push(chunk.map(rowSql).join(',\n') + ';');
  out.push('');
}

// 每張卡預建一筆 pending 翻譯列（分批）
for (let i = 0; i < cards.length; i += BATCH) {
  const chunk = cards.slice(i, i + BATCH);
  out.push('INSERT INTO card_zh (card_id) VALUES');
  out.push(chunk.map((c) => `(${n(c.id)})`).join(', ') + ';');
  out.push('');
}

const outPath = new URL('./data/seed.d1.sql', import.meta.url);
await writeFile(outPath, out.join('\n'), 'utf8');

console.log(`已產生 seed：${cards.length} 張卡`);
console.log(`  cards INSERT 批次   ${Math.ceil(cards.length / BATCH)}`);
console.log(`  card_zh INSERT 批次 ${Math.ceil(cards.length / BATCH)}`);
console.log(`  輸出 -> data/seed.d1.sql`);
