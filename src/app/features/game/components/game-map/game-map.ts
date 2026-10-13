import {
  Component,
  DestroyRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { LocaleService } from '@core/i18n/locale.service';
import {
  decoAt,
  tileAt,
  type GameMap,
} from '@features/game/engine/map-generator';
import type { Facing, NpcProgress } from '@features/game/engine/game.service';
import {
  THEME_PALETTES,
  drawEmoteBubble,
  drawNpcSprite,
  drawPlayerSprite,
  drawTerrainTile,
  getNpcAppearance,
} from '@features/game/engine/pixel-sprites';

const TILE = 40;
const VIEW_COLS = 15;
const VIEW_ROWS = 11;

interface WeatherParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  phase: number;
}

interface SparkleParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

@Component({
  selector: 'mb-game-map',
  host: {
    '[attr.data-theme]': 'map().theme',
  },
  templateUrl: './game-map.html',
  styleUrl: './game-map.scss',
})
export class GameMapView {
  readonly map = input.required<GameMap>();
  readonly playerX = input.required<number>();
  readonly playerY = input.required<number>();
  readonly facing = input.required<Facing>();
  readonly progress = input.required<Record<string, NpcProgress>>();
  readonly stepCounter = input<number>(0);
  readonly bumpCounter = input<number>(0);
  readonly activeNpcId = input<string | null>(null);

  readonly talk = output<string>();
  readonly moveStep = output<Facing>();
  readonly interactAction = output<void>();

  private readonly t = inject(LocaleService).t;
  private readonly destroyRef = inject(DestroyRef);
  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('worldCanvas');

  protected readonly tileSize = TILE;
  protected readonly viewWidth = VIEW_COLS * TILE;
  protected readonly viewHeight = VIEW_ROWS * TILE;

  // Smooth interpolated camera & player coordinates (in tile units)
  private renderPlayerX = 0;
  private renderPlayerY = 0;
  private initializedPosition = false;
  private lastStepCounter = 0;
  private lastBumpCounter = 0;
  private walkAnimTimer = 0;
  private bumpTimer = 0;
  private tick = 0;

  // Cached terrain offscreen canvases (frame 0 and frame 1 for animated water)
  private terrainCache: [HTMLCanvasElement | null, HTMLCanvasElement | null] = [null, null];
  private cachedMapRef: GameMap | null = null;

  // Ambient weather & magic burst particles
  private weatherParticles: WeatherParticle[] = [];
  private sparkles: SparkleParticle[] = [];
  private previousSolvedIds = new Set<string>();

  /** Keeps the accessible overlay aligned with the smooth camera. */
  protected readonly worldTransform = computed(() => {
    const x = (VIEW_COLS / 2 - this.playerX() - 0.5) * TILE;
    const y = (VIEW_ROWS / 2 - this.playerY() - 0.5) * TILE;
    return `translate(${x}px, ${y}px)`;
  });

  constructor() {
    // Rebuild offscreen terrain atlas when map changes
    effect(() => {
      const m = this.map();
      if (m !== this.cachedMapRef) {
        this.cachedMapRef = m;
        this.renderPlayerX = m.spawn.x;
        this.renderPlayerY = m.spawn.y;
        this.initializedPosition = true;
        this.terrainCache = [null, null];
        this.initWeather(m);
        this.previousSolvedIds.clear();
      }
    });

    // Track walk steps & spawn dust puffs
    effect(() => {
      const step = this.stepCounter();
      const px = this.playerX();
      const py = this.playerY();
      if (step !== this.lastStepCounter) {
        this.lastStepCounter = step;
        this.walkAnimTimer = 12;
        this.spawnDustPuff(px, py);
      }
    });

    // Track obstacle bumps
    effect(() => {
      const bump = this.bumpCounter();
      if (bump !== this.lastBumpCounter) {
        this.lastBumpCounter = bump;
        this.bumpTimer = 8;
      }
    });

    // Spawn celebratory sparkles when a villager is newly solved
    effect(() => {
      const prog = this.progress();
      const m = this.map();
      for (const npc of m.npcs) {
        const isSolved = prog[npc.config.id]?.solved ?? false;
        if (isSolved && !this.previousSolvedIds.has(npc.config.id)) {
          this.previousSolvedIds.add(npc.config.id);
          this.spawnVictorySparkles(npc.x, npc.y);
        }
      }
    });

    afterNextRender(() => {
      let rafId = 0;
      const loop = () => {
        this.tick++;
        this.renderFrame();
        rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);
      this.destroyRef.onDestroy(() => cancelAnimationFrame(rafId));
    });
  }

  protected npcLabel(id: string, name: string): string {
    return this.progress()[id]?.solved ? this.t().talkAgain(name) : this.t().talkTo(name);
  }

