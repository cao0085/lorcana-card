// 讀 translations/*.jsonl，產出 data/translations.sql（UPDATE card_zh）。
// 只處理 zh 非空的列。card_id 在 D1 內透過穩定的 code 對應。
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

const sourceCodes = new Set(raw.cards.map((c) => c.code));

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
    if (!sourceCodes.has(o.code)) { console.warn(`找不到 code=${o.code} (${o.card_no})`); missing++; continue; }
    const status = ['machine', 'reviewed'].includes(o.status) ? o.status : 'machine';
    stmts.push(
      `UPDATE card_zh SET text_zh=${q(o.zh)}, status=${q(status)}, ` +
      `updated_at=datetime('now') WHERE card_id=(SELECT id FROM cards WHERE code=${q(o.code)});`
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
