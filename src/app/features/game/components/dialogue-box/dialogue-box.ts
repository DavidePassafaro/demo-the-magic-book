import {
  Component,
  afterRenderEffect,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { FormField, disabled, form, maxLength, required } from '@angular/forms/signals';
import { LocaleService } from '@core/i18n/locale.service';
import { Camera } from '@features/game/components/camera/camera';
import type { Attempt } from '@features/game/engine/game.service';
import { OBJECT_RECOGNIZER } from '@features/game/engine/model/contracts';
import { text, type NpcConfig } from '@features/game/engine/model/level';
import { drawNpcSprite, getNpcAppearance } from '@features/game/engine/pixel-sprites';

@Component({
  selector: 'mb-dialogue-box',
  imports: [FormField, Camera],
  templateUrl: './dialogue-box.html',
  styleUrl: './dialogue-box.scss',
})
export class DialogueBox {
  readonly npc = input.required<NpcConfig>();
  readonly attempt = input<Attempt | null>(null);
  readonly thinking = input(false);
  readonly solved = input(false);
  readonly solvedObject = input<string | null>(null);
  readonly solvedReply = input<string | null>(null);
  readonly error = input<string | null>(null);

  readonly wished = output<string>();
  readonly closed = output<void>();

  private readonly locale = inject(LocaleService);
  private readonly recognizer = inject(OBJECT_RECOGNIZER);
  private readonly wishInput = viewChild<ElementRef<HTMLInputElement>>('wishInput');
  private readonly portraitCanvas = viewChild<ElementRef<HTMLCanvasElement>>('portraitCanvas');
  private readonly draft = signal({ wish: '' });

  protected readonly t = this.locale.t;

  /** The camera replaces the text field while it is open. */
  protected readonly cameraOpen = signal(false);
  /** From the shutter until the eye has named what it saw. */
  protected readonly seeing = signal(false);
  protected readonly cameraError = signal<string | null>(null);

  /** What the book says while it looks: a download the first time, a glance after. */
  protected readonly seeingText = computed(() =>
    this.recognizer.phase() === 'loading'
      ? this.t().openingEye(Math.round(this.recognizer.progress() * 100))
      : this.t().looking,
  );

  protected readonly problem = computed(() => text(this.npc().problem, this.locale.locale()));
  /** The latest exchange, or — on a return visit — the one that solved it. */
  protected readonly shownObject = computed(() => this.attempt()?.object ?? this.solvedObject());
  protected readonly shownReply = computed(
    () => this.attempt()?.reply ?? (this.solved() ? (this.solvedReply() ?? '') : ''),
  );
  protected readonly objectWorked = computed(() => this.attempt()?.solved ?? this.solved());

  protected readonly wishForm = form(this.draft, (path) => {
    required(path.wish);
    maxLength(path.wish, 60);
    disabled(path.wish, () => this.thinking() || this.seeing());
  });

  constructor() {
    // The cursor belongs in the field: on opening, and again after every answer.
    // This runs after render because the field is disabled while the book is
    // writing, and focusing it before the template re-enables it does nothing.
    afterRenderEffect(() => {
      const currentNpc = this.npc();
      const isSolved = this.objectWorked();
      this.attempt();
      this.error();

      // Render pixel-art NPC portrait in the dialogue box
      const canvas = this.portraitCanvas()?.nativeElement;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.imageSmoothingEnabled = false;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const appearance = getNpcAppearance(currentNpc.id, currentNpc.name);
          drawNpcSprite(ctx, 4, 4, appearance, 0, isSolved, 3);
        }
      }

      // Closing the camera, or the eye naming the object, hands the cursor back
      // to the field — with the name already in it, one Enter from being judged.
      if (!this.thinking() && !this.cameraOpen() && !this.seeing()) {
        this.wishInput()?.nativeElement.focus();
      }
    });
  }

  protected openCamera(): void {
    this.cameraError.set(null);
    this.cameraOpen.set(true);
    // The eye is some four gigabytes: start fetching it while the player frames the shot.
    this.recognizer.prepare();
  }

  protected closeCamera(): void {
    this.cameraOpen.set(false);
  }

  /**
   * Turns a photo into a word in the field. It is not conjured on the player's
   * behalf: they see what the eye thought it saw, and can correct it first.
   */
  protected async show(image: string): Promise<void> {
    this.cameraOpen.set(false);
    this.cameraError.set(null);
    this.seeing.set(true);

    try {
      const name = await this.recognizer.recognize(image);
      this.draft.set({ wish: name });
    } catch (cause) {
      this.cameraError.set(cause instanceof Error ? cause.message : this.t().inkRanDry);
    } finally {
      this.seeing.set(false);
    }
  }

  protected submit(event: Event): void {
    event.preventDefault();

    const wish = this.wishForm.wish().value().trim();
    if (wish === '' || this.thinking()) {
      return;
    }

    this.wished.emit(wish);
    this.draft.set({ wish: '' });
  }
}
