// 把 data/allCards.en.json 轉成非破壞式 D1 同步 SQL。
// 只新增／更新 cards，並替新卡建立 pending 的 card_zh；不動既有翻譯、users、messages。
//
// 用法: node gen-sync.mjs
import { readFile, writeFile } from 'node:fs/promises';

const raw = JSON.parse(
  await readFile(new URL('./data/allCards.en.json', import.meta.url), 'utf8')
);
const sourceCards = raw.cards ?? [];
// LorcanaJSON 偶爾包含沒有收藏編號的 Quest token；現有 cards schema 與查卡編號
// 都要求 number，因此不把這類非一般查卡項目同步進資料庫。
const cards = sourceCards.filter((card) => Number.isInteger(card.number));
const skipped = sourceCards.length - cards.length;

const q = (v) => {
  if (v === null || v === undefined || v === '') return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
};
const n = (v) => (v === null || v === undefined ? 'NULL' : Number(v));

const cardNo = (c) => {
  const num = String(c.number).padStart(3, '0') + (c.variant ?? '');
  return c.promoGrouping ? `${c.setCode}-${c.promoGrouping}-${num}` : `${c.setCode}-${num}`;
};

const searchBlob = (c) =>
  [cardNo(c), c.fullName, c.simpleName, c.subtypesText, c.story, c.fullText]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

const columns = [
  'code', 'set_code', 'number', 'variant', 'promo_grouping', 'full_identifier',
  'card_no', 'full_name', 'name', 'version', 'simple_name', 'type', 'color', 'cost',
  'inkwell', 'strength', 'willpower', 'lore', 'move_cost', 'rarity', 'subtypes_text',
  'story', 'full_text', 'flavor_text', 'image_full', 'image_thumb', 'search_blob',
];

const values = (c) => [
  q(c.code), q(c.setCode), n(c.number), q(c.variant), q(c.promoGrouping),
  q(c.fullIdentifier), q(cardNo(c)), q(c.fullName), q(c.name), q(c.version),
  q(c.simpleName), q(c.type), q(c.color), n(c.cost), c.inkwell ? 1 : 0,
  n(c.strength), n(c.willpower), n(c.lore), n(c.moveCost), q(c.rarity),
  q(c.subtypesText), q(c.story), q(c.fullText), q(c.flavorText), q(c.images?.full),
  q(c.images?.thumbnail), q(searchBlob(c)),
];

const updateColumns = columns.filter((column) => column !== 'code');
const BATCH = 50;
const out = [
  '-- 由 gen-sync.mjs 產生，勿手改。來源 data/allCards.en.json',
  `-- 卡片數: ${cards.length}`,
  '',
];

for (let i = 0; i < cards.length; i += BATCH) {
  const chunk = cards.slice(i, i + BATCH);
  out.push(`INSERT INTO cards (${columns.join(', ')}) VALUES`);
  out.push(chunk.map((card) => `(${values(card).join(', ')})`).join(',\n'));
  out.push('ON CONFLICT(code) DO UPDATE SET');
  out.push(
    updateColumns.map((column) => `${column}=excluded.${column}`).join(', ') +
      ", updated_at=datetime('now');"
  );
  out.push('');

  out.push('INSERT OR IGNORE INTO card_zh (card_id)');
  out.push(`SELECT id FROM cards WHERE code IN (${chunk.map((card) => q(card.code)).join(', ')});`);
  out.push('');
}

await writeFile(new URL('./data/sync-cards.d1.sql', import.meta.url), out.join('\n'), 'utf8');
console.log(`已產生非破壞式同步 SQL：${cards.length} 張卡`);
if (skipped) console.log(`  略過 ${skipped} 張無收藏編號的特殊卡`);
console.log(`  cards upsert 批次 ${Math.ceil(cards.length / BATCH)}`);
console.log('  輸出 -> data/sync-cards.d1.sql');
