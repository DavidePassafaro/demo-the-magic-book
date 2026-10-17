/**
 * Procedural 16x16 pixel-art sprite & tile atlas generator inspired by
 * Game Boy Color classics (Zelda: Link's Awakening DX, Pokémon Gold/Silver, Super Mario Land).
 */

import type { Facing } from '@features/game/engine/game.service';
import type { Theme, TileKind } from '@features/game/engine/model/level';
import type { TileDeco } from '@features/game/engine/map-generator';

export interface ThemePalette {
  readonly grass: readonly [string, string, string, string];
  readonly path: readonly [string, string, string, string];
  readonly water: readonly [string, string, string, string];
  readonly tree: readonly [string, string, string, string];
  readonly rock: readonly [string, string, string, string];
  readonly houseRoof: readonly [string, string, string];
  readonly houseWall: readonly [string, string, string];
  readonly weather: 'leaves' | 'seagulls' | 'snow' | 'dust';
}

export const THEME_PALETTES: Record<Theme, ThemePalette> = {
  village: {
    grass: ['#489838', '#58b848', '#307020', '#78d860'],
    path: ['#d8b878', '#e8d098', '#a88848', '#785828'],
    water: ['#2868b8', '#4890e0', '#184888', '#88c8f8'],
    tree: ['#183810', '#286020', '#489030', '#70c048'],
    rock: ['#585868', '#888898', '#b8b8c8', '#282838'],
    houseRoof: ['#b83828', '#e05840', '#781810'],
    houseWall: ['#f0e0c0', '#c8b088', '#584028'],
    weather: 'leaves',
  },
  harbour: {
    grass: ['#807868', '#989080', '#585048', '#b0a898'],
    path: ['#a87840', '#c89858', '#704820', '#482810'],
    water: ['#185088', '#2870b0', '#103058', '#78b8e8'],
    tree: ['#281808', '#583818', '#805828', '#a88048'],
    rock: ['#684820', '#987038', '#c09858', '#382008'],
    houseRoof: ['#285888', '#4878a8', '#183858'],
    houseWall: ['#dcd8d0', '#b0a898', '#484038'],
    weather: 'seagulls',
  },
  winter: {
    grass: ['#d8e8f8', '#f0f8ff', '#a8c0d8', '#ffffff'],
    path: ['#98b0c8', '#b8cce0', '#688098', '#486078'],
    water: ['#5890c0', '#80b8e8', '#386890', '#d0f0ff'],
    tree: ['#102820', '#204838', '#386850', '#e8f4fc'],
    rock: ['#606878', '#8898a8', '#d8e8f8', '#303848'],
    houseRoof: ['#586888', '#7890b0', '#384058'],
    houseWall: ['#d8c8b0', '#a89880', '#483828'],
    weather: 'snow',
  },
  indoor: {
    grass: ['#604868', '#785880', '#483050', '#907098'],
    path: ['#a83848', '#c85060', '#782030', '#f0c860'],
    water: ['#305070', '#487898', '#183048', '#88b8d8'],
    tree: ['#181024', '#382c48', '#584868', '#786888'],
    rock: ['#684020', '#986030', '#c08848', '#381808'],
    houseRoof: ['#784890', '#9868b0', '#482860'],
    houseWall: ['#c8b8d0', '#9888a0', '#382840'],
    weather: 'dust',
  },
};

export interface NpcSpritePalette {
  readonly outline: string;
  readonly skin: string;
  readonly hair: string;
  readonly tunic: string;
  readonly tunicShade: string;
  readonly belt: string;
  readonly isDog?: boolean;
  readonly hat?: 'cap' | 'hood' | 'bandana' | 'crown' | 'none';
}

