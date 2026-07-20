// 從 LorcanaJSON 抓取完整英文卡牌資料，存成本地 JSON。
// 用法: node fetch-cards.mjs
import { writeFile } from 'node:fs/promises';

const SOURCE = 'https://lorcanajson.org/files/current/en/allCards.json';
const OUT = new URL('./data/allCards.en.json', import.meta.url);

console.log(`下載中: ${SOURCE}`);
const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

const json = await res.json();
await writeFile(OUT, JSON.stringify(json, null, 2), 'utf8');

const cards = json.cards ?? [];
console.log(`\n完成，共 ${cards.length} 張卡`);
console.log(`資料格式版本: ${json.metadata?.formatVersion ?? '?'}`);
console.log(`資料產生日期: ${json.metadata?.generatedOn ?? '?'}`);

// 列出所有出現過的欄位與出現次數，用來決定 schema
const fieldCount = new Map();
for (const c of cards) {
  for (const k of Object.keys(c)) fieldCount.set(k, (fieldCount.get(k) ?? 0) + 1);
}
console.log('\n欄位 (出現張數 / 總數):');
for (const [k, n] of [...fieldCount].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(24)} ${n}`);
}

// 各系列的卡片數
const bySet = new Map();
for (const c of cards) {
  const s = c.setCode ?? '?';
  bySet.set(s, (bySet.get(s) ?? 0) + 1);
}
console.log('\n各系列張數:');
for (const [s, n] of [...bySet].sort()) console.log(`  ${s.padEnd(6)} ${n}`);

console.log('\n範例卡片:');
console.log(JSON.stringify(cards[0], null, 2));
