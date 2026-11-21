import { describe, expect, it } from 'vitest';
import { Rating } from 'ts-fsrs';
import { answer, cardId, dueCards, grade, learnOrder, makeScheduler, newQueue, pickLearnWords, type CardMap } from './srs';
import { parseVocab, wordsInLessons, japanese } from './vocab';

const TSV = [
  'lesson\tsection\tkana\tkanji\tenglish\tdialogue\tadditional',
  '1\tSchool\tだいがく\t\tcollege; university\t*\t',
  '1\tMajors\tけいざい\t\teconomics\t\tx',
  '2\tMajors\tけいざい\t\teconomics\t\t',
  '4\tRu-verb\tいる\t\t(a person) is in . . .\t*\t',
  '8\tU-verbs\tいる\t\tto need (～が)\t*\t',
  '3\tTime\tきょう\t今日\ttoday\t*\t',
].join('\n');

describe('vocab', () => {
  const words = parseVocab(TSV);
  it('merges words that appear in several lessons', () => {
    const k = words.find((w) => w.kana === 'けいざい')!;
    expect(k.occurrences.map((o) => o.lesson)).toEqual([1, 2]);
  });
  it('keeps same kana with different meanings apart', () => {
    expect(words.filter((w) => w.kana === 'いる')).toHaveLength(2);
    expect(new Set(words.map((w) => w.id)).size).toBe(words.length);
  });
  it('filters additional vocabulary', () => {
    expect(wordsInLessons(words, [1], false).map((w) => w.kana)).toEqual(['だいがく']);
    expect(wordsInLessons(words, [1], true)).toHaveLength(2);
  });
  it('shows kanji with kana in parentheses', () => {
    expect(japanese(words.find((w) => w.kana === 'きょう')!)).toBe('今日 (きょう)');
    expect(japanese(words[0])).toBe('だいがく');
  });
});

describe('learn queue', () => {
  it("Didn't know comes back after 3 cards, Hard after 6", () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    let q = answer(newQueue('learn', ids), Rating.Again);
    expect(q.items.map((i) => i.id).indexOf('a')).toBe(3);
    q = answer(newQueue('learn', ids), Rating.Hard);
    expect(q.items.map((i) => i.id).indexOf('a')).toBe(6);
  });
  it('Medium goes to the end once, then is done; Easy is done at once', () => {
    let q = newQueue('learn', ['a', 'b']);
    q = answer(q, Rating.Good); // a -> end
    expect(q.items.map((i) => i.id)).toEqual(['b', 'a']);
    q = answer(q, Rating.Easy); // b done
    expect(q.done).toBe(1);
    q = answer(q, Rating.Good); // a second Medium -> done
    expect(q.items).toHaveLength(0);
    expect(q.done).toBe(2);
  });
  it('always terminates when answering Medium', () => {
    let q = newQueue('learn', ['a', 'b', 'c']);
    let n = 0;
    while (q.items.length && n++ < 100) q = answer(q, Rating.Good);
    expect(n).toBe(6);
  });
});

describe('review queue', () => {
  it('only repeats cards answered "Didn\'t know"', () => {
    let q = newQueue('review', ['a', 'b']);
    q = answer(q, Rating.Hard);
    expect(q.done).toBe(1);
    q = answer(q, Rating.Again);
    expect(q.items.map((i) => i.id)).toEqual(['b']);
  });
});

describe('scheduling', () => {
  const words = parseVocab(TSV);
  const f = makeScheduler(0.9);
  const t0 = new Date('2026-01-01T10:00:00Z');

  it('picks weak words first, then new words', () => {
    const pool = wordsInLessons(words, [1, 2, 3, 4, 8], true);
    let cards: CardMap = {};
    const w = pool[3]; // a word late in book order
    cards[cardId(w.id, 'je')] = grade(f, cards, cardId(w.id, 'je'), Rating.Again, t0);
    const picked = pickLearnWords(f, cards, pool, 'je', 2, t0);
    expect(picked[0].id).toBe(w.id);
    expect(picked[1].id).toBe(pool[0].id);
  });

  it('easy cards are due later than hard ones', () => {
    let cards: CardMap = {};
    const [a, b] = words;
    for (const [w, r] of [[a, Rating.Easy], [b, Rating.Hard]] as const) {
      const id = cardId(w.id, 'je');
      cards = { ...cards, [id]: grade(f, cards, id, r, t0) };
    }
    expect(cards[cardId(a.id, 'je')].card.due.getTime()).toBeGreaterThan(cards[cardId(b.id, 'je')].card.due.getTime());
    const in30 = new Date(t0.getTime() + 30 * 864e5);
    expect(dueCards(f, cards, words, 'both', in30)).toHaveLength(2);
    expect(dueCards(f, cards, words, 'both', t0)).toHaveLength(0);
  });

  it('puts the second direction of a word in the second half', () => {
    const order = learnOrder(words.slice(0, 3), 'both');
    expect(order.slice(0, 3).every((id) => id.startsWith('je:'))).toBe(true);
    expect(order.slice(3).every((id) => id.startsWith('ej:'))).toBe(true);
  });
});