const NPC_PALETTES: readonly NpcSpritePalette[] = [
  { outline: '#181010', skin: '#f8c898', hair: '#c84820', tunic: '#d83828', tunicShade: '#901810', belt: '#f8d040', hat: 'hood' },
  { outline: '#101418', skin: '#f8d0a8', hair: '#583818', tunic: '#2878c8', tunicShade: '#184888', belt: '#d8a840', hat: 'cap' },
  { outline: '#181410', skin: '#e8b888', hair: '#202028', tunic: '#8838a8', tunicShade: '#581870', belt: '#e0c050', hat: 'none' },
  { outline: '#141810', skin: '#f8c898', hair: '#d8a838', tunic: '#309850', tunicShade: '#186030', belt: '#a86828', hat: 'bandana' },
  { outline: '#181014', skin: '#d8a070', hair: '#d8e0e8', tunic: '#c87820', tunicShade: '#884810', belt: '#483828', hat: 'crown' },
  { outline: '#101818', skin: '#f8d0b0', hair: '#882840', tunic: '#289098', tunicShade: '#185860', belt: '#f0c048', hat: 'none' },
];

export function getNpcAppearance(id: string, name: string): NpcSpritePalette {
  const lowerId = id.toLowerCase();
  const lowerName = name.toLowerCase();
  if (lowerId.includes('cosmo') || lowerName.includes('cosmo') || lowerName.includes('mordicchiatore')) {
    return {
      outline: '#08060c',
      skin: '#22202a', // black coat
      hair: '#383446', // dark charcoal fur highlight
      tunic: '#22202a', // badge color
      tunicShade: '#f8f8ff', // white chest patch
      belt: '#e02828', // bright red collar
      isDog: true,
    };
  }
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return NPC_PALETTES[hash % NPC_PALETTES.length];
}

/**
 * Draws a 16x16 pixel grid using single-character palette keys.
 * '.' is always transparent.
 */
export function drawPixelGrid(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  rows: readonly string[],
  palette: Record<string, string>,
  scale = 1,
): void {
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') continue;
      const color = palette[ch];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
    }
  }
}

