// 把 translations-data/set-<N>.zh.mjs（卡號 → 中文效果）回填進 translations/set-<N>.jsonl。
// 用法: node apply-map.mjs 12
import { readFile, writeFile } from 'node:fs/promises';

const set = process.argv[2];
if (!set) { console.error('用法: node apply-map.mjs <系列號>'); process.exit(1); }

const root = new URL('./', import.meta.url);
const { default: map } = await import(new URL(`./translations-data/set-${set}.zh.mjs`, root));
const jsonlPath = new URL(`./translations/set-${set}.jsonl`, root);
const lines = (await readFile(jsonlPath, 'utf8')).split('\n').filter((l) => l.trim());

let filled = 0, missing = 0;
const out = lines.map((line) => {
  const o = JSON.parse(line);
  const zh = map[o.card_no];
  if (zh && zh.trim()) { o.zh = zh; o.status = 'machine'; filled++; }
  else if (!o.zh) missing++;
  return JSON.stringify(o);
});

await writeFile(jsonlPath, out.join('\n') + '\n', 'utf8');
console.log(`set-${set}: 回填 ${filled} 張，對照表未涵蓋 ${missing} 張`);
