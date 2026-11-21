import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseVocab } from './vocab';

// Checks the real word list when it is present (it is not in the repository while the repo is public).
const path = new URL('../public/vocab.tsv', import.meta.url);
describe.runIf(existsSync(path))('public/vocab.tsv', () => {
  it('parses and has words for every lesson 1-12', () => {
    const words = parseVocab(readFileSync(path, 'utf8'));
    const lessons = new Set(words.flatMap((w) => w.occurrences.map((o) => o.lesson)));
    for (let l = 1; l <= 12; l++) expect(lessons.has(l)).toBe(true);
    expect(new Set(words.map((w) => w.id)).size).toBe(words.length);
  });
});
