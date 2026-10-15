import {
  Component,
  computed,
  effect,
  inject,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { WebLlmService } from '@core/webllm/web-llm.service';
import { findModel } from '@core/webllm/data/llm-models';
import { LocaleService } from '@core/i18n/locale.service';
import { log } from '@core/logger/logger';
import { GameService, type Facing } from '@features/game/engine/game.service';
import { LEVEL_INVENTOR } from '@features/game/engine/model/contracts';
import { LevelService } from '@features/game/engine/level.service';
import { RANDOM_LEVEL_ID, text } from '@features/game/engine/model/level';
import { DialogueBox } from '@features/game/components/dialogue-box/dialogue-box';
import { GameMapView } from '@features/game/components/game-map/game-map';
import { LevelComplete } from '@features/game/components/level-complete/level-complete';
import { LoadingScreen } from '@shared/loading-screen/loading-screen';
import { NpcPanel } from '@features/game/components/npc-panel/npc-panel';
import { SettingsBar } from '@shared/settings-bar/settings-bar';

/** Arrow keys (and WASD when not writing in the book) move the player on the map. */
const MOVEMENT_KEYS: Record<string, Facing> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  W: 'up',
  s: 'down',
  S: 'down',
  a: 'left',
  A: 'left',
  d: 'right',
  D: 'right',
};

@Component({
  selector: 'mb-play',
  imports: [
    RouterLink,
    LoadingScreen,
    GameMapView,
    DialogueBox,
    NpcPanel,
    LevelComplete,
    SettingsBar,
  ],
  host: {
    '(document:keydown)': 'onKey($event)',
    '(click)': 'onClick($event)',
  },
  templateUrl: './play.html',
  styleUrl: './play.scss',
})
export class Play {
  protected readonly llm = inject(WebLlmService);
  protected readonly game = inject(GameService);

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly levels = inject(LevelService);
  protected readonly generator = inject(LEVEL_INVENTOR);
  private readonly locale = inject(LocaleService);
  private readonly stage = viewChild<ElementRef<HTMLElement>>('stage');

  protected readonly t = this.locale.t;
  protected readonly levelError = signal<string | null>(null);
  protected readonly ready = signal(false);
  /** The popup waits until the last villager has had their say. */
  protected readonly showComplete = signal(false);

  protected readonly activeMap = computed(() => (this.ready() ? this.game.map() : null));

  /** A rAIndom village cannot be replayed, only replaced by another one. */
  protected readonly replayLabel = computed(() =>
    this.isRandom() ? this.t().inventAnother : this.t().playAgain,
  );

  private isRandom(): boolean {
    return this.route.snapshot.paramMap.get('levelId') === RANDOM_LEVEL_ID;
  }

  protected readonly levelTitle = computed(() => {
    const level = this.game.level();
    return level ? text(level.title, this.locale.locale()) : '';
  });

  protected readonly loadingTitle = computed(() => {
    if (this.generator.phase() === 'working') {
      return this.t().inventing;
    }
    return this.llm.chat.status() === 'loading'
      ? this.t().summoning(findModel(this.llm.modelId()).label)
      : this.t().opening;
  });

  /**
   * Inventing a village is the game's own errand, so the game counts it out;
   * a download is the engine's, so the engine's own words are shown as they are.
   */
  protected readonly loadingText = computed(() =>
    this.generator.phase() === 'working'
      ? this.t().inventingStep(this.generator.done() + 1, this.generator.total())
      : this.llm.chat.progressText(),
  );

  protected readonly loadingProgress = computed(() =>
    this.generator.phase() === 'working' ? this.generator.progress() : this.llm.chat.progress(),
  );

  constructor() {
    this.start();

    /**
     * Choosing another model mid-level starts the level again on the new one.
     * There is nothing to play in the meantime anyway: the mind that was
     * answering has just been put away.
     */
    effect(() => {
      if (
        this.llm.chat.status() === 'ready' &&
        this.llm.chat.loadedModelId() !== this.llm.modelId()
      ) {
        log.info('game', 'another model was chosen: restarting the level on it');
        this.start();
      }
    });
  }

