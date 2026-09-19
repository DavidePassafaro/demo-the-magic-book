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
import type { Attempt } from '@features/game/engine/game.service';
import { text, type NpcConfig } from '@features/game/engine/model/level';

@Component({
  selector: 'mb-dialogue-box',
  imports: [FormField],
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
  private readonly wishInput = viewChild<ElementRef<HTMLInputElement>>('wishInput');
  private readonly draft = signal({ wish: '' });

  protected readonly t = this.locale.t;

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
    disabled(path.wish, () => this.thinking());
  });

  constructor() {
    // The cursor belongs in the field: on opening, and again after every answer.
    // This runs after render because the field is disabled while the book is
    // writing, and focusing it before the template re-enables it does nothing.
    afterRenderEffect(() => {
      this.npc();
      this.attempt();
      this.error();

      if (!this.thinking()) {
        this.wishInput()?.nativeElement.focus();
      }
    });
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
