/**
 * The console narration of the game: what each model is asked, what it answers,
 * how long it takes and what goes wrong. Every call is one collapsed group, so
 * a room watching the DevTools can follow one question at a time and open only
 * the ones worth opening.
 *
 * On by default. `localStorage.setItem('magic-book.logs', 'off')` silences it;
 * errors are always printed.
 */

/** Who is speaking. Each has its own colour, so the eye finds it at once. */
export type LogSource = 'engine' | 'vision' | 'judge' | 'inventor' | 'eye' | 'camera' | 'game';

const COLORS: Record<LogSource, string> = {
  engine: '#8b7cf6',
  vision: '#2bb3a3',
  judge: '#e0a82e',
  inventor: '#e8734a',
  eye: '#45c2d6',
  camera: '#9aa5b1',
  game: '#6aa0d8',
};

const SWITCH_KEY = 'magic-book.logs';

function enabled(): boolean {
  try {
    return localStorage.getItem(SWITCH_KEY) !== 'off';
  } catch {
    return true;
  }
}

function badge(source: LogSource): [string, string] {
  return [
    `%c ${source} `,
    `background:${COLORS[source]};color:#14101c;border-radius:3px;font-weight:600`,
  ];
}

export const log = {
  /** One line, for things that need no opening. */
  info(source: LogSource, title: string, ...details: unknown[]): void {
    if (!enabled()) {
      return;
    }
    const [label, style] = badge(source);
    console.log(`${label} ${title}`, style, ...details);
  },

  /** Something that worked, but not as it should — a cut-off answer, a fallback. */
  warn(source: LogSource, title: string, ...details: unknown[]): void {
    if (!enabled()) {
      return;
    }
    const [label, style] = badge(source);
    console.warn(`${label} ${title}`, style, ...details);
  },

  /** Printed even when the logs are off: a failure is never noise. */
  error(source: LogSource, title: string, cause: unknown, ...details: unknown[]): void {
    const [label, style] = badge(source);
    console.error(`${label} ${title}`, style, cause, ...details);
  },

  /**
   * A collapsed group: the headline shows the gist, the body the evidence.
   * The body runs even if it throws, and the group is always closed.
   */
  group(source: LogSource, title: string, body: () => void, open = false): void {
    if (!enabled()) {
      return;
    }
    const [label, style] = badge(source);
    (open ? console.group : console.groupCollapsed)(`${label} ${title}`, style);
    try {
      body();
    } finally {
      console.groupEnd();
    }
  },
};

/** Milliseconds since `start`, as "1.84 s" or "312 ms". */
export function elapsed(start: number): string {
  const ms = performance.now() - start;
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

/** Prints once, at start-up, how to read and silence the narration. */
export function announceLogs(): void {
  if (!enabled()) {
    return;
  }
  console.log(
    '%c The Magic Book %c every model call is logged below, grouped and colour-coded. ' +
      "Silence with localStorage.setItem('magic-book.logs', 'off').",
    'background:#f2c55c;color:#2a1f05;border-radius:3px;font-weight:700;padding:2px 6px',
    'color:inherit',
  );
}
