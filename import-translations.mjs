// 讀 translations/*.jsonl，產出 data/translations.sql（UPDATE card_zh）。
// 只處理 zh 非空的列。card_id 透過 code 對應（來源 allCards.en.json）。
//
// 這是「翻譯檔(版控) -> D1」的橋。D1 就算被 DROP 重建，
// 只要重跑本腳本 + wrangler execute 就能還原全部翻譯。
//
// 用法: node import-translations.mjs
//   之後: wrangler d1 execute lorcana-cardlist --local  --file=./data/translations.sql
//         wrangler d1 execute lorcana-cardlist --remote --file=./data/translations.sql
import { readFile, writeFile, readdir } from 'node:fs/promises';

const root = new URL('./', import.meta.url);
const raw = JSON.parse(await readFile(new URL('./data/allCards.en.json', root), 'utf8'));

// code -> card id
const idByCode = new Map(raw.cards.map((c) => [c.code, c.id]));

const q = (v) => `'${String(v).replace(/'/g, "''")}'`;

const dir = new URL('./translations/', root);
const files = (await readdir(dir)).filter((f) => f.endsWith('.jsonl'));

const stmts = [];
let filled = 0, skipped = 0, missing = 0;

for (const f of files.sort()) {
  const txt = await readFile(new URL(f, dir), 'utf8');
  for (const line of txt.split('\n')) {
    if (!line.trim()) continue;
    const o = JSON.parse(line);
    if (!o.zh || !o.zh.trim()) { skipped++; continue; }
    const id = idByCode.get(o.code);
    if (id === undefined) { console.warn(`找不到 code=${o.code} (${o.card_no})`); missing++; continue; }
    const status = ['machine', 'reviewed'].includes(o.status) ? o.status : 'machine';
    stmts.push(
      `UPDATE card_zh SET text_zh=${q(o.zh)}, status=${q(status)}, ` +
      `updated_at=datetime('now') WHERE card_id=${id};`
    );
    filled++;
  }
}

const header = [
  '-- 由 import-translations.mjs 產生，勿手改。來源 translations/*.jsonl',
  `-- 已填翻譯 ${filled} 筆`,
  '',
];
await writeFile(new URL('./data/translations.sql', root), header.concat(stmts).join('\n') + '\n', 'utf8');

console.log(`翻譯 SQL 已產生：${filled} 筆`);
console.log(`  未填(zh 空) 略過 ${skipped}`);
if (missing) console.log(`  ⚠️ code 對不到 ${missing} 筆`);
console.log('  輸出 -> data/translations.sql');