/** Renders the player (bearded developer in a purple t-shirt with conference badge and Magic Book). */
export function drawPlayerSprite(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  facing: Facing,
  stepFrame: 0 | 1 | 2,
  scale = 2.5,
): void {
  const pal: Record<string, string> = {
    O: '#14101c', // dark outline
    K: '#2c1e16', // dark brown hair
    k: '#4c3626', // hair highlight / eyebrows
    S: '#f0c49c', // skin
    s: '#cf9670', // skin shadow
    E: '#1c1418', // eyes
    Z: '#3a2618', // beard
    z: '#20140c', // moustache shadow
    T: '#9a48e0', // purple t-shirt
    t: '#6428a8', // t-shirt shadow
    N: '#f8f8ff', // conference lanyard
    C: '#f8f8f8', // badge card
    X: '#e82050', // badge band
    B: '#3a2a20', // shoes
    R: '#c83038', // magic book cover
    P: '#f8f0d8', // magic book pages
  };

  const bobY = stepFrame === 1 || stepFrame === 2 ? -scale : 0;

  // Ground shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.fillRect(ox + 3 * scale, oy + 14 * scale, 10 * scale, 2 * scale);

  let grid: readonly string[];

  if (facing === 'down') {
    const feet =
      stepFrame === 1
        ? '..cc..OOOO......'
        : stepFrame === 2
          ? '......OOOO..cc..'
          : '...BBBB..BBBB...';
    grid = [
      '.....OOOOOO.....',
      '....OKkkkKKO....',
      '...OKkKKKKKKO...',
      '..OKKKKKKKKKKO..',
      '..OKKSSSSSSKKO..',
      '..OSSkkSSkkSSO..',
      '..OSSESSSSESSO..',
      '..OZSSSssSSSZO..',
      '..OZZzzzzzzZZO..',
      '...OZZZZZZZZO...',
      '.OTNTOZZZZOTNTO.',
      '.OTtTNOZZONTtRR.',
      '.OStTTNCCNTTtRP.',
      '.OOtTTTXXTTtORR.',
      feet.replace(/c/g, 'B'),
      '...OOOOOOOOOO...',
    ];
  } else if (facing === 'up') {
    const feet =
      stepFrame === 1
        ? '...BBBB...OO....'
        : stepFrame === 2
          ? '....OO...BBBB...'
          : '...BBBB..BBBB...';
    grid = [
      '.....OOOOOO.....',
      '....OKkkkKKO....',
      '...OKkKKKKKKO...',
      '..OKKKKKKKKKKO..',
      '..OKKKKKkKKKKO..',
      '..OKKKKKKKKKKO..',
      '..OKKKKKKKKKKO..',
      '..OSKKKKKKKKSO..',
      '...OKKKKKKKKO...',
      '...OONSSSSNOO...',
      '.OTTTNNNNNNTTTO.',
      '.OTtTTTTTTTTtTO.',
      '.OStTTTTTTTTtSO.',
      '.OOtTTTTTTTTtOO.',
      feet,
      '...OOOOOOOOOO...',
    ];
  } else if (facing === 'left') {
    const feet =
      stepFrame === 1
        ? '..BBBB..BBBB....'
        : stepFrame === 2
          ? '....BBBB..BBBB..'
          : '....BBBBBBBB....';
    grid = [
      '....OOOOOOO.....',
      '...OKkkkKKKO....',
      '..OKkKKKKKKKO...',
      '..OKKKKKKKKKKO..',
      '..OKSSSKKKKKKO..',
      '.OkkSSSSSKKKKO..',
      '.OSESSSSsSKKO...',
      '.OSSSSSSsKKO....',
      '..OzzZZZZZKO....',
      '..OZZZZZZZO.....',
      '...OZZZONTTO....',
      '..ORRONTTTTtO...',
      '..OPRNTTTTTtO...',
      '..ORRCXTTTTtO...',
      feet,
      '...OOOOOOOOOO...',
    ];
  } else {
    // right
    const feet =
      stepFrame === 1
        ? '....BBBB..BBBB..'
        : stepFrame === 2
          ? '..BBBB..BBBB....'
          : '....BBBBBBBB....';
    grid = [
      '.....OOOOOOO....',
      '....OKKKkkkKO...',
      '...OKKKKKKKkKO..',
      '..OKKKKKKKKKKO..',
      '..OKKKKKKSSSKO..',
      '..OKKKKSSSSSkkO.',
      '...OKKSsSSSSESO.',
      '....OKKsSSSSSSO.',
      '....OKZZZZZzzO..',
      '.....OZZZZZZZO..',
      '....OTTNOZZZO...',
      '...OtTTTTNORRO..',
      '...OtTTTTTNRPO..',
      '...OtTTTTXCRRO..',
      feet,
      '...OOOOOOOOOO...',
    ];
  }

  drawPixelGrid(ctx, ox, oy + bobY, grid, pal, scale);
}

