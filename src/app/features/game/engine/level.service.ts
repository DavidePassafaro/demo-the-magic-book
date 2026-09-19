import { Service } from '@angular/core';
import {
  parseLevel,
  parseLevelIndex,
  type Level,
  type LevelSummary,
} from '@features/game/engine/model/level';

function assetUrl(path: string): string {
  return new URL(path, document.baseURI).toString();
}

/** Reads levels from `public/levels/` at runtime, so new ones need no rebuild. */
@Service()
export class LevelService {
  private async readIndex(): Promise<LevelSummary[]> {
    const response = await fetch(assetUrl('levels/index.json'));
    if (!response.ok) {
      throw new Error(`Could not read the level index (${response.status})`);
    }
    return parseLevelIndex(await response.json());
  }

  /** Only the levels currently switched on. */
  async listLevels(): Promise<LevelSummary[]> {
    return (await this.readIndex()).filter((level) => level.enabled);
  }

  async loadLevel(id: string): Promise<Level> {
    const summary = (await this.readIndex()).find((level) => level.id === id);

    if (!summary) {
      throw new Error(`There is no level called "${id}"`);
    }

    if (!summary.enabled) {
      throw new Error(`The level "${id}" is switched off in levels/index.json`);
    }

    const response = await fetch(assetUrl(`levels/${summary.file}`));
    if (!response.ok) {
      throw new Error(`Could not read ${summary.file} (${response.status})`);
    }
    return parseLevel(await response.json());
  }
}
