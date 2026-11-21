export interface Occurrence {
  lesson: number;
  section: string;
  dialogue: boolean;
  additional: boolean;
}

export interface Word {
  /** Stable id used to store progress. Based on the Japanese, so fixing an English typo keeps progress. */
  id: string;
  kana: string;
  kanji: string;
  english: string;
  occurrences: Occurrence[];
}

const COLUMNS = ['lesson', 'section', 'kana', 'kanji', 'english', 'dialogue', 'additional'];

/** Parse the TSV word list. Words that appear in several lessons are merged into one word. */
export function parseVocab(tsv: string): Word[] {
  const lines = tsv.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) throw new Error('The word list is empty.');
  const header = lines[0].split('\t').map((h) => h.trim().toLowerCase());
  const idx = Object.fromEntries(COLUMNS.map((c) => [c, header.indexOf(c)]));
  for (const c of ['lesson', 'kana', 'english']) {
    if (idx[c] < 0) throw new Error(`The word list is missing the column "${c}".`);
  }
  const get = (cells: string[], c: string) => (idx[c] >= 0 ? (cells[idx[c]] ?? '').trim() : '');

  type Row = { kana: string; kanji: string; english: string; occ: Occurrence };
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split('\t');
    const lesson = Number(get(cells, 'lesson'));
    const kana = get(cells, 'kana');
    const english = get(cells, 'english');
    if (!Number.isInteger(lesson) || !kana || !english) {
      throw new Error(`Line ${i + 1} of the word list is incomplete.`);
    }
    rows.push({
      kana,
      kanji: get(cells, 'kanji'),
      english,
      occ: {
        lesson,
        section: get(cells, 'section'),
        dialogue: get(cells, 'dialogue') !== '',
        additional: get(cells, 'additional') !== '',
      },
    });
  }

  // Same Japanese with different meanings (e.g. いる "to be" / いる "to need") gets the English in its id.
  const meaningsByJp = new Map<string, Set<string>>();
  for (const r of rows) {
    const key = `${r.kana}|${r.kanji}`;
    if (!meaningsByJp.has(key)) meaningsByJp.set(key, new Set());
    meaningsByJp.get(key)!.add(r.english);
  }

  const words = new Map<string, Word>();
  for (const r of rows) {
    const jp = `${r.kana}|${r.kanji}`;
    const id = meaningsByJp.get(jp)!.size > 1 ? `${jp}|${r.english}` : jp;
    const existing = words.get(id);
    if (existing) existing.occurrences.push(r.occ);
    else words.set(id, { id, kana: r.kana, kanji: r.kanji, english: r.english, occurrences: [r.occ] });
  }
  return [...words.values()];
}

/** Japanese as shown on the cards: kanji with kana in parentheses, or just kana. */
export function japanese(w: Word): string {
  return w.kanji ? `${w.kanji} (${w.kana})` : w.kana;
}

export function lessonName(lesson: number): string {
  return lesson === 0 ? 'Greetings' : `Lesson ${lesson}`;
}

export function lessonsOf(words: Word[]): number[] {
  return [...new Set(words.flatMap((w) => w.occurrences.map((o) => o.lesson)))].sort((a, b) => a - b);
}

/** Words in the given lessons, in book order. */
export function wordsInLessons(words: Word[], lessons: number[], includeAdditional: boolean): Word[] {
  const set = new Set(lessons);
  return words.filter((w) =>
    w.occurrences.some((o) => set.has(o.lesson) && (includeAdditional || !o.additional)),
  );
}

export function hasAdditional(words: Word[], lesson: number): boolean {
  return words.some((w) => w.occurrences.some((o) => o.lesson === lesson && o.additional));
}