/** Renders an NPC villager (or Cosmo the dog) in 16x16 pixel art. */
export function drawNpcSprite(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  appearance: NpcSpritePalette,
  frame: 0 | 1,
  solved: boolean,
  scale = 2.5,
): void {
  const bobY = frame === 1 ? -scale * 0.5 : 0;

  // Ground shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.fillRect(ox + 3 * scale, oy + 14 * scale, 10 * scale, 2 * scale);

  if (appearance.isDog) {
    const pal: Record<string, string> = {
      O: appearance.outline, // black outline
      F: appearance.skin, // black coat (#22202a)
      D: appearance.hair, // dark fur highlight (#383446)
      W: appearance.tunicShade, // pure white chest patch (#f8f8ff)
      C: appearance.belt, // bright red collar (#e02828)
      G: '#ffd040', // collar gold tag
      E: '#ffffff', // bright eye shine against black fur
      P: '#ff8898', // pink tongue when happy
    };
    const tailRow10 = frame === 1 ? '...OFFWWFFFO.OO.' : '...OFFWWFFFO....';
    const tailRow11 = frame === 1 ? '..OFFWWWWFFFODO.' : '..OFFWWWWFFFO.OO';
    const grid = [
      '................',
      '................',
      '..OOO....OOO....',
      '.ODFDO..ODFDO...',
      '.ODFFOOOOFFDO...',
      '..OFFFFFFFFO....',
      '..OFEFFFFEFO....',
      '..OFFFOOOFFO....',
      '...OCCCGCcCO....',
      tailRow10,
      tailRow11,
      '..OFFWWWWFFFFDO.',
      '..OFFFFFFFFFDO..',
      '..OOFFOOOOFFOO..',
      '..OO..OO..OO....',
      '................',
    ];
    drawPixelGrid(ctx, ox, oy + bobY, grid.map((r) => r.replace('c', 'C')), pal, scale);
    return;
  }

  const pal: Record<string, string> = {
    O: appearance.outline,
    S: appearance.skin,
    H: appearance.hair,
    T: appearance.tunic,
    t: appearance.tunicShade,
    B: appearance.belt,
    E: '#141018',
    W: '#ffffff',
  };

  const hatTop =
    appearance.hat === 'crown'
      ? '...O.O.OO.O.O...'
      : appearance.hat === 'hood'
        ? '....OOOOOOOO....'
        : '.....OOOOOO.....';

  const mouthRow = solved ? '...OSSSOOOSSSO..' : '...OSSSSSSSSO...';

  const grid = [
    hatTop,
    '...OHHHHHHHHO...',
    '..OHHHHHHHHHHO..',
    '..OHHSSSSSSHHO..',
    '..OHSSEssESSHO..',
    '..OSSSSSSSSSSO..',
    mouthRow,
    '....OOOOOOOO....',
    '..OOtTTTTTTtOO..',
    '.OTtTTTTTTTTtTO.',
    '.OStTTBBBBTTtSO.',
    '.OOtBBBBBBBBtOO.',
    '..OOtTTTTTTtOO..',
    '...OOOOOOOOOO...',
    '...OO.OOOO.OO...',
    '...OO......OO...',
  ];

  drawPixelGrid(ctx, ox, oy + bobY, grid, pal, scale);
}

/** Draws a classic Game Boy floating speech bubble above an NPC (`!` or `♥` / `☺`). */
export function drawEmoteBubble(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  solved: boolean,
  isFacingNpc: boolean,
  tick: number,
  scale = 2,
): void {
  const floatOffset = Math.round(Math.sin(tick * 0.08) * 2.5);
  const bx = ox + 6;
  const by = oy - 22 + floatOffset;

  const pal: Record<string, string> = {
    O: '#14101c',
    W: isFacingNpc ? '#fff6c0' : '#f8f4e8',
    S: '#c8b8a0',
    I: solved ? '#28a858' : '#e03828',
    H: '#ff7060',
  };

  const grid = solved
    ? [
        '..OOOOOOOOOO..',
        '.OWWWWWWWWWWO.',
        'OWWIIWWWWIIWWO',
        'OWIIIIWWIIIIWO',
        'OWIIIIIIIIIIWO',
        'OWWIIIIIIIIWWO',
        'OWWWIIIIIIWWWO',
        'OWWWWIIIIWWWWO',
        '.OWWWWIIWWWWo.',
        '..OOOOOOOOOO..',
        '.....OWWO.....',
        '......OO......',
      ]
    : [
        '..OOOOOOOOOO..',
        '.OWWWWWWWWWWO.',
        'OWWWWWIIWWWWWO',
        'OWWWWWHIWWWWWO',
        'OWWWWWHIWWWWWO',
        'OWWWWWIIWWWWWO',
        'OWWWWWWWWWWWWO',
        'OWWWWWIIWWWWWO',
        '.OSSSSIISSSSO.',
        '..OOOOOOOOOO..',
        '.....OWWO.....',
        '......OO......',
      ];

  drawPixelGrid(ctx, bx, by, grid, pal, scale);
}

