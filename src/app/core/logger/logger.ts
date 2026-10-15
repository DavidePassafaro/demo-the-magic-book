/**
 * Console narration, one colour per source. Every model call is one collapsed group.
 * Silence it with `localStorage.setItem('magic-book.logs', 'off')`; errors always print.
 */
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
  info(source: LogSource, title: string, ...details: unknown[]): void {
    if (!enabled()) {
      return;
    }
    const [label, style] = badge(source);
    console.log(`${label} ${title}`, style, ...details);
  },

  warn(source: LogSource, title: string, ...details: unknown[]): void {
    if (!enabled()) {
      return;
    }
    const [label, style] = badge(source);
    console.warn(`${label} ${title}`, style, ...details);
  },

  /** Printed even when the logs are off. */
  error(source: LogSource, title: string, cause: unknown, ...details: unknown[]): void {
    const [label, style] = badge(source);
    console.error(`${label} ${title}`, style, cause, ...details);
  },

  /** A collapsed group: the headline shows the gist, the body the details. */
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
