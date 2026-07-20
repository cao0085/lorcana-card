// 把查詢結果轉成 LINE 訊息。
//
// 【設計重點】所有文字都經過 zhOr() 取值：有翻譯就用翻譯，沒有就退回英文。
// 因此之後把 card_zh 填滿後，顯示會自動變中文，這個檔案不需要改。

/** 有中文就用中文，否則退回英文。空字串視同沒有。 */
const zhOr = (zh, en) => (zh && zh.trim() ? zh : en) ?? '';

// 顏色／類型／稀有度是固定的列舉值，直接對照表處理。
// （卡片內文的術語翻譯走 glossary 表，那是另一回事）
const COLOR_ZH = {
  Amber: '琥珀', Amethyst: '紫水晶', Emerald: '翡翠',
  Ruby: '紅寶石', Sapphire: '藍寶石', Steel: '鋼鐵',
};
const TYPE_ZH = {
  Character: '角色', Action: '行動', Item: '物品', Location: '地點',
};
const RARITY_ZH = {
  Common: '普通', Uncommon: '非普通', Rare: '稀有', 'Super Rare': '超稀有',
  Legendary: '傳說', Enchanted: '魔法', Epic: '史詩', Special: '特殊',
};

// 'Emerald-Ruby' 這種雙色要拆開個別轉換
const colorZh = (c) =>
  c ? c.split('-').map((x) => COLOR_ZH[x] ?? x).join('/') : '';

/** 卡片顯示名稱，如「愛麗兒 - 人類雙腿」或 "Ariel - On Human Legs" */
export function displayName(r) {
  const name = zhOr(r.name_zh, r.name);
  const version = zhOr(r.version_zh, r.version);
  return version ? `${name} - ${version}` : name;
}

/** 純文字版本，給不支援 Flex 的情境或除錯用 */
export function toText(r) {
  const lines = [`${displayName(r)}　[${r.card_no}]`];

  const meta = [
    TYPE_ZH[r.type] ?? r.type,
    colorZh(r.color),
    RARITY_ZH[r.rarity] ?? r.rarity,
  ].filter(Boolean);
  lines.push(meta.join('・'));

  const stats = [];
  if (r.cost != null) stats.push(`費用 ${r.cost}`);
  if (r.strength != null) stats.push(`攻擊 ${r.strength}`);
  if (r.willpower != null) stats.push(`意志 ${r.willpower}`);
  if (r.lore != null) stats.push(`傳說 ${r.lore}`);
  if (stats.length) lines.push(stats.join('　'));

  if (r.subtypes_text) lines.push(r.subtypes_text);

  const text = zhOr(r.text_zh, r.full_text);
  if (text) lines.push('', text);

  // 還沒人工校對過就標註，避免使用者誤信機翻
  if (r.zh_status === 'machine') lines.push('', '※ 機器翻譯，尚未校對');
  else if (r.zh_status === 'pending' && r.full_text) lines.push('', '※ 此卡尚未翻譯');

  return lines.join('\n');
}

const kv = (label, value) => ({
  type: 'box', layout: 'baseline', spacing: 'sm',
  contents: [
    { type: 'text', text: label, color: '#8c8c8c', size: 'sm', flex: 2 },
    { type: 'text', text: String(value), wrap: true, size: 'sm', flex: 5 },
  ],
});

/** 單張卡的 Flex bubble */
export function toBubble(r) {
  const body = [
    { type: 'text', text: displayName(r), weight: 'bold', size: 'lg', wrap: true },
    { type: 'text', text: r.card_no, size: 'xs', color: '#8c8c8c', margin: 'sm' },
  ];

  const meta = [
    TYPE_ZH[r.type] ?? r.type,
    colorZh(r.color),
    RARITY_ZH[r.rarity] ?? r.rarity,
  ].filter(Boolean).join('・');

  const details = [kv('屬性', meta)];
  if (r.cost != null) details.push(kv('費用', r.cost));
  if (r.strength != null || r.willpower != null) {
    details.push(kv('攻擊/意志', `${r.strength ?? '-'} / ${r.willpower ?? '-'}`));
  }
  if (r.lore != null) details.push(kv('傳說值', r.lore));
  if (r.subtypes_text) details.push(kv('分類', r.subtypes_text));

  body.push({
    type: 'box', layout: 'vertical', spacing: 'sm', margin: 'lg',
    contents: details,
  });

  const text = zhOr(r.text_zh, r.full_text);
  if (text) {
    body.push({
      type: 'box', layout: 'vertical', margin: 'lg',
      contents: [{ type: 'text', text, wrap: true, size: 'sm' }],
    });
  }

  if (r.zh_status === 'machine') {
    body.push({
      type: 'text', text: '※ 機器翻譯，尚未校對',
      size: 'xxs', color: '#b0b0b0', margin: 'md', wrap: true,
    });
  }

  const bubble = {
    type: 'bubble',
    body: { type: 'box', layout: 'vertical', contents: body },
  };

  // 卡圖一律熱連官方 CDN，不自行儲存（見 README 授權注意）
  if (r.image_full) {
    bubble.hero = {
      type: 'image', url: r.image_full,
      size: 'full', aspectRatio: '5:7', aspectMode: 'fit',
      backgroundColor: '#f5f5f5',
    };
  }
  return bubble;
}

// LINE 限制：carousel 最多 12 個 bubble、altText 最多 400 字
const MAX_BUBBLES = 12;

/** 把查詢結果轉成一則 LINE 訊息物件 */
export function toMessage(rows) {
  if (!rows.length) {
    return {
      type: 'text',
      text: '找不到這張卡片。\n\n可以試試：\n・卡號，例如 1-001\n・卡名關鍵字，例如 Elsa',
    };
  }

  if (rows.length === 1) {
    return {
      type: 'flex',
      altText: displayName(rows[0]).slice(0, 400),
      contents: toBubble(rows[0]),
    };
  }

  const shown = rows.slice(0, MAX_BUBBLES);
  return {
    type: 'flex',
    altText: `找到 ${rows.length} 張卡片`.slice(0, 400),
    contents: { type: 'carousel', contents: shown.map(toBubble) },
  };
}