/** Draws a single 16x16 terrain tile with autotiling edges and rich pixel textures. */
export function drawTerrainTile(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  kind: TileKind,
  deco: TileDeco,
  theme: Theme,
  neighbors: { n: TileKind; s: TileKind; e: TileKind; w: TileKind },
  waterFrame: 0 | 1,
  tileSize = 40,
): void {
  const p = THEME_PALETTES[theme];
  const s = tileSize / 16;

  // 1. Base ground fill
  ctx.fillStyle = p.grass[0];
  ctx.fillRect(ox, oy, tileSize, tileSize);

  if (kind === 'grass') {
    // Subtle grass blades & texture
    ctx.fillStyle = p.grass[1];
    ctx.fillRect(ox + 2 * s, oy + 3 * s, 2 * s, s);
    ctx.fillRect(ox + 10 * s, oy + 11 * s, 2 * s, s);
    ctx.fillStyle = p.grass[2];
    ctx.fillRect(ox + 3 * s, oy + 4 * s, 2 * s, s);
    ctx.fillRect(ox + 11 * s, oy + 12 * s, 2 * s, s);
    ctx.fillRect(ox + 13 * s, oy + 4 * s, s, 2 * s);
    ctx.fillRect(ox + 5 * s, oy + 13 * s, s, 2 * s);

    if (deco === 'flower') {
      const flowerPal: Record<string, string> = {
        S: p.grass[2],
        P: theme === 'winter' ? '#88c8ff' : '#ff6888',
        Y: '#ffd848',
        W: '#ffffff',
      };
      const flowerGrid = [
        '................',
        '................',
        '....P.P.........',
        '...PYYYP........',
        '....P.P.........',
        '.....S..........',
        '....SS....W.W...',
        '.........WYYYW..',
        '..........W.W...',
        '...........S....',
        '..........SS....',
        '................',
        '................',
        '................',
        '................',
        '................',
      ];
      drawPixelGrid(ctx, ox, oy, flowerGrid, flowerPal, s);
    } else if (deco === 'tuft') {
      ctx.fillStyle = p.grass[3];
      ctx.fillRect(ox + 6 * s, oy + 6 * s, s, 3 * s);
      ctx.fillRect(ox + 8 * s, oy + 5 * s, s, 4 * s);
      ctx.fillRect(ox + 10 * s, oy + 7 * s, s, 2 * s);
    } else if (deco === 'pebble') {
      ctx.fillStyle = p.rock[1];
      ctx.fillRect(ox + 7 * s, oy + 8 * s, 3 * s, 2 * s);
      ctx.fillStyle = p.rock[2];
      ctx.fillRect(ox + 7 * s, oy + 8 * s, 2 * s, s);
    } else if (deco === 'mushroom') {
      ctx.fillStyle = '#f0e0c0';
      ctx.fillRect(ox + 7 * s, oy + 9 * s, 2 * s, 3 * s);
      ctx.fillStyle = '#e03828';
      ctx.fillRect(ox + 5 * s, oy + 6 * s, 6 * s, 3 * s);
      ctx.fillRect(ox + 6 * s, oy + 5 * s, 4 * s, s);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(ox + 6 * s, oy + 7 * s, s, s);
      ctx.fillRect(ox + 9 * s, oy + 6 * s, s, s);
    }
    return;
  }

  if (kind === 'path') {
    ctx.fillStyle = p.path[0];
    ctx.fillRect(ox, oy, tileSize, tileSize);

    // Cobblestone / dirt path details
    ctx.fillStyle = p.path[1];
    ctx.fillRect(ox + 3 * s, oy + 3 * s, 4 * s, 3 * s);
    ctx.fillRect(ox + 9 * s, oy + 8 * s, 4 * s, 3 * s);
    ctx.fillRect(ox + 3 * s, oy + 11 * s, 3 * s, 2 * s);
    ctx.fillStyle = p.path[2];
    ctx.fillRect(ox + 3 * s, oy + 6 * s, 4 * s, s);
    ctx.fillRect(ox + 9 * s, oy + 11 * s, 4 * s, s);
    ctx.fillRect(ox + 11 * s, oy + 4 * s, 2 * s, 2 * s);

    // Autotile borders where path meets non-path
    ctx.fillStyle = p.path[3];
    if (neighbors.n !== 'path') {
      ctx.fillStyle = p.grass[0];
      ctx.fillRect(ox, oy, tileSize, s);
      ctx.fillStyle = p.path[2];
      ctx.fillRect(ox + s, oy + s, tileSize - 2 * s, s);
    }
    if (neighbors.s !== 'path') {
      ctx.fillStyle = p.grass[0];
      ctx.fillRect(ox, oy + 15 * s, tileSize, s);
      ctx.fillStyle = p.path[3];
      ctx.fillRect(ox + s, oy + 14 * s, tileSize - 2 * s, s);
    }
    if (neighbors.w !== 'path') {
      ctx.fillStyle = p.grass[0];
      ctx.fillRect(ox, oy, s, tileSize);
      ctx.fillStyle = p.path[2];
      ctx.fillRect(ox + s, oy + s, s, tileSize - 2 * s);
    }
    if (neighbors.e !== 'path') {
      ctx.fillStyle = p.grass[0];
      ctx.fillRect(ox + 15 * s, oy, s, tileSize);
      ctx.fillStyle = p.path[3];
      ctx.fillRect(ox + 14 * s, oy + s, s, tileSize - 2 * s);
    }

    if (deco === 'bridge') {
      // Wooden bridge planks
      ctx.fillStyle = '#583818';
      ctx.fillRect(ox, oy, tileSize, tileSize);
      ctx.fillStyle = '#a87038';
      for (let i = 1; i < 15; i += 4) {
        ctx.fillRect(ox + i * s, oy + 2 * s, 3 * s, 12 * s);
        ctx.fillStyle = '#c89050';
        ctx.fillRect(ox + i * s, oy + 2 * s, 3 * s, 2 * s);
        ctx.fillStyle = '#a87038';
      }
      ctx.fillStyle = '#382008';
      ctx.fillRect(ox, oy + s, tileSize, s);
      ctx.fillRect(ox, oy + 14 * s, tileSize, s);
    }
    return;
  }

  if (kind === 'water') {
    ctx.fillStyle = p.water[0];
    ctx.fillRect(ox, oy, tileSize, tileSize);

    // Animated ripples
    const shift = waterFrame === 1 ? 2 * s : 0;
    ctx.fillStyle = p.water[1];
    ctx.fillRect(ox + 2 * s + shift, oy + 4 * s, 5 * s, s);
    ctx.fillRect(ox + 8 * s - shift, oy + 10 * s, 5 * s, s);
    ctx.fillStyle = p.water[3];
    ctx.fillRect(ox + 3 * s + shift, oy + 3 * s, 3 * s, s);
    ctx.fillRect(ox + 9 * s - shift, oy + 9 * s, 3 * s, s);

    // Shoreline autotiling
    if (neighbors.n !== 'water') {
      ctx.fillStyle = p.path[0];
      ctx.fillRect(ox, oy, tileSize, 2 * s);
      ctx.fillStyle = p.water[3];
      ctx.fillRect(ox, oy + 2 * s, tileSize, s);
    }
    if (neighbors.s !== 'water') {
      ctx.fillStyle = p.water[2];
      ctx.fillRect(ox, oy + 14 * s, tileSize, 2 * s);
    }
    if (neighbors.w !== 'water') {
      ctx.fillStyle = p.path[0];
      ctx.fillRect(ox, oy, 2 * s, tileSize);
    }
    if (neighbors.e !== 'water') {
      ctx.fillStyle = p.path[0];
      ctx.fillRect(ox + 14 * s, oy, 2 * s, tileSize);
    }
    return;
  }

  if (kind === 'tree') {
    if (theme === 'indoor') {
      // Ornate stone wall / pillar in indoor halls
      const wallPal: Record<string, string> = {
        O: p.tree[0],
        D: p.tree[1],
        M: p.tree[2],
        L: p.tree[3],
      };
      const wallGrid = [
        'OOOOOOOOOOOOOOOO',
        'OLLLLLLLLLLLLLLO',
        'OLMMMMMMOMMMMMMO',
        'OLDDDDDDODDDDDDO',
        'OOOOOOOOOOOOOOOO',
        'OMMMOMMMMMMOMMMO',
        'ODDDODDDDDDODDDO',
        'OOOOOOOOOOOOOOOO',
        'OLLLLLLLOLLLLLLO',
        'OLMMMMMMOLMMMMMO',
        'OLDDDDDDOLDDDDDO',
        'OOOOOOOOOOOOOOOO',
        'OMMMMMOMMMMMMMMO',
        'ODDDDDODDDDDDDDO',
        'DDDDDDDDDDDDDDDD',
        'OOOOOOOOOOOOOOOO',
      ];
      drawPixelGrid(ctx, ox, oy, wallGrid, wallPal, s);
      return;
    }

    if (theme === 'harbour') {
      // Wooden mooring bollard / dock post
      const postPal: Record<string, string> = {
        O: '#181008',
        D: p.tree[1],
        M: p.tree[2],
        L: p.tree[3],
        R: '#d8b878',
      };
      const postGrid = [
        '................',
        '.....OOOOOO.....',
        '....OLLLLLLO....',
        '....OMMMMMMO....',
        '...OORRRRRROO...',
        '..ORRRRRRRRRRO..',
        '...OOMMMMMMOO...',
        '....OMDDDMMO....',
        '....OMDDDMMO....',
        '...ORRRRRRRRO...',
        '....OMDDDMMO....',
        '....OMDDDMMO....',
        '....ODDDDDDO....',
        '...OODDDDDDOO...',
        '....OOOOOOOO....',
        '................',
      ];
      drawPixelGrid(ctx, ox, oy, postGrid, postPal, s);
      return;
    }

    // Classic Zelda / Pokémon round canopy tree over grass
    const treePal: Record<string, string> = {
      O: p.tree[0],
      D: p.tree[1],
      M: p.tree[2],
      L: p.tree[3],
      T: '#684020',
      t: '#482810',
    };
    const treeGrid = [
      '....OOOOOOOO....',
      '..OOMLLLLLLMO...',
      '.OMLLLLLLLLLLMO.',
      '.OLLLLMMMMMLLLO.',
      'OMLLMMMMMMMMLLMO',
      'OMLMMMMMMMMMMLMO',
      'OMMMMMDDDDMMMMMO',
      'ODMMMDDDDDDMMMDO',
      '.ODDDDDDDDDDDDO.',
      '.OODDDDDDDDDDOO.',
      '..OOODDDDDDOOO..',
      '....OOOTtOOO....',
      '.....OTTTtO.....',
      '.....OTTTtO.....',
      '....OOTTTtOO....',
      '.....OOOOOO.....',
    ];
    drawPixelGrid(ctx, ox, oy, treeGrid, treePal, s);
    return;
  }

  if (kind === 'rock') {
    if (deco === 'house') {
      // Miniature GBC house façade tile
      const housePal: Record<string, string> = {
        O: '#181420',
        R: p.houseRoof[0],
        r: p.houseRoof[1],
        d: p.houseRoof[2],
        W: p.houseWall[0],
        w: p.houseWall[1],
        D: '#583818',
        G: '#ffd860',
      };
      const houseGrid = [
        '....OOOOOOOO....',
        '..OORrrrrrrROO..',
        '.ORrrrrrrrrrrRO.',
        'ORRRRRRRRRRRRRRO',
        'OddddddddddddddO',
        'OOOOOOOOOOOOOOOO',
        '.OWWWWWWWWWWWWO.',
        '.OWWOOOWWOOOWWO.',
        '.OWWOGOWWOGOWWO.',
        '.OWWOOOWWOOOWWO.',
        '.OWWWWWDDWWWWWO.',
        '.OWwwwDDDDwwwWO.',
        '.OWwwwDDDDwwwWO.',
        '.OWwwwDDDDwwwWO.',
        '.OOOOOOOOOOOOOO.',
        '................',
      ];
      drawPixelGrid(ctx, ox, oy, houseGrid, housePal, s);
      return;
    }

    if (deco === 'well') {
      const wellPal: Record<string, string> = {
        O: '#181824',
        S: p.rock[1],
        L: p.rock[2],
        D: p.rock[0],
        W: '#183058',
        B: '#784820',
      };
      const wellGrid = [
        '...OOOOOOOOOO...',
        '..OBBBBBBBBBBO..',
        '...OO......OO...',
        '...OB......BO...',
        '...OB......BO...',
        '..OOOOOOOOOOOO..',
        '.OLLLLLLLLLLLLO.',
        '.OSWWWWWWWWWWSo.',
        '.OSWWWWWWWWWWSo.',
        '.OSSSSSSSSSSSSO.',
        '.ODDDDDDDDDDDDO.',
        '..ODDDDDDDDDDO..',
        '..OOOOOOOOOOOO..',
        '................',
        '................',
        '................',
      ];
      drawPixelGrid(ctx, ox, oy, wellGrid, wellPal, s);
      return;
    }

    if (deco === 'signpost') {
      const signPal: Record<string, string> = {
        O: '#181008',
        L: '#d8a868',
        M: '#a87838',
        D: '#684018',
      };
      const signGrid = [
        '................',
        '................',
        '..OOOOOOOOOOOO..',
        '.OLLLLLLLLLLLLO.',
        '.OLMMMMMMMMMMLO.',
        '.OLMOOOOOOOOlMO.',
        '.OLMMMMMMMMMMLO.',
        '.OLMOOOOOOOOLMO.',
        '.ODDDDDDDDDDDDO.',
        '..OOOOODDOOOOO..',
        '......ODDO......',
        '......ODDO......',
        '......ODDO......',
        '.....OODDOO.....',
        '.....OOOOOO.....',
        '................',
      ];
      drawPixelGrid(ctx, ox, oy, signGrid, signPal, s);
      return;
    }

    if (deco === 'chest' || deco === 'crate' || theme === 'harbour' || theme === 'indoor') {
      // Wooden crate / table / chest
      const cratePal: Record<string, string> = {
        O: p.rock[3],
        D: p.rock[0],
        M: p.rock[1],
        L: p.rock[2],
        G: '#f8d048',
      };
      const crateGrid = [
        '................',
        '..OOOOOOOOOOOO..',
        '.OLLLLLLLLLLLLO.',
        '.OLMMMMMMMMMMLO.',
        '.OLMDDDDDDDDMLO.',
        '.OOOOOOOOOOOOOO.',
        '.OMMMMMGGMMMMMO.',
        '.OMDDDDGGDDDDMO.',
        '.OMMMMMMMMMMMMO.',
        '.ODDDDDDDDDDDDO.',
        '.ODMMMMMMMMMMDO.',
        '.ODDDDDDDDDDDDO.',
        '..OOOOOOOOOOOO..',
        '................',
        '................',
        '................',
      ];
      drawPixelGrid(ctx, ox, oy, crateGrid, cratePal, s);
      return;
    }

    // Classic Zelda / Pokémon cracked boulder
    const rockPal: Record<string, string> = {
      O: p.rock[3],
      D: p.rock[0],
      M: p.rock[1],
      L: p.rock[2],
    };
    const rockGrid = [
      '................',
      '....OOOOOOOO....',
      '..OOLLLLLLLLOO..',
      '.OLLLLLLLLLLLLO.',
      '.OLLMOMMMMMMLLO.',
      'OLLMMOMMMMMMMMLO',
      'OLMMMMOOMMMMMMMO',
      'OMMMMMMMOMMMMMMO',
      'OMMMMDDDDDDDDMMO',
      'ODDDDDDDDDDDDDDO',
      '.ODDDDDDDDDDDDO.',
      '.OODDDDDDDDDDOO.',
      '..OOOOOOOOOOOO..',
      '................',
      '................',
      '................',
    ];
    drawPixelGrid(ctx, ox, oy, rockGrid, rockPal, s);
  }
}
