import { Injector, Service, inject } from '@angular/core';
import { conversation, generate, save, step, type ConversationRef } from 'ng-webllm';
import type { Locale } from '@core/i18n/model/locale';
import { LocaleService } from '@core/i18n/locale.service';
import { log } from '@core/logger/logger';
import type { NpcConfig } from '@features/game/engine/model/level';
import type { Verdict } from '@features/game/engine/model/contracts';
import { VERDICT, judgePrompt, type FullVerdict } from '@features/game/ai/prompts/judge.prompt';
import { TRANSLATION, wishToEnglishPrompt } from '@features/game/ai/prompts/translate.prompt';

/**
 * Turns the language model into the game's referee. Every villager has a
 * dialogue the player can follow, but the model never remembers it: each wish
 * is judged on its own (`memory: 'none'`).
 */
@Service({ autoProvided: false })
export class JudgeService {
  private readonly locale = inject(LocaleService);
  private readonly injector = inject(Injector);
  private readonly dialogues = new Map<string, ConversationRef<FullVerdict>>();

  /** The villager's dialogue: what was wished, what they answered, and the answer being written. */
  dialogue(npc: NpcConfig): ConversationRef<FullVerdict> {
    let chat = this.dialogues.get(npc.id);

    if (!chat) {
      // 👇👇👇 Game - One dialogue per villager
      chat = conversation<FullVerdict>({
        system: '',
        memory: 'none',
        injector: this.injector,
      });
      this.dialogues.set(npc.id, chat);
    }

    return chat;
  }

  /** A new level: the villagers are new people, with nothing said yet. */
  forget(): void {
    for (const chat of this.dialogues.values()) {
      chat.destroy();
    }
    this.dialogues.clear();
  }

  /** Temperature zero: the same wish twice gets the same answer twice. */
  async judge(npc: NpcConfig, object: string): Promise<Verdict> {
    const locale = this.locale.locale();
    const chat = this.dialogue(npc);

    // 👇👇👇 Game - The judge as a chain
    const judgeWish = chat.chain(
      // The player sees their wish as they wrote it.
      save.forUser((wish: string) => wish),
      // "bastone" becomes "a stick (bastone)": the model judges in English.
      step((wish: string) => this.toEnglish(chat, wish, locale)),
      // Reasoning, verdict, reply: in this order, so the model thinks before deciding.
      generate((english: string) => judgePrompt(npc, english, locale), {
        schema: VERDICT,
        maxTokens: 220,
        retry: 1,
        purpose: `judge "${object}" for ${npc.name}`,
      }),
      // Only the villager's line is written: the reasoning stays with the model.
      save.forUser((verdict) => verdict.npcReply),
    );

    const verdict = await judgeWish(object);
    if (verdict.npcReply.trim() === '') {
      throw new Error('The villager said nothing.');
    }

    log.info('judge', `${npc.name} · "${object}" → ${verdict.solved ? 'SOLVED' : 'rejected'}`);
    return { solved: verdict.solved, npcReply: verdict.npcReply.trim() };
  }

  /** On failure the wish is judged as typed. */
  private async toEnglish(
    chat: ConversationRef<FullVerdict>,
    object: string,
    locale: Locale,
  ): Promise<string> {
    if (locale === 'en') {
      return object;
    }

    try {
      // 👇👇👇 Game - A question on the side, never saved
      const reply = await chat.aside(() => wishToEnglishPrompt(object, locale), {
        schema: TRANSLATION,
        maxTokens: 40,
        purpose: `translate wish "${object}" → en`,
      });

      const english = reply.value.translation.trim();
      return english ? `${english} (${object})` : object;
    } catch {
      return object;
    }
  }
}
