/** The languages the game speaks, and the shape of everything it says. */
export type Locale = 'en' | 'it' | 'es';

export const LOCALES: readonly { id: Locale; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'it', label: 'Italiano' },
  { id: 'es', label: 'Español' },
];

/** The language the model is asked to speak, named in English for its rules. */
export const LANGUAGE_NAMES: Record<Locale, string> = {
  en: 'English',
  it: 'Italian',
  es: 'Spanish',
};

/**
 * The same order, given in the language itself. A small model follows the
 * language it can see in front of it far more readily than an English rule that
 * merely names one, so both prompts end on this line.
 */
export const WRITE_IN_LANGUAGE: Record<Locale, string> = {
  en: 'Write it in English.',
  it: 'Scrivi in italiano, non in inglese.',
  es: 'Escríbelo en español, no en inglés.',
};

export interface UiStrings {
  readonly tagline: string;
  readonly levelsLoading: string;
  readonly raindomMode: string;
  readonly raindomTitle: string;
  readonly inventing: string;
  readonly inventingStep: (done: number, total: number) => string;
  readonly inventingFailed: string;
  readonly modelLegend: string;
  readonly needsDownload: string;
  readonly alreadyDownloaded: string;
  readonly languageLegend: string;
  readonly opening: string;
  readonly summoning: (model: string) => string;
  readonly unsupportedTitle: string;
  readonly unsupportedBody: string;
  readonly openFailedTitle: string;
  readonly tryAgain: string;
  readonly levelFailedTitle: string;
  readonly backToMenu: string;
  readonly leave: string;
  readonly helpedCount: (done: number, total: number) => string;
  readonly whoIsHere: string;
  readonly stillStuck: string;
  readonly helpedWith: (object: string) => string;
  readonly controlsHint: string;
  readonly statsTitle: string;
  readonly statsCalls: string;
  readonly statsPromptTokens: string;
  readonly statsCompletionTokens: string;
  readonly statsPrefill: string;
  readonly statsDecode: string;
  readonly statsLastAnswer: string;
  readonly statsMaxBuffer: string;
  readonly statsStorage: string;
  readonly statsSource: (provider: string) => string;
  readonly talkTo: (name: string) => string;
  readonly talkAgain: (name: string) => string;
  readonly writeIntoBook: string;
  readonly conjure: string;
  readonly thinking: string;
  readonly placeholder: string;
  readonly inkRanDry: string;
  readonly showObject: string;
  readonly cameraHint: string;
  readonly capture: string;
  readonly cancel: string;
  readonly cameraUnavailable: string;
  readonly openingEye: (percent: number) => string;
  readonly looking: string;
  readonly playAgain: string;
  readonly inventAnother: string;
  readonly completeTitle: string;
  readonly completeSubtitle: (level: string) => string;
  readonly forWhom: (name: string) => string;
  readonly tiles: Record<string, string>;
  readonly facingSomeone: (tile: string, name: string) => string;
  readonly nearestVillager: (tile: string, name: string, steps: number) => string;
}
