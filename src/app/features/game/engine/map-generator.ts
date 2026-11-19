import {
  WALKABLE_TILES,
  type Level,
  type NpcConfig,
  type Theme,
  type TileKind,
} from '@features/game/engine/model/level';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface PlacedNpc extends Point {
  readonly config: NpcConfig;
}

export type TileDeco =
  | 'none'
  | 'flower'
  | 'tuft'
  | 'pebble'
  | 'mushroom'
  | 'house'
  | 'well'
  | 'signpost'
  | 'crate'
  | 'chest'
  | 'bridge'
  | 'stage'
  | 'screen-left'
  | 'screen'
  | 'screen-right'
  | 'chair'
  | 'lectern'
  | 'banner-yellow'
  | 'banner-purple'
  | 'plant';

export interface GameMap {
  readonly width: number;
  readonly height: number;
  readonly theme: Theme;
  /** Row-major, length width * height. */
  readonly tiles: readonly TileKind[];
  /** Deterministic visual variations per tile (length width * height). */
  readonly decos: readonly TileDeco[];
  readonly spawn: Point;
  readonly npcs: readonly PlacedNpc[];
}

/** Small deterministic PRNG, so a seed always yields the same map. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function tileAt(map: GameMap, x: number, y: number): TileKind {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) {
    return 'tree';
  }
  return map.tiles[y * map.width + x];
}

export function decoAt(map: GameMap, x: number, y: number): TileDeco {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) {
    return 'none';
  }
  return map.decos?.[y * map.width + x] ?? 'none';
}

export function npcAt(map: GameMap, x: number, y: number): PlacedNpc | null {
  return map.npcs.find((npc) => npc.x === x && npc.y === y) ?? null;
}

export function isWalkable(map: GameMap, x: number, y: number): boolean {
  return WALKABLE_TILES.includes(tileAt(map, x, y)) && npcAt(map, x, y) === null;
}

function reachableFrom(
  tiles: TileKind[],
  width: number,
  height: number,
  start: Point,
): Set<number> {
  const seen = new Set<number>([start.y * width + start.x]);
  const queue: Point[] = [start];

  while (queue.length > 0) {
    const current = queue.shift() as Point;
    const neighbours: Point[] = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ];

    for (const next of neighbours) {
      if (next.x < 0 || next.y < 0 || next.x >= width || next.y >= height) {
        continue;
      }
      const at = next.y * width + next.x;
      if (seen.has(at) || !WALKABLE_TILES.includes(tiles[at])) {
        continue;
      }
      seen.add(at);
      queue.push(next);
    }
  }

  return seen;
}

/** Scatters the villagers over tiles already proven reachable on foot. */
function placeNpcs(
  level: Level,
  tiles: TileKind[],
  width: number,
  spawn: Point,
  reachable: number[],
  random: () => number,
): PlacedNpc[] {
  const npcs: PlacedNpc[] = [];

  const reachableSet = new Set(reachable);

  for (const config of level.npcs) {
    const wanted = config.spot;
    if (wanted) {
      const at = wanted.y * width + wanted.x;
      const free = npcs.every((other) => other.x !== wanted.x || other.y !== wanted.y);
      const clearOfSpawn = wanted.x !== spawn.x || wanted.y !== spawn.y;
      if (reachableSet.has(at) && free && clearOfSpawn) {
        npcs.push({ config, x: wanted.x, y: wanted.y });
        continue;
      }
    }

    const candidates = reachable
      .map((at) => ({ x: at % width, y: Math.floor(at / width) }))
      .filter((point) => {
        const farFromSpawn = Math.abs(point.x - spawn.x) + Math.abs(point.y - spawn.y) >= 4;
        const farFromOthers = npcs.every(
          (other) => Math.abs(other.x - point.x) + Math.abs(other.y - point.y) >= 4,
        );
        return farFromSpawn && farFromOthers;
      });

    const spot =
      candidates.length > 0
        ? candidates[Math.floor(random() * candidates.length)]
        : { x: spawn.x + 1, y: spawn.y };

    npcs.push({ config, x: spot.x, y: spot.y });
  }

  return npcs;
}

interface OutdoorTuning {
  readonly ponds: number;
  readonly pondRadius: number;
  readonly tree: number;
  readonly rock: number;
  readonly sea: boolean;
}

const OUTDOOR: Record<Exclude<Theme, 'indoor'>, OutdoorTuning> = {
  // Wooded and green: trees everywhere, a few small ponds.
  village: { ponds: 3, pondRadius: 2, tree: 0.11, rock: 0.04, sea: false },
  // Open quayside: the sea takes one whole edge, and crates stand in for trees.
  harbour: { ponds: 2, pondRadius: 1, tree: 0.04, rock: 0.09, sea: true },
  // Snowfield: wide and empty, with frozen ponds and sparse dark pines.
  winter: { ponds: 4, pondRadius: 2, tree: 0.08, rock: 0.05, sea: false },
};

