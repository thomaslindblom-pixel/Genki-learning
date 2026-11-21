import { get, set, del } from 'idb-keyval';
import type { Grade } from 'ts-fsrs';
import type { CardMap } from './srs';

export interface Settings {
  retention: number;
  includeAdditional: boolean;
  learnLesson: number;
  learnCount: number;
  learnDir: 'je' | 'ej' | 'both';
  reviewLessons: number[] | null; // null = all
  reviewDir: 'je' | 'ej' | 'both';
  reviewCount: number;
}

export const defaultSettings: Settings = {
  retention: 0.9,
  includeAdditional: false,
  learnLesson: 1,
  learnCount: 10,
  learnDir: 'both',
  reviewLessons: null,
  reviewDir: 'both',
  reviewCount: 30,
};

/** One answer: card id, rating, time (ms). Kept for statistics and future tuning of FSRS. */
export type LogEntry = [string, Grade, number];

const K = { cards: 'cards', settings: 'settings', log: 'log', vocab: 'vocab' };

export async function loadCards(): Promise<CardMap> {
  return (await get<CardMap>(K.cards)) ?? {};
}
export const saveCards = (c: CardMap) => set(K.cards, c);

export async function loadSettings(): Promise<Settings> {
  return { ...defaultSettings, ...((await get<Partial<Settings>>(K.settings)) ?? {}) };
}
export const saveSettings = (s: Settings) => set(K.settings, s);

export async function loadLog(): Promise<LogEntry[]> {
  return (await get<LogEntry[]>(K.log)) ?? [];
}
export const saveLog = (l: LogEntry[]) => set(K.log, l);

/** Word list imported from a file on the phone (used when the app has no bundled list). */
export const loadImportedVocab = () => get<string>(K.vocab);
export const saveImportedVocab = (tsv: string) => set(K.vocab, tsv);

export async function resetProgress() {
  await Promise.all([del(K.cards), del(K.log)]);
}

/** Ask the browser not to evict our data (important on iOS). */
export async function requestPersistence() {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* not supported */
  }
}

// ---------- Backup ----------

interface Backup {
  app: 'genki-vocab';
  version: 1;
  exported: string;
  cards: CardMap;
  log: LogEntry[];
  settings: Settings;
}

export function makeBackup(cards: CardMap, log: LogEntry[], settings: Settings): string {
  const b: Backup = { app: 'genki-vocab', version: 1, exported: new Date().toISOString(), cards, log, settings };
  return JSON.stringify(b);
}

export function parseBackup(json: string): { cards: CardMap; log: LogEntry[]; settings: Settings } {
  const b = JSON.parse(json) as Backup;
  if (b.app !== 'genki-vocab' || typeof b.cards !== 'object') throw new Error('This is not a Genki Vocab backup file.');
  const cards: CardMap = {};
  for (const [id, rec] of Object.entries(b.cards)) {
    cards[id] = {
      ...rec,
      card: {
        ...rec.card,
        due: new Date(rec.card.due),
        last_review: rec.card.last_review ? new Date(rec.card.last_review) : undefined,
      },
    };
  }
  return { cards, log: b.log ?? [], settings: { ...defaultSettings, ...b.settings } };
}