  private buildTerrainCanvas(map: GameMap, waterFrame: 0 | 1): HTMLCanvasElement {
    const offscreen = document.createElement('canvas');
    offscreen.width = map.width * TILE;
    offscreen.height = map.height * TILE;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return offscreen;
    ctx.imageSmoothingEnabled = false;

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const kind = tileAt(map, x, y);
        const deco = decoAt(map, x, y);
        const neighbors = {
          n: tileAt(map, x, y - 1),
          s: tileAt(map, x, y + 1),
          e: tileAt(map, x + 1, y),
          w: tileAt(map, x - 1, y),
        };
        drawTerrainTile(
          ctx,
          x * TILE,
          y * TILE,
          kind,
          deco,
          map.theme,
          neighbors,
          waterFrame,
          TILE,
        );
      }
    }
    return offscreen;
  }

  private initWeather(map: GameMap): void {
    const kind = THEME_PALETTES[map.theme].weather;
    const count = kind === 'snow' ? 36 : kind === 'leaves' ? 18 : 14;
    const worldW = map.width * TILE;
    const worldH = map.height * TILE;
    this.weatherParticles = Array.from({ length: count }, (_, i) => ({
      x: ((i * 97) % Math.max(1, worldW)),
      y: ((i * 53) % Math.max(1, worldH)),
      vx: kind === 'snow' ? -0.35 : kind === 'leaves' ? 0.45 : 0.15,
      vy: kind === 'snow' ? 0.85 : kind === 'leaves' ? 0.55 : -0.25,
      size: kind === 'snow' ? 3 : 4,
      color:
        kind === 'snow'
          ? '#ffffff'
          : kind === 'leaves'
            ? i % 2 === 0
              ? '#ffd058'
              : '#78d860'
            : kind === 'seagulls'
              ? '#b8e8ff'
              : '#ffe898',
      phase: i * 0.7,
    }));
  }

  private spawnDustPuff(tileX: number, tileY: number): void {
    const cx = (tileX + 0.5) * TILE;
    const cy = (tileY + 0.82) * TILE;
    for (let i = 0; i < 4; i++) {
      const angle = (Math.PI * 2 * i) / 4 + Math.random() * 0.5;
      this.sparkles.push({
        x: cx + (Math.random() - 0.5) * 8,
        y: cy + (Math.random() - 0.5) * 4,
        vx: Math.cos(angle) * 0.6,
        vy: Math.sin(angle) * 0.4 - 0.3,
        life: 0,
        maxLife: 16,
        color: '#e8dcc8',
        size: 3,
      });
    }
  }

  private spawnVictorySparkles(tileX: number, tileY: number): void {
    const cx = (tileX + 0.5) * TILE;
    const cy = (tileY + 0.4) * TILE;
    const colors = ['#ffcf5c', '#7fdca4', '#ffffff', '#ff8b5e'];
    for (let i = 0; i < 24; i++) {
      const angle = (Math.PI * 2 * i) / 24;
      const speed = 1.2 + (i % 3) * 0.7;
      this.sparkles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.6,
        life: 0,
        maxLife: 38,
        color: colors[i % colors.length],
        size: 4,
      });
    }
  }

  private renderFrame(): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const map = this.map();
    const targetX = this.playerX();
    const targetY = this.playerY();

    if (!this.initializedPosition) {
      this.renderPlayerX = targetX;
      this.renderPlayerY = targetY;
      this.initializedPosition = true;
    } else {
      // Smooth lerp toward target tile
      this.renderPlayerX += (targetX - this.renderPlayerX) * 0.32;
      this.renderPlayerY += (targetY - this.renderPlayerY) * 0.32;
      if (Math.abs(targetX - this.renderPlayerX) < 0.01) this.renderPlayerX = targetX;
      if (Math.abs(targetY - this.renderPlayerY) < 0.01) this.renderPlayerY = targetY;
    }

    if (this.walkAnimTimer > 0) this.walkAnimTimer--;
    if (this.bumpTimer > 0) this.bumpTimer--;

    ctx.imageSmoothingEnabled = false;

    // Backdrop clear
    ctx.fillStyle = '#0d0a14';
    ctx.fillRect(0, 0, this.viewWidth, this.viewHeight);

    const waterFrame: 0 | 1 = Math.floor(this.tick / 28) % 2 === 0 ? 0 : 1;
    if (!this.terrainCache[waterFrame]) {
      this.terrainCache[waterFrame] = this.buildTerrainCanvas(map, waterFrame);
    }

    // Bump nudge offset when hitting an obstacle
    let bumpOffsetX = 0;
    let bumpOffsetY = 0;
    if (this.bumpTimer > 0) {
      const mag = Math.sin((this.bumpTimer / 8) * Math.PI) * 5;
      const f = this.facing();
      if (f === 'left') bumpOffsetX = -mag;
      if (f === 'right') bumpOffsetX = mag;
      if (f === 'up') bumpOffsetY = -mag;
      if (f === 'down') bumpOffsetY = mag;
    }

    const camX = Math.round((VIEW_COLS / 2 - this.renderPlayerX - 0.5) * TILE);
    const camY = Math.round((VIEW_ROWS / 2 - this.renderPlayerY - 0.5) * TILE);

    ctx.save();
    ctx.translate(camX, camY);

    // 1. Draw cached tilemap
    const cachedTerrain = this.terrainCache[waterFrame];
    if (cachedTerrain) {
      ctx.drawImage(cachedTerrain, 0, 0);
    }

    // 2. Highlight tile in front of player if an NPC stands there
    const stepDelta = {
      up: { dx: 0, dy: -1 },
      down: { dx: 0, dy: 1 },
      left: { dx: -1, dy: 0 },
      right: { dx: 1, dy: 0 },
    }[this.facing()];
    const frontX = targetX + stepDelta.dx;
    const frontY = targetY + stepDelta.dy;

    // 3. Collect entities (NPCs + Player) sorted by Y coordinate for 2.5D depth overlap
    const prog = this.progress();
    const npcIdleFrame: 0 | 1 = Math.floor(this.tick / 24) % 2 === 0 ? 0 : 1;
    const isMoving =
      this.walkAnimTimer > 0 ||
      Math.abs(targetX - this.renderPlayerX) > 0.04 ||
      Math.abs(targetY - this.renderPlayerY) > 0.04;
    const playerStepFrame: 0 | 1 | 2 = isMoving
      ? this.lastStepCounter % 2 === 0
        ? 1
        : 2
      : 0;

    interface DrawableEntity {
      y: number;
      draw: () => void;
    }

    const entities: DrawableEntity[] = [];

    for (const npc of map.npcs) {
      const solved = prog[npc.config.id]?.solved ?? false;
      const isFacing = npc.x === frontX && npc.y === frontY;
      const isTalking = this.activeNpcId() === npc.config.id;
      const appearance = getNpcAppearance(npc.config.id, npc.config.name);

      entities.push({
        y: npc.y,
        draw: () => {
          const nx = npc.x * TILE;
          const ny = npc.y * TILE;

          // Selection ring under NPC when facing or talking
          if (isFacing || isTalking) {
            ctx.strokeStyle = solved ? '#7fdca4' : '#ffcf5c';
            ctx.lineWidth = 2;
            ctx.strokeRect(nx + 4, ny + 26, TILE - 8, 12);
          }

          drawNpcSprite(ctx, nx, ny - 4, appearance, npcIdleFrame, solved, TILE / 16);
          drawEmoteBubble(ctx, nx, ny - 4, solved, isFacing || isTalking, this.tick, 2);
        },
      });
    }

    entities.push({
      y: this.renderPlayerY,
      draw: () => {
        const px = Math.round(this.renderPlayerX * TILE + bumpOffsetX);
        const py = Math.round(this.renderPlayerY * TILE + bumpOffsetY);
        drawPlayerSprite(ctx, px, py - 4, this.facing(), playerStepFrame, TILE / 16);
      },
    });

    entities.sort((a, b) => a.y - b.y);
    for (const entity of entities) {
      entity.draw();
    }

    // 4. Draw sparkles / footstep dust puffs
    for (let i = this.sparkles.length - 1; i >= 0; i--) {
      const sp = this.sparkles[i];
      sp.x += sp.vx;
      sp.y += sp.vy;
      sp.life++;
      if (sp.life >= sp.maxLife) {
        this.sparkles.splice(i, 1);
        continue;
      }
      const alpha = 1 - sp.life / sp.maxLife;
      ctx.fillStyle = sp.color;
      ctx.globalAlpha = alpha;
      ctx.fillRect(Math.round(sp.x), Math.round(sp.y), sp.size, sp.size);
    }
    ctx.globalAlpha = 1;

    // 5. Draw ambient weather particles across the world
    const worldW = map.width * TILE;
    const worldH = map.height * TILE;
    for (const wp of this.weatherParticles) {
      wp.x = (wp.x + wp.vx + Math.sin(this.tick * 0.03 + wp.phase) * 0.3 + worldW) % worldW;
      wp.y = (wp.y + wp.vy + worldH) % worldH;
      ctx.fillStyle = wp.color;
      ctx.globalAlpha = 0.75;
      ctx.fillRect(Math.round(wp.x), Math.round(wp.y), wp.size, wp.size);
    }
    ctx.globalAlpha = 1;

    ctx.restore();
  }
}