function generateOutdoor(level: Level, random: () => number): GameMap {
  const { width, height } = level;
  const theme = level.theme as Exclude<Theme, 'indoor'>;
  const tuning = OUTDOOR[theme];
  const tiles: TileKind[] = new Array<TileKind>(width * height).fill('grass');

  const set = (x: number, y: number, tile: TileKind): void => {
    if (x >= 0 && y >= 0 && x < width && y < height) {
      tiles[y * width + x] = tile;
    }
  };

  // A wall of trees, so the world has an edge.
  for (let x = 0; x < width; x++) {
    set(x, 0, 'tree');
    set(x, height - 1, 'tree');
  }
  for (let y = 0; y < height; y++) {
    set(0, y, 'tree');
    set(width - 1, y, 'tree');
  }

  // The harbour's sea: a ragged band eating into the right-hand edge.
  if (tuning.sea) {
    for (let y = 1; y < height - 1; y++) {
      const depth = 4 + Math.floor(random() * 3);
      for (let x = width - 1 - depth; x < width - 1; x++) {
        set(x, y, 'water');
      }
    }
  }

  for (let pond = 0; pond < tuning.ponds; pond++) {
    const cx = 2 + Math.floor(random() * (width - 4));
    const cy = 2 + Math.floor(random() * (height - 4));
    const radius = 1 + Math.floor(random() * tuning.pondRadius);
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) {
          set(x, y, 'water');
        }
      }
    }
  }

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (tiles[y * width + x] !== 'grass') {
        continue;
      }
      const roll = random();
      if (roll < tuning.tree) {
        set(x, y, 'tree');
      } else if (roll < tuning.tree + tuning.rock) {
        set(x, y, 'rock');
      }
    }
  }

  const spawn: Point = {
    // On the coast the player starts within sight of the water, not inland.
    x: Math.floor(width * (tuning.sea ? 0.58 : 0.5)),
    y: Math.floor(height / 2),
  };

  // A clearing around the spawn, so the player never starts boxed in.
  for (let y = spawn.y - 2; y <= spawn.y + 2; y++) {
    for (let x = spawn.x - 2; x <= spawn.x + 2; x++) {
      if (x > 0 && y > 0 && x < width - 1 && y < height - 1) {
        set(x, y, 'grass');
      }
    }
  }

  // Wandering paths, purely so the map reads as a place rather than noise.
  for (let walk = 0; walk < 3; walk++) {
    let x = spawn.x;
    let y = spawn.y;
    for (let step = 0; step < Math.floor(width * height * 0.06); step++) {
      set(x, y, 'path');
      if (random() < 0.5) {
        x += random() < 0.5 ? 1 : -1;
      } else {
        y += random() < 0.5 ? 1 : -1;
      }
      x = Math.min(Math.max(x, 1), width - 2);
      y = Math.min(Math.max(y, 1), height - 2);
    }
  }

  const reachable = [...reachableFrom(tiles, width, height, spawn)];
  const npcs = placeNpcs(level, tiles, width, spawn, reachable, random);
  const decos = buildDecorations(tiles, width, height, theme, spawn, npcs, random);

  return { width, height, theme, tiles, decos, spawn, npcs };
}

