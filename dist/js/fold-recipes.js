import { createStudy } from './fold-collection.js';

export const MODEL_PRESETS = [
  { id: 'person', label: 'ブロックの人' },
  { id: 'robot', label: 'ロボット' },
  { id: 'cat', label: 'ねこ' },
  { id: 'house', label: '小さな家' },
  { id: 'rocket', label: 'ロケット' },
  { id: 'castle', label: 'お城' },
  { id: 'cube', label: '立方体' },
  { id: 'tetrahedron', label: '四面体' },
  { id: 'octahedron', label: '八面体' },
  { id: 'dodecahedron', label: '十二面体' },
];

function box(name, size, position, color, pattern) {
  const vertices = [];
  for (const x of [-1, 1])
    for (const y of [-1, 1])
      for (const z of [-1, 1]) vertices.push([(x * size[0]) / 2, (y * size[1]) / 2, (z * size[2]) / 2]);
  return { name, vertices, position: [...position], color, pattern };
}

function prism(name, polygon, depth, position, color, pattern) {
  return {
    name,
    vertices: [-depth / 2, depth / 2].flatMap((z) => polygon.map(([x, y]) => [x, y, z])),
    position,
    color,
    pattern,
  };
}

function pyramid(name, width, height, position, color) {
  return {
    name,
    vertices: [
      [-width / 2, 0, -width / 2],
      [width / 2, 0, -width / 2],
      [width / 2, 0, width / 2],
      [-width / 2, 0, width / 2],
      [0, height, 0],
    ],
    position,
    color,
  };
}

export function recipe(spec) {
  if (spec.kind === 'study') return createStudy(spec.family, spec.seed, { box, pyramid });
  const color = spec.color;
  switch (spec.kind) {
    case 'person':
    case 'robot': {
      const robot = spec.kind === 'robot';
      const main = color || (robot ? '#bd6350' : '#4c819b');
      const skin = robot ? '#b8bfc0' : '#d8ae82';
      const parts = [
        box('頭', [1.12, 1.02, 1.04], [0, 3.52, 0], skin, robot ? 'robot-face' : 'face'),
        box('胴', [1.28, 1.56, 0.7], [0, 2.23, 0], main, robot ? 'robot-chest' : 'shirt'),
        box('左腕', [0.46, 1.5, 0.64], [-0.87, 2.25, 0], main),
        box('右腕', [0.46, 1.5, 0.64], [0.87, 2.25, 0], main),
        box('左脚', [0.58, 1.45, 0.65], [-0.34, 0.725, 0], robot ? '#777e83' : '#505b72', 'boots'),
        box('右脚', [0.58, 1.45, 0.65], [0.34, 0.725, 0], robot ? '#777e83' : '#505b72', 'boots'),
      ];
      if (robot) parts.push(box('アンテナ', [0.16, 0.38, 0.16], [0, 4.22, 0], main));
      return parts;
    }
    case 'cat': {
      const fur = color || '#be8754';
      return [
        box('胴', [1.65, 0.95, 0.86], [0.15, 0.98, 0], fur),
        box('顔', [1, 0.86, 0.94], [-0.65, 1.57, 0.04], fur, 'cat-face'),
        ...[-0.42, 0.68].flatMap((x, a) =>
          [-0.27, 0.27].map((z, b) =>
            box(`足${a * 2 + b + 1}`, [0.28, 0.53, 0.28], [x, 0.265, z], '#d9c8a3'),
          ),
        ),
        box('しっぽ', [0.9, 0.25, 0.25], [1.33, 1.18, -0.15], fur),
        prism(
          '左耳',
          [
            [-0.2, 0],
            [0.2, 0],
            [-0.12, 0.44],
          ],
          0.28,
          [-0.92, 2, 0.03],
          fur,
        ),
        prism(
          '右耳',
          [
            [-0.2, 0],
            [0.2, 0],
            [0.12, 0.44],
          ],
          0.28,
          [-0.38, 2, 0.03],
          fur,
        ),
      ];
    }
    case 'house':
      return [
        box('壁', [2.2, 1.8, 1.8], [0, 0.9, 0], '#dbcba9', 'house'),
        prism(
          '屋根',
          [
            [-1.3, 0],
            [1.3, 0],
            [0, 1.1],
          ],
          2.1,
          [0, 1.8, 0],
          color || '#ac5947',
        ),
        box('煙突', [0.32, 0.85, 0.35], [0.65, 2.52, -0.3], '#9b8875'),
      ];
    case 'rocket':
      return [
        box('機体', [1, 2.1, 1], [0, 1.55, 0], '#dddcd1', 'rocket-window'),
        pyramid('先端', 1.02, 1.0, [0, 2.6, 0], color || '#4c819b'),
        prism(
          '左翼',
          [
            [-0.75, 0],
            [0, 0],
            [0, 1.3],
          ],
          0.3,
          [-0.5, 0.45, 0],
          color || '#4c819b',
        ),
        prism(
          '右翼',
          [
            [0, 0],
            [0.75, 0],
            [0, 1.3],
          ],
          0.3,
          [0.5, 0.45, 0],
          color || '#4c819b',
        ),
        pyramid('噴射口', 0.65, -0.5, [0, 0.5, 0], '#d5a047'),
      ];
    case 'castle':
      return [
        box('城壁', [1.8, 1.35, 1.05], [0, 0.675, 0], '#c1b8a4', 'castle-door'),
        ...[-1.18, 1.18].flatMap((x, i) => [
          box(`塔${i + 1}`, [0.75, 2, 0.9], [x, 1, 0], '#d2c7b0', 'tower'),
          pyramid(`塔の屋根${i + 1}`, 1.0, 0.78, [x, 2, 0], color || '#8a709e'),
        ]),
        ...[-0.65, 0, 0.65].map((x, i) => box(`胸壁${i + 1}`, [0.28, 0.3, 1.05], [x, 1.5, 0], '#c1b8a4')),
      ];
    case 'cube':
      return [box('立方体', [2, 2, 2], [0, 1, 0], color || '#799a95')];
    case 'tetrahedron':
      return [
        {
          name: '四面体',
          vertices: [
            [1, 1, 1],
            [-1, -1, 1],
            [-1, 1, -1],
            [1, -1, -1],
          ],
          position: [0, 1, 0],
          color: color || '#b58566',
        },
      ];
    case 'octahedron':
      return [
        {
          name: '八面体',
          vertices: [
            [1.35, 0, 0],
            [-1.35, 0, 0],
            [0, 1.65, 0],
            [0, -1.65, 0],
            [0, 0, 1.35],
            [0, 0, -1.35],
          ],
          position: [0, 1.65, 0],
          color: color || '#7b99ae',
        },
      ];
    case 'dodecahedron': {
      const p = (1 + Math.sqrt(5)) / 2,
        r = 1 / p,
        vertices = [];
      for (const a of [-1, 1])
        for (const b of [-1, 1]) {
          for (const c of [-1, 1]) vertices.push([a, b, c]);
          vertices.push([0, a * r, b * p], [a * r, b * p, 0], [a * p, 0, b * r]);
        }
      return [{ name: '十二面体', vertices, position: [0, p, 0], color: color || '#7f9b79' }];
    }
    default:
      throw new Error('Unknown paper model');
  }
}
