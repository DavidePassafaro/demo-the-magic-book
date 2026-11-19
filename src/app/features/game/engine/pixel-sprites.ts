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
    // light blue conference carpet
    grass: ['#8ea2c4', '#9cb0d0', '#8094b8', '#aabcd8'],
    // the stage's wooden boards
    path: ['#c89050', '#dca464', '#a87238', '#6a4424'],
    water: ['#305070', '#487898', '#183048', '#88b8d8'],
    // light grey wall panels: outline, shade, panel, highlight
    tree: ['#4a4650', '#bcb6aa', '#e6e0d4', '#f8f4ec'],
    // beige fabric chairs: shade, seat, highlight, outline
    rock: ['#a09078', '#ccbc9c', '#e4d8bc', '#3a3228'],
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
  /** A hand-drawn sprite for a real person, instead of the generic villager. */
  readonly look?: PersonLook;
}

export type PersonLook = 'giulia' | 'enrico';

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
  if (lowerId === 'giulia') {
    // tunic only colours the badge in the NPC panel: a dark mustard keeps its white text readable
    return { outline: '#181418', skin: '#f4cfb0', hair: '#8a5cc8', tunic: '#7a5800', tunicShade: '#c89810', belt: '#202020', look: 'giulia' };
  }
  if (lowerId === 'enrico') {
    return { outline: '#121014', skin: '#e8b890', hair: '#2a1c14', tunic: '#34343c', tunicShade: '#1e1e24', belt: '#e0b030', look: 'enrico' };
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

interface PersonSprite {
  readonly palette: Record<string, string>;
  readonly grid: (solved: boolean) => readonly string[];
}

const PERSON_SPRITES: Record<PersonLook, PersonSprite> = {
  // The organiser: purple bob with dark roots, yellow hoodie, black lanyard, phone in hand.
  giulia: {
    palette: {
      O: '#181418', // outline
      H: '#9a68d8', // purple hair
      h: '#5a3480', // dark roots and hair shade
      S: '#f4cfb0', // skin
      s: '#dcae8c', // skin shadow
      E: '#201820', // eyes
      M: '#b04858', // mouth
      G: '#e8e8f0', // earring
      Y: '#f4c820', // yellow hoodie
      y: '#c89810', // hoodie shade
      D: '#fff0a0', // hoodie drawstrings
      L: '#202020', // black lanyard
      P: '#3a4458', // phone
      p: '#88b8e8', // phone screen
      K: '#2a2a38', // dark trousers
    },
    grid: (solved) => [
      '.....OOOOOO.....',
      '....OhhhhhhO....',
      '...OhhHHHHhhO...',
      '..OhHHHHHHHHhO..',
      '..OHHHHHHSSSHO..',
      '..OHHSSSSSSSHO..',
      '..OHSESSSSESHO..',
      '..OHSSSSSSSShO..',
      solved ? '..OHGSMMMMSShO..' : '..OHGSSMMSSShO..',
      '..OhHOSSSSsOhO..',
      '..OOYYLsSLYYOO..',
      '.OYyYYDLLDYYyYO.',
      '.OYyYYDYYDYYPpO.',
      '.OSyYYYYYYYYSPO.',
      '..OOyYYYYYYyOO..',
      '...OKKKOOKKKO...',
    ],
  },
  // The master of ceremonies: short dark hair, full beard, black t-shirt, badge, microphone, jeans.
  enrico: {
    palette: {
      O: '#121014', // outline
      K: '#2a1c14', // dark hair
      k: '#4a3424', // hair highlight and eyebrows
      S: '#e8b890', // skin
      E: '#141018', // eyes
      Z: '#3a2618', // beard
      z: '#20140c', // moustache shadow
      W: '#f4f4f4', // smile and sneakers
      T: '#34343c', // black t-shirt
      t: '#222228', // t-shirt shade
      N: '#e8e8e8', // lanyard
      C: '#f8f8f8', // badge card
      X: '#e0b030', // badge band
      M: '#202024', // microphone handle
      m: '#a0a8b0', // microphone grille
      J: '#4a5878', // jeans
      j: '#34405a', // jeans shade
    },
    grid: (solved) => [
      '.....OOOOOO.....',
      '....OKkKKKKO....',
      '...OKKKKKKKKO...',
      '..OKKKKKKKKKKO..',
      '..OKSSSSSSSSKO..',
      '..OSSkkSSkkSSO..',
      '..OSSESSSSESSO..',
      '..OZSSSSSSSSZO..',
      solved ? '..OZZzWWWWzZZO..' : '..OZZzzzzzzZZO..',
      '...OZZZZZZZZOmO.',
      '.OTNTOZZZZOTNmO.',
      '.OTtTNOOOONTTMO.',
      '.OStTTNCCNTTSSO.',
      '.OOtTTTXXTTtOO..',
      '..OJJJjOOjJJJO..',
      '..OWWWO..OWWWO..',
    ],
  },
};

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

  if (appearance.look) {
    const person = PERSON_SPRITES[appearance.look];
    drawPixelGrid(ctx, ox, oy + bobY, person.grid(solved), person.palette, scale);
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

  if (kind === 'path' && deco === 'stage') {
    drawStageTile(ctx, ox, oy, p, neighbors.s !== 'path' && neighbors.s !== 'rock', s);
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
      // Conference room wall: light panels with a seam
      const wallPal: Record<string, string> = {
        O: p.tree[0],
        D: p.tree[1],
        M: p.tree[2],
        L: p.tree[3],
      };
      const wallGrid = [
        'LLLLLLLLLLLLLLLL',
        'MMMMMMMLMMMMMMMM',
        'MMMMMMMLMMMMMMMM',
        'MMMMMMMLMMMMMMMM',
        'MMMMMMMLMMMMMMMM',
        'MMMMMMMLMMMMMMMM',
        'MMMMMMMLMMMMMMMM',
        'MMMMMMMLMMMMMMMM',
        'MMMMMMMLMMMMMMMM',
        'MMMMMMMLMMMMMMMM',
        'MMMMMMMLMMMMMMMM',
        'MMMMMMMLMMMMMMMM',
        'MMMMMMMLMMMMMMMM',
        'MMMMMMMLMMMMMMMM',
        'MMMMMMMLMMMMMMMM',
        'DDDDDDDDDDDDDDDD',
      ];
      drawPixelGrid(ctx, ox, oy, wallGrid, wallPal, s);
      if (deco === 'screen-left' || deco === 'screen' || deco === 'screen-right') {
        drawScreenTile(ctx, ox, oy, deco, s);
      }
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
    if (deco === 'chair' || deco === 'lectern' || deco === 'banner-yellow' || deco === 'banner-purple') {
      if (deco !== 'chair') {
        drawStageTile(ctx, ox, oy, p, false, s);
      }
      drawConferenceProp(ctx, ox, oy, deco, p, s);
      return;
    }
    if (deco === 'plant') {
      drawConferenceProp(ctx, ox, oy, deco, p, s);
      return;
    }

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

/** Wooden stage boards; the front edge drops into a dark lip. */
function drawStageTile(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  p: ThemePalette,
  frontEdge: boolean,
  s: number,
): void {
  ctx.fillStyle = p.path[0];
  ctx.fillRect(ox, oy, 16 * s, 16 * s);
  ctx.fillStyle = p.path[1];
  for (let y = 0; y < 16; y += 4) {
    ctx.fillRect(ox, oy + y * s, 16 * s, s);
  }
  ctx.fillStyle = p.path[2];
  for (let y = 3; y < 16; y += 4) {
    ctx.fillRect(ox, oy + y * s, 16 * s, s);
    ctx.fillRect(ox + ((y * 5) % 16) * s, oy + (y - 3) * s, s, 3 * s);
  }
  if (frontEdge) {
    ctx.fillStyle = p.path[3];
    ctx.fillRect(ox, oy + 12 * s, 16 * s, 4 * s);
    ctx.fillStyle = '#2c1c10';
    ctx.fillRect(ox, oy + 15 * s, 16 * s, s);
  }
}

/** One slice of the projection screen on the wall, with a slide on it. */
function drawScreenTile(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  deco: 'screen-left' | 'screen' | 'screen-right',
  s: number,
): void {
  const pal: Record<string, string> = {
    F: '#1c1c24', // frame
    W: '#eef2fa', // screen
    w: '#d4dcec', // screen shade
    B: '#3858c8', // slide title
    b: '#9aa8c8', // slide text
    A: '#dd0031', // Angular red
  };
  const middle = [
    'FFFFFFFFFFFFFFFF',
    'WWWWWWWWWWWWWWWW',
    'WWWWWWWWWWWWWWWW',
    'BBBBBBBBBBBBWWWW',
    'BBBBBBBBBBBBWWWW',
    'WWWWWWWWWWWWWWWW',
    'bbbbbbbbbWWWWWWW',
    'WWWWWWWWWWWWWWWW',
    'bbbbbbbbbbbbbWWW',
    'WWWWWWWWWWWWWWWW',
    'bbbbbbWWWWWWWWWW',
    'wwwwwwwwwwwwwwww',
    'FFFFFFFFFFFFFFFF',
    '................',
    '................',
    '................',
  ];
  const edgeLeft = [
    'FFFFFFFFFFFFFFFF',
    'FWWWWWWWWWWWWWWW',
    'FWWWWWWWWWWWWWWW',
    'FWWWBBBBBBBBBBBB',
    'FWWWBBBBBBBBBBBB',
    'FWWWWWWWWWWWWWWW',
    'FWWWbbbbbbbbbbbb',
    'FWWWWWWWWWWWWWWW',
    'FWWWbbbbbbbbbbbb',
    'FWWWWWWWWWWWWWWW',
    'FWWWbbbbbbbbbbbb',
    'Fwwwwwwwwwwwwwww',
    'FFFFFFFFFFFFFFFF',
    '................',
    '................',
    '................',
  ];
  const edgeRight = [
    'FFFFFFFFFFFFFFFF',
    'WWWWWWWWWWWWWWWF',
    'WWWWWWWWWAAAWWWF',
    'WWWWWWWWAAAAAWWF',
    'WWWWWWWWAAWAAWWF',
    'WWWWWWWWAAAAAWWF',
    'WWWWWWWWWAAAWWWF',
    'WWWWWWWWWWWWWWWF',
    'WWWWWWWWWWWWWWWF',
    'WWWWWWWWWWWWWWWF',
    'WWWWWWWWWWWWWWWF',
    'wwwwwwwwwwwwwwwF',
    'FFFFFFFFFFFFFFFF',
    '................',
    '................',
    '................',
  ];
  const grid = deco === 'screen-left' ? edgeLeft : deco === 'screen-right' ? edgeRight : middle;
  drawPixelGrid(ctx, ox, oy, grid, pal, s);
}

/** Chairs, the lectern, roll-up banners and potted plants. */
function drawConferenceProp(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  deco: 'chair' | 'lectern' | 'banner-yellow' | 'banner-purple' | 'plant',
  p: ThemePalette,
  s: number,
): void {
  if (deco === 'chair') {
    // Seen from above and behind: the seat, then the backrest towards the viewer.
    const pal: Record<string, string> = {
      O: p.rock[3],
      D: p.rock[0],
      M: p.rock[1],
      L: p.rock[2],
      A: '#5c5650',
    };
    const grid = [
      '................',
      '.OOOOOOOOOOOOOO.',
      '.OAMMMMMMMMMMAO.',
      '.OAMLLLLLLLLMAO.',
      '.OAMMMMMMMMMMAO.',
      '.OADDDDDDDDDDAO.',
      '.OOOOOOOOOOOOOO.',
      '..OLLLLLLLLLLO..',
      '..OLMMMMMMMMLO..',
      '..OMMMMMMMMMMO..',
      '..OMMMMMMMMMMO..',
      '..ODDDDDDDDDDO..',
      '..OOOOOOOOOOOO..',
      '...OA......AO...',
      '...OO......OO...',
      '................',
    ];
    drawPixelGrid(ctx, ox, oy, grid, pal, s);
    return;
  }

  if (deco === 'lectern') {
    const pal: Record<string, string> = {
      O: '#181410',
      D: '#3a2a1c',
      M: '#5c4430',
      L: '#7c5c40',
      K: '#202428', // laptop
      k: '#8898b0', // laptop screen glow
      A: '#dd0031', // Angular sticker
    };
    const grid = [
      '................',
      '...OOOOOOOOOO...',
      '...OKKKKKKKKO...',
      '...OKkkkkkkKO...',
      '..OOOOOOOOOOOO..',
      '..OLLLLLLLLLLO..',
      '..OMMMMMMMMMMO..',
      '...OMMMAAMMMO...',
      '...OMMMAAMMMO...',
      '...OMMMMMMMMO...',
      '...OMMMMMMMMO...',
      '...ODDDDDDDDO...',
      '...ODDDDDDDDO...',
      '..OOOOOOOOOOOO..',
      '................',
      '................',
    ];
    drawPixelGrid(ctx, ox, oy, grid, pal, s);
    return;
  }

  if (deco === 'banner-yellow' || deco === 'banner-purple') {
    const yellow = deco === 'banner-yellow';
    const pal: Record<string, string> = {
      O: '#181418',
      B: yellow ? '#f4cc20' : '#6a3ec8',
      b: yellow ? '#d0a810' : '#4e2aa0',
      L: yellow ? '#181418' : '#f8f8ff',
      F: '#8890a0', // stand
    };
    const grid = [
      '....OOOOOOOO....',
      '....OBBBBBBO....',
      '....OBLLLLBO....',
      '....OBLBBLBO....',
      '....OBLLLLBO....',
      '....OBBBBBBO....',
      '....OBLLLBBO....',
      '....OBBBBBBO....',
      '....OBLLLLBO....',
      '....OBBBBBBO....',
      '....ObbbbbbO....',
      '....ObbbbbbO....',
      '....OOOOOOOO....',
      '...OFFFFFFFFO...',
      '...OOOOOOOOOO...',
      '................',
    ];
    drawPixelGrid(ctx, ox, oy, grid, pal, s);
    return;
  }

  // plant
  ctx.fillStyle = p.grass[0];
  ctx.fillRect(ox, oy, 16 * s, 16 * s);
  const pal: Record<string, string> = {
    O: '#10200c',
    G: '#2e7a30',
    g: '#4aa848',
    P: '#6c6460',
    p: '#4c4642',
  };
  const grid = [
    '.....O...O......',
    '....OgO.OgO..O..',
    '..O.OGgOgGO.OgO.',
    '.OgOOGGgGGOOgGO.',
    '.OGgOGgGgGOgGGO.',
    '..OGGgGGGgGGGO..',
    '...OGGgGgGGgO...',
    '..OgGGGgGGGGgO..',
    '...OOGGGGGGOO...',
    '....OOOOOOOO....',
    '....OPPPPPPO....',
    '....OPPPPPPO....',
    '....OpPPPPpO....',
    '.....OppppO.....',
    '.....OOOOOO.....',
    '................',
  ];
  drawPixelGrid(ctx, ox, oy, grid, pal, s);
}

/** A 5x7 pixel font, one string of 35 bits per glyph, row by row. */
const PIXEL_FONT: Record<string, string> = {
  A: '01110100011000111111100011000110001',
  B: '11110100011000111110100011000111110',
  C: '01110100011000010000100001000101110',
  D: '11110100011000110001100011000111110',
  E: '11111100001000011110100001000011111',
  F: '11111100001000011110100001000010000',
  G: '01110100011000010111100011000101111',
  H: '10001100011000111111100011000110001',
  I: '01110001000010000100001000010001110',
  J: '00111000100001000010000101001001100',
  K: '10001100101010011000101001001010001',
  L: '10000100001000010000100001000011111',
  M: '10001110111010110101100011000110001',
  N: '10001110011010110011100011000110001',
  O: '01110100011000110001100011000101110',
  P: '11110100011000111110100001000010000',
  Q: '01110100011000110001101011001001101',
  R: '11110100011000111110101001001010001',
  S: '01111100001000001110000010000111110',
  T: '11111001000010000100001000010000100',
  U: '10001100011000110001100011000101110',
  V: '10001100011000110001100010101000100',
  W: '10001100011000110101101011010101010',
  X: '10001100010101000100010101000110001',
  Y: '10001100010101000100001000010000100',
  Z: '11111000010001000100010001000011111',
  '0': '01110100011001110101110011000101110',
  '1': '00100011000010000100001000010001110',
  '2': '01110100010000100010001000100011111',
  '3': '11111000100010000010000011000101110',
  '4': '00010001100101010010111110001000010',
  '5': '11111100001111000001000011000101110',
  '6': '00110010001000011110100011000101110',
  '7': '11111000010001000100010000100001000',
  '8': '01110100011000101110100011000101110',
  '9': '01110100011000101111000010001001100',
  '#': '01010010101111101010111110101001010',
  '-': '00000000000000011111000000000000000',
  '.': '00000000000000000000000000110001100',
};

/**
 * Paints text in the pixel font, centred on (cx, cy), as large as fits in maxWidth.
 * Angular red with a dark outline, so it reads on any floor.
 */
export function drawPixelText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  maxWidth: number,
  color = '#e40035',
  outline = '#2a0c10',
): void {
  const columns = text.length * 6 - 1 + 2;
  const scale = Math.max(1, Math.min(4, Math.floor(maxWidth / columns)));
  const left = Math.round(cx - (columns * scale) / 2) + scale;
  const top = Math.round(cy - (7 * scale) / 2);

  const paint = (fill: string, dx: number, dy: number): void => {
    ctx.fillStyle = fill;
    [...text].forEach((ch, i) => {
      const glyph = PIXEL_FONT[ch];
      if (!glyph) return;
      for (let bit = 0; bit < 35; bit++) {
        if (glyph[bit] === '1') {
          const gx = left + (i * 6 + (bit % 5)) * scale + dx;
          const gy = top + Math.floor(bit / 5) * scale + dy;
          ctx.fillRect(gx, gy, scale, scale);
        }
      }
    });
  };

  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    paint(outline, dx * scale, dy * scale);
  }
  paint(color, 0, 0);
}
