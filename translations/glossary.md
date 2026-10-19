# Lorcana 繁中術語對照表

翻譯效果文字時的用詞依據，確保一致性。官方無繁中版，用詞參考 TCG 慣例與對岸簡中官方。
新增術語請同步更新 `glossary.seed.sql` 並重新載入 D1。

## 關鍵字能力（Keywords）

| 英文 | 繁中 | 備註 |
|---|---|---|
| Bodyguard | 護衛 | |
| Adventurous | 冒險 | 不能挑戰，若有能力必須探險 |
| Alert | 警戒 | 可如同具有迴避般挑戰 |
| Challenger +N | 挑戰者 +N | |
| Evasive | 迴避 | 只有具迴避的角色能挑戰它 |
| Reckless | 魯莽 | 不能停留，必須挑戰 |
| Resist +N | 抵抗 +N | 減少受到的傷害 |
| Rush | 突襲 | 可立即挑戰 |
| Shift N | 變身 N | 支付 N 打在同名角色上 |
| Singer N | 歌手 N | 視為費用 N 來詠唱歌曲 |
| Sing Together N | 合唱 N | |
| Support | 支援 | 探險時可將其 ¤ 加給另一角色 |
| Ward | 守護 | 對手不能選擇它 |
| Vanish | 消散 | 被對手選為目標時棄掉 |
| Puppy Shift / Universal Shift | 通用變身 | |

## 遊戲名詞

| 英文 | 繁中 |
|---|---|
| character | 角色 |
| item | 物品 |
| location | 地點 |
| action | 行動 |
| song | 歌曲 |
| deck | 牌庫 |
| hand | 手牌 |
| discard / discard pile | 棄牌 / 棄牌堆 |
| play (a card) | 打出 |
| quest | 探險 |
| challenge | 挑戰 |
| ready | 準備（豎起） |
| exert | 橫置 |
| banish | 消滅 |
| damage | 傷害 |
| cost | 費用 |
| draw a card | 抽一張牌 |
| the top / bottom of your deck | 你牌庫頂 / 牌庫底 |
| reveal | 展示 |
| into your hand | 加入手牌 |
| ink drop | 墨滴 |
| for the rest of this turn | 本回合剩餘時間內 |
| at the start of their next turn | 在他們的下個回合開始時 |
| chosen character | 指定角色 |
| opposing character | 對方角色 |
| another character | 另一個角色 |
| in play | 在場 |
| enters play | 進場 |
| gets +N | 獲得 +N |
| pay N less | 少支付 N |

## 資源與符號（保留符號，不轉文字）

| 符號 | 意義 | 繁中稱呼 |
|---|---|---|
| ◊ | lore | 傳說值（gain N lore → 獲得 N 點傳說值） |
| ¤ | strength | 攻擊力 |
| ⬡ | ink cost | 墨水費用 |
| ⟳ | exert | 橫置 |
| ⛉ | willpower | 意志力 |

> 效果文字中出現符號時**保留原符號**（玩家看得懂），不要換成中文字。
> 例：`this character gets +1 ◊.` → `這個角色獲得 +1 ◊。`

## 顏色（Ink）

| 英文 | 繁中 |
|---|---|
| Amber | 琥珀 |
| Amethyst | 紫水晶 |
| Emerald | 翡翠 |
| Ruby | 紅寶石 |
| Sapphire | 藍寶石 |
| Steel | 鋼鐵 |

## 翻譯原則

1. **角色名、地名、家族名不翻譯**（如 Chip、Madrigal、Elsa），保留英文。
2. **卡片專屬能力名**（全大寫，如 HEROIC INTERVENTION）翻成中文，置於效果最前。
3. **符號保留**（◊ ¤ ⬡ ⟳），不轉成文字。
4. 句尾用全形句號「。」。
5. 只翻「效果」（full_text）；卡名、風味敘述不在此範圍。