function buildDecorations(
  tiles: readonly TileKind[],
  width: number,
  height: number,
  theme: Theme,
  spawn: Point,
  npcs: readonly PlacedNpc[],
  random: () => number,
): TileDeco[] {
  const decos = new Array<TileDeco>(width * height).fill('none');
  let placedWell = false;
  let placedSign = false;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const kind = tiles[idx];
      const r = random();

      if (kind === 'grass') {
        if (theme === 'indoor') {
          // a clean conference carpet: nothing lying about
        } else if (theme === 'harbour') {
          if (r < 0.14) decos[idx] = 'pebble';
          else if (r < 0.22) decos[idx] = 'tuft';
        } else if (theme === 'winter') {
          if (r < 0.12) decos[idx] = 'tuft';
          else if (r < 0.18) decos[idx] = 'flower';
          else if (r < 0.24) decos[idx] = 'pebble';
        } else {
          // village
          if (r < 0.14) decos[idx] = 'flower';
          else if (r < 0.28) decos[idx] = 'tuft';
          else if (r < 0.32) decos[idx] = 'mushroom';
          else if (r < 0.36) decos[idx] = 'pebble';
        }
      } else if (kind === 'rock') {
        if (theme === 'indoor') {
          // generateIndoor dresses its own furniture
        } else if (theme === 'harbour') {
          decos[idx] = 'crate';
        } else if (theme === 'village') {
          if (!placedWell && Math.abs(x - spawn.x) + Math.abs(y - spawn.y) <= 7) {
            decos[idx] = 'well';
            placedWell = true;
          } else if (!placedSign && r < 0.25) {
            decos[idx] = 'signpost';
            placedSign = true;
          } else if (r < 0.35 && y < height - 3 && tiles[(y + 1) * width + x] !== 'water') {
            decos[idx] = 'house';
          }
        } else if (theme === 'winter') {
          if (!placedSign && r < 0.25) {
            decos[idx] = 'signpost';
            placedSign = true;
          } else if (r < 0.28) {
            decos[idx] = 'house';
          }
        }
      } else if (kind === 'path') {
        const nearWater =
          tiles[y * width + (x - 1)] === 'water' ||
          tiles[y * width + (x + 1)] === 'water' ||
          tiles[(y - 1) * width + x] === 'water' ||
          tiles[(y + 1) * width + x] === 'water';
        if (nearWater && theme !== 'indoor') {
          decos[idx] = 'bridge';
        }
      }
    }
  }

  // Keep NPC tiles clean of tall grass clutter
  for (const npc of npcs) {
    decos[npc.y * width + npc.x] = 'none';
  }
  decos[spawn.y * width + spawn.x] = 'none';

  return decos;
}

/**
 * A conference room: the stage with its projection screen along the top wall,
 * roll-up banners at its sides, and rows of chairs facing it, split by a
 * central aisle and two side aisles. The player walks in from the back.
 */
function generateIndoor(level: Level, random: () => number): GameMap {
  const { width, height } = level;
  const tiles: TileKind[] = new Array<TileKind>(width * height).fill('tree');
  const furniture = new Map<number, TileDeco>();

  const set = (x: number, y: number, tile: TileKind, deco?: TileDeco): void => {
    if (x >= 0 && y >= 0 && x < width && y < height) {
      tiles[y * width + x] = tile;
      if (deco) {
        furniture.set(y * width + x, deco);
      }
    }
  };

  const MARGIN = 2;
  const left = MARGIN;
  const right = width - MARGIN - 1;
  const top = MARGIN;
  const bottom = height - MARGIN - 1;
  const centre = Math.floor((left + right) / 2);

  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      set(x, y, 'grass');
    }
  }

  // The projection screen hangs on the top wall, centred over the stage.
  const screenLeft = centre - 3;
  const screenRight = centre + 4;
  for (let x = screenLeft; x <= screenRight; x++) {
    set(x, top - 1, 'tree', x === screenLeft ? 'screen-left' : x === screenRight ? 'screen-right' : 'screen');
  }

  // A two-row wooden stage, with banners at its corners and the lectern on one side.
  const stageLeft = left + 3;
  const stageRight = right - 3;
  for (let y = top; y <= top + 1; y++) {
    for (let x = stageLeft; x <= stageRight; x++) {
      set(x, y, 'path', 'stage');
    }
  }
  set(stageLeft, top, 'rock', 'banner-yellow');
  set(stageLeft + 1, top, 'rock', 'banner-purple');
  set(stageRight - 1, top, 'rock', 'banner-purple');
  set(stageRight, top, 'rock', 'banner-yellow');
  set(screenRight + 1, top, 'rock', 'lectern');
  set(left, top, 'rock', 'plant');
  set(right, top, 'rock', 'plant');

  // Rows of chairs facing the stage, with a free row between them to walk along.
  const firstRow = top + 3;
  for (let y = firstRow; y <= bottom - 2; y += 2) {
    for (let x = left + 1; x <= right - 1; x++) {
      if (x !== centre && x !== centre + 1) {
        set(x, y, 'rock', 'chair');
      }
    }
  }

  // The player comes in at the back of the room, at the end of the central aisle.
  const spawn: Point = { x: centre, y: bottom };

  const reachable = [...reachableFrom(tiles, width, height, spawn)];
  const npcs = placeNpcs(level, tiles, width, spawn, reachable, random);
  const decos = buildDecorations(tiles, width, height, 'indoor', spawn, npcs, random);
  for (const [at, deco] of furniture) {
    decos[at] = deco;
  }

  return { width, height, theme: 'indoor', tiles, decos, spawn, npcs };
}

/** Builds the level's map from its seed and its theme. */
export function generateMap(level: Level): GameMap {
  const random = mulberry32(level.seed);
  return level.theme === 'indoor' ? generateIndoor(level, random) : generateOutdoor(level, random);
}
