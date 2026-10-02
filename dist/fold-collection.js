// Seeded shape recipes: geometry changes with the seed, not just the palette.
export const STUDY_FAMILIES = [
  '探査ロボット',
  '枝の彫刻',
  '尖塔の街',
  '宇宙ステーション',
  '結晶の群れ',
  '積層トーテム',
  '小さな恐竜',
  '空中庭園',
  '翼の船',
  '山の神殿',
];

export function createStudy(family, seed, { box, pyramid }) {
  let state = ((seed + 1) * 2654435761) >>> 0;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const int = (a, b) => a + Math.floor(random() * (b - a + 1));
  const palette = ['#6e9293', '#ae6350', '#8c7c9f', '#c09a57', '#739579'];
  const main = palette[seed % palette.length],
    stone = '#c9bea5',
    dark = '#626e78';
  const parts = [];
  const add = (name, size, position, color = main, pattern) =>
    parts.push(box(name, size, position, color, pattern));
  const tip = (name, width, height, position, color = main) =>
    parts.push(pyramid(name, width, height, position, color));
  switch (family) {
    case 0: {
      const h = 1.4 + int(0, 4) * 0.15,
        shoulder = 0.75 + int(0, 3) * 0.12;
      add('胴', [1.2, h, 0.8], [0, 1.3 + h / 2, 0], main, 'robot-chest');
      for (const side of [-1, 1]) {
        add('脚', [0.45, 1.3, 0.55], [side * 0.33, 0.65, 0], dark, 'boots');
        add('足', [0.6, 0.3, 0.95], [side * 0.33, 0.15, 0.15], dark);
        add('肩', [shoulder, 0.55, 1], [side * (0.6 + shoulder / 2), 1.3 + h - 0.275, 0]);
        add('腕', [0.4, 1 + int(0, 3) * 0.12, 0.5], [side * (0.6 + shoulder - 0.2), 1.2 + h / 2, 0], stone);
        tip('肩の角', 0.4, 0.4 + random() * 0.4, [side * (0.6 + shoulder / 2), 1.3 + h, 0], dark);
      }
      add('頭', [1, 0.85, 0.9], [0, 1.3 + h + 0.425, 0], stone, 'robot-face');
      add('アンテナ', [0.15, 0.5, 0.15], [0.28, 1.3 + h + 1.1, 0]);
      add('背中', [0.8, 0.85, 0.45], [0, 1.7 + h / 2, -0.6], dark);
      break;
    }
    case 1: {
      const height = 3 + int(0, 4) * 0.3;
      add('幹', [0.45, height, 0.45], [0, height / 2, 0], dark);
      add('根元', [1.1, 0.3, 1.1], [0, 0.15, 0], stone);
      for (let i = 0; i < 5 + (seed % 3); i++) {
        const side = i % 2 ? -1 : 1,
          y = 0.7 + i * 0.43,
          reach = 0.8 + random() * 0.8;
        const axis = i % 3 === 0 ? 2 : 0;
        const size = [0.3, 0.25, 0.3],
          pos = [0, y, 0];
        size[axis] = reach;
        pos[axis] = (side * reach) / 2;
        add('枝', size, pos, dark);
        const leaf = [0.65 + random() * 0.3, 0.5 + random() * 0.5, 0.65];
        pos[axis] = side * reach;
        pos[1] += leaf[1] / 2 - 0.05;
        add('葉', leaf, pos, i % 2 ? main : stone);
      }
      break;
    }
    case 2: {
      add('街の土台', [3.4, 0.35, 1.8], [0, 0.175, 0], dark);
      for (let i = 0; i < 5; i++) {
        const h = 1.2 + random() * 2.4,
          x = (i - 2) * 0.61,
          z = i % 2 ? 0.43 : -0.35;
        add('尖塔', [0.56, h, 0.68], [x, 0.35 + h / 2, z], stone, 'tower');
        tip('屋根', 0.56, 0.45 + random() * 0.8, [x, 0.35 + h, z]);
      }
      break;
    }
    case 3: {
      add('中央機', [1, 1.4, 1], [0, 1.8, 0], stone, 'robot-chest');
      add('支柱', [0.35, 1.1, 0.35], [0, 0.55, 0], dark);
      add('台座', [1.2, 0.25, 1.2], [0, 0.125, 0], dark);
      for (const side of [-1, 1]) {
        const reach = 1.1 + random() * 0.7;
        add('連結アーム', [reach, 0.2, 0.2], [side * (0.5 + reach / 2), 1.8, 0], dark);
        add('発電パネル', [0.5, 1.7 + random() * 1.3, 1.2 + random() * 0.8], [side * (0.4 + reach), 1.8, 0]);
        for (const z of [-1, 1]) add('センサー', [0.35, 0.45, 0.5], [side * 0.3, 2.3, z * 0.65], dark);
      }
      tip('アンテナ', 0.7, 0.7 + random() * 0.7, [0, 2.5, 0]);
      break;
    }
    case 4: {
      add('鉱床', [2.8, 0.45, 1.8], [0, 0.225, 0], dark);
      for (let i = 0; i < 6; i++) {
        const w = 0.5 + random() * 0.18,
          h = 0.65 + random() * 2.3;
        const x = ((i % 3) - 1) * 0.82,
          z = i < 3 ? -0.43 : 0.43;
        add('結晶の柱', [w, h, w], [x, 0.45 + h / 2, z], i % 2 ? main : stone);
        tip('結晶の先', w, 0.5 + random() * 0.8, [x, 0.45 + h, z], i % 2 ? main : stone);
      }
      break;
    }
    case 5: {
      let y = 0;
      for (let i = 0; i < 7 + (seed % 3); i++) {
        const h = 0.32 + random() * 0.35,
          w = i % 2 ? 0.7 + random() * 0.4 : 1.8 + random() * 0.8;
        add('積層', [w, h, i % 2 ? 0.65 : 1.2 + random() * 0.6], [0, y + h / 2, 0], i % 2 ? dark : main);
        y += h;
      }
      tip('頂', 1, 0.9, [0, y, 0], stone);
      break;
    }
    case 6: {
      const length = 1.5 + random() * 0.7;
      add('胴', [length, 1, 0.8], [0, 1.2, 0]);
      add('首', [0.5, 1.2 + random() * 0.5, 0.55], [-length / 2 + 0.15, 2, 0]);
      add('頭', [0.9, 0.65, 0.7], [-length / 2 - 0.12, 2.7, 0], stone, 'cat-face');
      for (const x of [-0.5, 0.5])
        for (const z of [-0.29, 0.29]) {
          add('脚', [0.28, 0.75, 0.25], [x, 0.375, z], dark);
        }
      for (let i = 0; i < 3; i++) {
        add(
          'しっぽ',
          [0.55, 0.45 - i * 0.1, 0.5 - i * 0.1],
          [length / 2 + 0.2 + i * 0.5, 1.12 + i * 0.15, 0],
        );
        tip('背びれ', 0.32, 0.4 + random() * 0.5, [i * 0.4 - 0.45, 1.7, 0], stone);
      }
      break;
    }
    case 7: {
      add('幹', [0.5, 3.2, 0.5], [0, 1.6, 0], dark);
      add('土台', [1.2, 0.3, 1.2], [0, 0.15, 0], stone);
      for (let i = 0; i < 3; i++) {
        const y = 0.7 + i * 0.72,
          width = 1.4 + random() * 1.1,
          side = i % 2 ? -1 : 1;
        add('テラス', [width, 0.2, 1.2], [side * (width / 2 - 0.2), y, 0], stone);
        add('庭の塔', [0.5, 0.4 + random() * 0.6, 0.5], [side * (width - 0.5), y + 0.3, 0]);
        tip('庭木', 0.5, 0.5 + random() * 0.5, [side * (width - 0.5), y + 0.4, 0]);
      }
      break;
    }
    case 8: {
      add('船体', [0.9, 0.7, 2.5], [0, 0.95, 0], stone, 'rocket-window');
      for (const side of [-1, 1]) {
        const reach = 1.3 + random() * 0.6;
        add('翼', [reach, 0.2, 1.2], [side * (0.4 + reach / 2), 0.9, 0.25]);
        add('エンジン', [0.5, 0.55, 1.8], [side * (0.3 + reach), 0.9, 0.35], dark);
        add('尾翼', [0.18, 0.8 + random() * 0.7, 0.55], [side * 0.35, 1.5, -0.95]);
        add('着陸脚', [0.18, 0.6, 0.2], [side * 0.3, 0.3, 0.7], dark);
      }
      add('操縦席', [0.7, 0.5, 0.7], [0, 1.5, 0.6]);
      tip('背のアンテナ', 0.3, 0.65, [0, 1.3, -0.25], stone);
      break;
    }
    case 9: {
      for (let i = 0; i < 4; i++)
        add('段丘', [3.2 - i * 0.55, 0.35, 2.7 - i * 0.5], [0, 0.175 + i * 0.35, 0], i % 2 ? main : stone);
      add('神殿', [1.1, 1 + random() * 0.6, 0.95], [0, 1.9, 0], stone, 'castle-door');
      tip('大屋根', 1.25, 0.9 + random() * 0.6, [0, 2.4, 0]);
      for (const x of [-1.25, 1.25])
        for (const z of [-1, 1]) {
          const h = 0.55 + random() * 0.6;
          add('石柱', [0.3, h, 0.3], [x, 0.35 + h / 2, z], dark);
          tip('柱の冠', 0.3, 0.4, [x, 0.35 + h, z]);
        }
      break;
    }
    default:
      throw new Error('Unknown collection family');
  }
  return parts;
}
