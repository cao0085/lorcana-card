// 從英文源資料產出每系列的「待翻譯」JSONL 到 translations/set-<code>.jsonl。
// 只納入「有效果(full_text 非空)」的卡；沒效果的卡不需翻譯，不列入。
//
// 這些 JSONL 是翻譯的「真相來源」，要進版控。翻譯填在每列的 "zh" 欄。
// 已存在的檔會「保留既有 zh/status」，只補進新卡、更新英文原文 —— 不會覆蓋你的翻譯。
//
// 用法: node export-translations.mjs           (全系列)
//       node export-translations.mjs 12         (只做第 12 系列)
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';

const root = new URL('./', import.meta.url);
const raw = JSON.parse(await readFile(new URL('./data/allCards.en.json', root), 'utf8'));
const onlySet = process.argv[2] ?? null;

const cardNo = (c) => {
  const num = String(c.number).padStart(3, '0') + (c.variant ?? '');
  return c.promoGrouping ? `${c.setCode}-${c.promoGrouping}-${num}` : `${c.setCode}-${num}`;
};

const dir = new URL('./translations/', root);
await mkdir(dir, { recursive: true });

// 讀既有翻譯：code -> { zh, status, note }
async function loadExisting(setCode) {
  const file = new URL(`./set-${setCode}.jsonl`, dir);
  const map = new Map();
  try {
    const txt = await readFile(file, 'utf8');
    for (const line of txt.split('\n')) {
      if (!line.trim()) continue;
      const o = JSON.parse(line);
      map.set(o.code, { zh: o.zh ?? '', status: o.status ?? 'pending', note: o.note ?? '' });
    }
  } catch { /* 檔案不存在，第一次匯出 */ }
  return map;
}

// 依系列分組（只留有 full_text 的卡）
const bySet = new Map();
for (const c of raw.cards) {
  if (!c.fullText || !c.fullText.trim()) continue;
  if (onlySet && c.setCode !== onlySet) continue;
  if (!bySet.has(c.setCode)) bySet.set(c.setCode, []);
  bySet.get(c.setCode).push(c);
}

let totalRows = 0;
for (const [setCode, cards] of bySet) {
  cards.sort((a, b) => a.number - b.number);
  const existing = await loadExisting(setCode);

  const lines = cards.map((c) => {
    const prev = existing.get(c.code) ?? { zh: '', status: 'pending', note: '' };
    return JSON.stringify({
      code: c.code,
      card_no: cardNo(c),
      name: c.fullName,      // 參考用，不翻譯
      en: c.fullText,        // 英文原文
      zh: prev.zh,           // 翻譯（保留既有）
      status: prev.status,   // pending / machine / reviewed
      note: prev.note,
    });
  });

  await writeFile(new URL(`./set-${setCode}.jsonl`, dir), lines.join('\n') + '\n', 'utf8');
  totalRows += lines.length;
  const done = lines.filter((l) => JSON.parse(l).zh).length;
  console.log(`set-${setCode}.jsonl  ${lines.length} 張需翻  (已填 ${done})`);
}
console.log(`\n共 ${totalRows} 張有效果的卡`);
