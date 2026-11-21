import { createEmptyCard, fsrs, Rating, State, type Card, type FSRS, type Grade } from 'ts-fsrs';
import type { Word } from './vocab';

/** je = Japanese → English (recognition), ej = English → Japanese (production). */
export type Dir = 'je' | 'ej';
export type DirChoice = Dir | 'both';

export interface CardRecord {
  card: Card;
  lastRating?: Grade;
}
export type CardMap = Record<string, CardRecord>;

export const cardId = (wordId: string, dir: Dir) => `${dir}:${wordId}`;
export const dirsOf = (d: DirChoice): Dir[] => (d === 'both' ? ['je', 'ej'] : [d]);

export function makeScheduler(retention: number): FSRS {
  return fsrs({ request_retention: retention, enable_fuzz: true, enable_short_term: true });
}

export function getRecord(cards: CardMap, id: string, now = new Date()): CardRecord {
  return cards[id] ?? { card: createEmptyCard(now) };
}

export const isNew = (r: CardRecord) => r.card.state === State.New;

/** Probability (0–1) that the card is remembered right now. New cards count as 0. */
export function recall(f: FSRS, r: CardRecord, now = new Date()): number {
  if (isNew(r)) return 0;
  return f.get_retrievability(r.card, now, false);
}

export function grade(f: FSRS, cards: CardMap, id: string, rating: Grade, now = new Date()): CardRecord {
  const next = f.next(getRecord(cards, id, now).card, now, rating);
  return { card: next.card, lastRating: rating };
}

/** A word is "weak" if it was last answered wrong/hard or is likely to be forgotten. */
function isWeak(f: FSRS, r: CardRecord, now: Date): boolean {
  if (isNew(r)) return false;
  return r.lastRating === Rating.Again || r.lastRating === Rating.Hard || recall(f, r, now) < 0.85;
}

/**
 * Learn mode: pick `count` words from a chapter.
 * Weak words first (lowest recall first), then new words in book order, then known words (lowest recall first).
 */
export function pickLearnWords(
  f: FSRS, cards: CardMap, words: Word[], dir: DirChoice, count: number, now = new Date(),
): Word[] {
  const scored = words.map((w, order) => {
    const recs = dirsOf(dir).map((d) => getRecord(cards, cardId(w.id, d), now));
    const weak = recs.some((r) => isWeak(f, r, now));
    const anyNew = recs.some(isNew);
    const bucket = weak ? 0 : anyNew ? 1 : 2;
    const minRecall = Math.min(...recs.map((r) => (isNew(r) ? 1 : recall(f, r, now))));
    return { w, bucket, key: bucket === 1 ? order : minRecall };
  });
  scored.sort((a, b) => a.bucket - b.bucket || a.key - b.key);
  return scored.slice(0, count).map((s) => s.w);
}

/** Review mode: cards that are due, the ones most likely to be forgotten first. */
export function dueCards(
  f: FSRS, cards: CardMap, words: Word[], dir: DirChoice, now = new Date(),
): string[] {
  const due: { id: string; r: number }[] = [];
  for (const w of words) {
    for (const d of dirsOf(dir)) {
      const id = cardId(w.id, d);
      const rec = cards[id];
      if (rec && !isNew(rec) && rec.card.due.getTime() <= now.getTime()) {
        due.push({ id, r: recall(f, rec, now) });
      }
    }
  }
  return due.sort((a, b) => a.r - b.r).map((d) => d.id);
}

export function shuffle<T>(arr: T[], rand = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Card order for a learn session; with both directions, a word's second card comes in the second half. */
export function learnOrder(words: Word[], dir: DirChoice, rand = Math.random): string[] {
  return dirsOf(dir).flatMap((d) => shuffle(words, rand).map((w) => cardId(w.id, d)));
}

// ---------- In-session queue ----------

export type Mode = 'learn' | 'review';

export interface QueueItem {
  id: string;
  /** Number of "Medium" answers in this session (learn mode). */
  good: number;
}

export interface Queue {
  mode: Mode;
  items: QueueItem[];
  total: number;
  done: number;
}

export function newQueue(mode: Mode, ids: string[]): Queue {
  return { mode, items: ids.map((id) => ({ id, good: 0 })), total: ids.length, done: 0 };
}

/** How many cards later a card comes back. */
export const AGAIN_GAP = 3;
export const HARD_GAP = 6;

/**
 * Apply an answer to the first card in the queue.
 * Learn: Didn't know → back in 3 cards, Hard → back in 6, Medium → once more at the end
 *   (done after the second Medium), Easy → done.
 * Review: Didn't know → back in 3 cards, everything else → done.
 */
export function answer(q: Queue, rating: Grade): Queue {
  const [cur, ...rest] = q.items;
  if (!cur) return q;
  const insertAt = (item: QueueItem, gap: number) => {
    const items = [...rest];
    items.splice(Math.min(gap, items.length), 0, item);
    return { ...q, items };
  };
  if (rating === Rating.Again) return insertAt({ ...cur, good: 0 }, AGAIN_GAP);
  if (q.mode === 'review' || rating === Rating.Easy) return { ...q, items: rest, done: q.done + 1 };
  if (rating === Rating.Hard) return insertAt(cur, HARD_GAP);
  // Medium
  if (cur.good >= 1) return { ...q, items: rest, done: q.done + 1 };
  return { ...q, items: [...rest, { ...cur, good: cur.good + 1 }] };
}