  protected start(): void {
    this.ready.set(false);
    this.showComplete.set(false);
    this.levelError.set(null);

    const levelId = this.route.snapshot.paramMap.get('levelId') ?? '';

    const opened =
      levelId === RANDOM_LEVEL_ID
        ? // Nothing exists yet: the model has to be awake before it can invent.
          this.llm.loadModel().then(async (ready) => {
            if (!ready) {
              return null;
            }
            return this.generator.invent(this.locale.inEveryLanguage((s) => s.raindomTitle));
          })
        : this.levels.loadLevel(levelId).then(async (level) => {
            const ready = await this.llm.loadModel();
            return ready ? level : null;
          });

    opened
      .then((level) => {
        if (!level) {
          return;
        }
        this.game.startLevel(level);
        this.ready.set(true);
      })
      .catch((cause: unknown) => {
        if (this.generator.phase() !== 'failed') {
          log.error('game', 'the level could not start', cause);
          this.levelError.set(cause instanceof Error ? cause.message : 'Unknown error.');
        }
      });
  }

  /**
   * Ends the conversation. If that was the last villager, the level's closing
   * popup appears now — after they have answered, never interrupting them.
   */
  protected leaveEncounter(): void {
    this.game.closeEncounter();
    this.stage()?.nativeElement.focus();

    if (this.game.allSolved()) {
      this.showComplete.set(true);
    }
  }

  protected goHome(): void {
    void this.router.navigate(['/']);
  }

  /** With no Leave button, clicking away from the box is the mouse's way out. */
  protected onClick(event: MouseEvent): void {
    if (this.game.activeNpcId() === null || this.showComplete()) {
      return;
    }

    const target = event.target as HTMLElement | null;

    if (target?.closest('mb-dialogue-box') || target?.closest('button')) {
      return;
    }

    this.leaveEncounter();
  }

  protected onKey(event: KeyboardEvent): void {
    if (this.showComplete()) {
      return;
    }

    const inEncounter = this.game.activeNpcId() !== null;
    const direction = MOVEMENT_KEYS[event.key];

    if (event.key === 'Escape' && inEncounter) {
      event.preventDefault();
      this.leaveEncounter();
      return;
    }

    const target = event.target as HTMLElement | null;

    // Framing a shot is not walking. Asked of the page, not of the focus: a
    // click on the preview leaves focus nowhere useful, and the player is
    // still holding something up.
    if (inEncounter && this.stage()?.nativeElement.querySelector('mb-camera')) {
      return;
    }

    const isField = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
    const midSentence = isField && (target as HTMLInputElement).value.trim() !== '';

    if (inEncounter) {
      // Walking away with arrow keys ends a conversation — unless you are mid-wish.
      const isArrow = event.key.startsWith('Arrow');
      if (direction && isArrow && !midSentence && !this.game.thinking()) {
        // Pressing towards the person you are speaking to is not walking away.
        if (this.game.npcInDirection(direction)?.config.id === this.game.activeNpcId()) {
          event.preventDefault();
          return;
        }

        event.preventDefault();
        this.leaveEncounter();
        this.game.move(direction);
      }
      return;
    }

    if (isField || !this.ready()) {
      return;
    }

    if (direction) {
      event.preventDefault();
      this.game.move(direction);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.game.interact();
    }
  }

  protected onDpadMove(direction: Facing): void {
    if (this.showComplete() || !this.ready() || this.game.thinking()) {
      return;
    }
    if (this.game.activeNpcId() !== null) {
      if (this.game.npcInDirection(direction)?.config.id === this.game.activeNpcId()) {
        return;
      }
      this.leaveEncounter();
    }
    this.game.move(direction);
  }
}
