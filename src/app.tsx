import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Rating, type Grade } from 'ts-fsrs';
import {
  answer, cardId, dirsOf, dueCards, getRecord, grade, isNew, learnOrder, makeScheduler, newQueue,
  pickLearnWords, type CardMap, type DirChoice, type Queue,
} from './srs';
import {
  hasAdditional, japanese, lessonName, lessonsOf, parseVocab, wordsInLessons, type Word,
} from './vocab';
import {
  loadCards, loadImportedVocab, loadLog, loadSettings, makeBackup, parseBackup, requestPersistence,
  resetProgress, saveCards, saveImportedVocab, saveLog, saveSettings, type LogEntry, type Settings,
} from './storage';

type Screen =
  | { name: 'home' }
  | { name: 'learnSetup' }
  | { name: 'reviewSetup' }
  | { name: 'session'; queue: Queue; tally: Record<Grade, number> }
  | { name: 'done'; mode: 'learn' | 'review'; tally: Record<Grade, number>; cards: number }
  | { name: 'settings' };

const GRADES: { g: Grade; label: string; cls: string }[] = [
  { g: Rating.Again, label: "Didn't know", cls: 'again' },
  { g: Rating.Hard, label: 'Hard', cls: 'hard' },
  { g: Rating.Good, label: 'Medium', cls: 'good' },
  { g: Rating.Easy, label: 'Easy', cls: 'easy' },
];
const emptyTally = (): Record<Grade, number> => ({ 1: 0, 2: 0, 3: 0, 4: 0 });

const DIRS: { v: DirChoice; label: string }[] = [
  { v: 'je', label: 'JP → EN' },
  { v: 'ej', label: 'EN → JP' },
  { v: 'both', label: 'Both' },
];

export function App() {
  const [words, setWords] = useState<Word[] | null>(null);
  const [vocabError, setVocabError] = useState<string | null>(null);
  const [cards, setCards] = useState<CardMap>({});
  const [log, setLog] = useState<LogEntry[]>([]);
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'home' });

  useEffect(() => {
    (async () => {
      const [c, l, s] = await Promise.all([loadCards(), loadLog(), loadSettings()]);
      setCards(c);
      setLog(l);
      setSettingsState(s);
      requestPersistence();
      try {
        setWords(await loadVocab());
      } catch (e) {
        setVocabError((e as Error).message);
      }
    })();
  }, []);

  const f = useMemo(() => makeScheduler(settings?.retention ?? 0.9), [settings?.retention]);
  const wordById = useMemo(() => new Map((words ?? []).map((w) => [w.id, w])), [words]);

  const setSettings = (patch: Partial<Settings>) => {
    setSettingsState((s) => {
      const next = { ...s!, ...patch };
      saveSettings(next);
      return next;
    });
  };

  if (!settings) return <div class="page" />;
  if (!words) {
    return (
      <ImportVocab
        error={vocabError}
        onImported={(w) => {
          setWords(w);
          setVocabError(null);
        }}
      />
    );
  }

  const go = (s: Screen) => {
    setScreen(s);
    window.scrollTo(0, 0);
  };

  const onGrade = (rating: Grade) => {
    if (screen.name !== 'session') return;
    const id = screen.queue.items[0].id;
    const now = new Date();
    const nextCards = { ...cards, [id]: grade(f, cards, id, rating, now) };
    const nextLog: LogEntry[] = [...log, [id, rating, now.getTime()]];
    setCards(nextCards);
    setLog(nextLog);
    saveCards(nextCards);
    saveLog(nextLog);
    const tally = { ...screen.tally, [rating]: screen.tally[rating] + 1 };
    const queue = answer(screen.queue, rating);
    if (queue.items.length === 0) go({ name: 'done', mode: queue.mode, tally, cards: queue.total });
    else setScreen({ name: 'session', queue, tally });
  };

  const allDue = dueCards(f, cards, words, 'both');

  switch (screen.name) {
    case 'home':
      return <Home words={words} cards={cards} dueCount={allDue.length} go={go} />;
    case 'learnSetup':
      return (
        <LearnSetup
          words={words}
          settings={settings}
          setSettings={setSettings}
          onBack={() => go({ name: 'home' })}
          onStart={() => {
            const pool = wordsInLessons(words, [settings.learnLesson], settings.includeAdditional);
            const picked = pickLearnWords(f, cards, pool, settings.learnDir, settings.learnCount);
            go({ name: 'session', queue: newQueue('learn', learnOrder(picked, settings.learnDir)), tally: emptyTally() });
          }}
        />
      );
    case 'reviewSetup':
      return (
        <ReviewSetup
          words={words}
          settings={settings}
          setSettings={setSettings}
          dueFor={(lessons, dir) => dueCards(f, cards, wordsInLessons(words, lessons, true), dir)}
          onBack={() => go({ name: 'home' })}
          onStart={(ids) => go({ name: 'session', queue: newQueue('review', ids), tally: emptyTally() })}
        />
      );
    case 'session': {
      const id = screen.queue.items[0].id;
      const [dir, ...rest] = id.split(':');
      const word = wordById.get(rest.join(':'))!;
      return (
        <Session
          key={`${screen.queue.done}-${screen.queue.items.length}-${id}`}
          queue={screen.queue}
          word={word}
          dir={dir as 'je' | 'ej'}
          isNewCard={isNew(getRecord(cards, id))}
          preview={
            screen.queue.mode === 'review'
              ? (g: Grade) => formatInterval(f.next(getRecord(cards, id).card, new Date(), g).card.due)
              : undefined
          }
          onGrade={onGrade}
          onQuit={() => go({ name: 'home' })}
        />
      );
    }
    case 'done':
      return <Done screen={screen} dueCount={allDue.length} go={go} />;
    case 'settings':
      return (
        <SettingsScreen
          settings={settings}
          setSettings={setSettings}
          cards={cards}
          log={log}
          onRestore={(b) => {
            setCards(b.cards);
            setLog(b.log);
            saveCards(b.cards);
            saveLog(b.log);
            setSettings(b.settings);
          }}
          onReset={async () => {
            await resetProgress();
            setCards({});
            setLog([]);
          }}
          onVocab={(w) => setWords(w)}
          onBack={() => go({ name: 'home' })}
        />
      );
  }
}

async function loadVocab(): Promise<Word[]> {
  try {
    const res = await fetch('./vocab.tsv', { cache: 'no-cache' });
    if (res.ok) {
      const text = await res.text();
      if (text.startsWith('lesson')) return parseVocab(text);
    }
  } catch {
    /* offline and not cached: fall back to imported list */
  }
  const imported = await loadImportedVocab();
  if (imported) return parseVocab(imported);
  throw new Error('No word list found.');
}

function formatInterval(due: Date): string {
  const mins = Math.max(1, Math.round((due.getTime() - Date.now()) / 60000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days} d`;
  const months = days / 30.4;
  if (months < 12) return `${Math.round(months)} mo`;
  return `${(days / 365).toFixed(1)} y`;
}

// ---------- Screens ----------

function Header(props: { title: string; onBack?: () => void; right?: ComponentChildren }) {
  return (
    <header class="header">
      {props.onBack ? (
        <button class="icon-btn" onClick={props.onBack} aria-label="Back">
          ‹
        </button>
      ) : (
        <span class="icon-btn-spacer" />
      )}
      <h1>{props.title}</h1>
      {props.right ?? <span class="icon-btn-spacer" />}
    </header>
  );
}

function Home(props: { words: Word[]; cards: CardMap; dueCount: number; go: (s: Screen) => void }) {
  const { words, cards, dueCount, go } = props;
  const lessons = lessonsOf(words);
  return (
    <div class="page">
      <Header
        title="Genki Vocab"
        right={
          <button class="icon-btn" onClick={() => go({ name: 'settings' })} aria-label="Settings">
            ⚙︎
          </button>
        }
      />
      <section class="hero">
        <div class="hero-num">{dueCount}</div>
        <div class="hero-label">{dueCount === 1 ? 'card to review' : 'cards to review'}</div>
        <button class="btn primary" disabled={dueCount === 0} onClick={() => go({ name: 'reviewSetup' })}>
          Review
        </button>
        <button class="btn" onClick={() => go({ name: 'learnSetup' })}>
          Learn a chapter
        </button>
      </section>
      <h2 class="section-title">Progress</h2>
      <ul class="progress-list">
        {lessons.map((l) => {
          const ws = wordsInLessons(words, [l], false);
          const started = ws.filter((w) => dirsOf('both').some((d) => cards[cardId(w.id, d)])).length;
          const pct = ws.length ? Math.round((started / ws.length) * 100) : 0;
          return (
            <li key={l}>
              <span class="pl-name">{lessonName(l)}</span>
              <span class="bar">
                <span style={{ width: `${pct}%` }} />
              </span>
              <span class="pl-count">
                {started}/{ws.length}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Segmented<T extends string | number>(props: {
  options: { v: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div class="segmented" role="radiogroup">
      {props.options.map((o) => (
        <button
          key={o.v}
          role="radio"
          aria-checked={o.v === props.value}
          class={o.v === props.value ? 'on' : ''}
          onClick={() => props.onChange(o.v)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function CountPicker(props: { value: number; options: number[]; max: number; onChange: (v: number) => void }) {
  const opts = props.options.filter((n) => n < props.max);
  return (
    <div class="chips">
      {opts.map((n) => (
        <button key={n} class={props.value === n ? 'chip on' : 'chip'} onClick={() => props.onChange(n)}>
          {n}
        </button>
      ))}
      <button
        class={props.value >= props.max ? 'chip on' : 'chip'}
        onClick={() => props.onChange(9999)}
      >
        All ({props.max})
      </button>
    </div>
  );
}

function LearnSetup(props: {
  words: Word[];
  settings: Settings;
  setSettings: (p: Partial<Settings>) => void;
  onBack: () => void;
  onStart: () => void;
}) {
  const { words, settings: s, setSettings } = props;
  const lessons = lessonsOf(words);
  const lesson = lessons.includes(s.learnLesson) ? s.learnLesson : lessons[0];
  const pool = wordsInLessons(words, [lesson], s.includeAdditional);
  return (
    <div class="page">
      <Header title="Learn a chapter" onBack={props.onBack} />
      <label class="field-label">Chapter</label>
      <div class="chips">
        {lessons.map((l) => (
          <button key={l} class={l === lesson ? 'chip on' : 'chip'} onClick={() => setSettings({ learnLesson: l })}>
            {l === 0 ? 'Greetings' : l}
          </button>
        ))}
      </div>
      {hasAdditional(words, lesson) && (
        <label class="toggle">
          <input
            type="checkbox"
            checked={s.includeAdditional}
            onChange={(e) => setSettings({ includeAdditional: (e.target as HTMLInputElement).checked })}
          />
          Include "Additional Vocabulary"
        </label>
      )}
      <label class="field-label">Direction</label>
      <Segmented options={DIRS} value={s.learnDir} onChange={(v) => setSettings({ learnDir: v })} />
      <label class="field-label">Number of words</label>
      <CountPicker
        value={Math.min(s.learnCount, pool.length)}
        options={[5, 10, 15, 20, 30]}
        max={pool.length}
        onChange={(v) => setSettings({ learnCount: v })}
      />
      <p class="hint">
        Words you found hard or forgot come first, then new words, then words you already know.
        {s.learnDir === 'both' && ' Each word is asked in both directions.'}
      </p>
      <button class="btn primary sticky" disabled={pool.length === 0} onClick={props.onStart}>
        Start
      </button>
    </div>
  );
}

function ReviewSetup(props: {
  words: Word[];
  settings: Settings;
  setSettings: (p: Partial<Settings>) => void;
  dueFor: (lessons: number[], dir: DirChoice) => string[];
  onBack: () => void;
  onStart: (ids: string[]) => void;
}) {
  const { words, settings: s, setSettings, dueFor } = props;
  const lessons = lessonsOf(words);
  const selected = s.reviewLessons ?? lessons;
  const toggle = (l: number) => {
    const next = selected.includes(l) ? selected.filter((x) => x !== l) : [...selected, l].sort((a, b) => a - b);
    setSettings({ reviewLessons: next.length === lessons.length ? null : next });
  };
  const due = dueFor(selected, s.reviewDir);
  return (
    <div class="page">
      <Header title="Review" onBack={props.onBack} />
      <label class="field-label">
        Chapters
        <button class="link" onClick={() => setSettings({ reviewLessons: s.reviewLessons ? null : [] })}>
          {s.reviewLessons ? 'Select all' : 'Clear'}
        </button>
      </label>
      <div class="chips">
        {lessons.map((l) => {
          const n = dueFor([l], s.reviewDir).length;
          return (
            <button key={l} class={selected.includes(l) ? 'chip on' : 'chip'} onClick={() => toggle(l)}>
              {l === 0 ? 'Greetings' : l}
              {n > 0 && <span class="badge">{n}</span>}
            </button>
          );
        })}
      </div>
      <label class="field-label">Direction</label>
      <Segmented options={DIRS} value={s.reviewDir} onChange={(v) => setSettings({ reviewDir: v })} />
      <label class="field-label">Max number of cards</label>
      {due.length > 0 ? (
        <CountPicker
          value={Math.min(s.reviewCount, due.length)}
          options={[10, 20, 30, 50]}
          max={due.length}
          onChange={(v) => setSettings({ reviewCount: v })}
        />
      ) : (
        <p class="hint">Nothing is due in these chapters right now. 🎉</p>
      )}
      <p class="hint">
        Cards are scheduled with FSRS so you see each word just before you are likely to forget it. The cards you are
        most likely to have forgotten come first.
      </p>
      <button
        class="btn primary sticky"
        disabled={due.length === 0}
        onClick={() => props.onStart(due.slice(0, s.reviewCount))}
      >
        Start ({Math.min(s.reviewCount, due.length)})
      </button>
    </div>
  );
}

function Session(props: {
  queue: Queue;
  word: Word;
  dir: 'je' | 'ej';
  isNewCard: boolean;
  preview?: (g: Grade) => string;
  onGrade: (g: Grade) => void;
  onQuit: () => void;
}) {
  const { queue, word, dir } = props;
  const [shown, setShown] = useState(false);
  const busy = useRef(false);
  const jp = japanese(word);
  const front = dir === 'je' ? jp : word.english;
  const back = dir === 'je' ? word.english : jp;
  const pct = Math.round((queue.done / queue.total) * 100);
  const lesson = word.occurrences.map((o) => lessonName(o.lesson)).filter((v, i, a) => a.indexOf(v) === i).join(', ');

  const rate = (g: Grade) => {
    if (busy.current) return;
    busy.current = true;
    props.onGrade(g);
  };

  return (
    <div class="page session">
      <header class="header">
        <button class="icon-btn" onClick={props.onQuit} aria-label="Quit">
          ✕
        </button>
        <span class="bar session-bar">
          <span style={{ width: `${pct}%` }} />
        </span>
        <span class="session-count">
          {queue.done}/{queue.total}
        </span>
      </header>
      <div class="card" onClick={() => setShown(true)}>
        <div class="card-meta">
          {dir === 'je' ? 'Japanese → English' : 'English → Japanese'} · {lesson}
          {props.isNewCard && <span class="new-tag">new</span>}
        </div>
        <div class={dir === 'je' ? 'card-front jp' : 'card-front'}>{front}</div>
        {shown ? (
          <>
            <hr />
            <div class={dir === 'je' ? 'card-back' : 'card-back jp'}>{back}</div>
          </>
        ) : (
          <div class="tap-hint">Tap to show answer</div>
        )}
      </div>
      <div class="grades">
        {shown ? (
          GRADES.map(({ g, label, cls }) => (
            <button key={g} class={`grade ${cls}`} onClick={() => rate(g)}>
              <span>{label}</span>
              {props.preview && <small>{props.preview(g)}</small>}
            </button>
          ))
        ) : (
          <button class="btn primary show" onClick={() => setShown(true)}>
            Show answer
          </button>
        )}
      </div>
    </div>
  );
}

function Done(props: {
  screen: Extract<Screen, { name: 'done' }>;
  dueCount: number;
  go: (s: Screen) => void;
}) {
  const { tally, cards, mode } = props.screen;
  const answers = tally[1] + tally[2] + tally[3] + tally[4];
  return (
    <div class="page">
      <Header title="Session complete" />
      <section class="hero">
        <div class="hero-num">{cards}</div>
        <div class="hero-label">
          cards {mode === 'learn' ? 'practised' : 'reviewed'} · {answers} answers
        </div>
      </section>
      <ul class="tally">
        {GRADES.map(({ g, label, cls }) => (
          <li key={g} class={cls}>
            <span>{label}</span>
            <b>{tally[g]}</b>
          </li>
        ))}
      </ul>
      {mode === 'learn' && (
        <p class="hint">These words are now in your review schedule and will come back when it's time.</p>
      )}
      <button class="btn primary" onClick={() => props.go({ name: 'home' })}>
        Home
      </button>
      {props.dueCount > 0 && (
        <button class="btn" onClick={() => props.go({ name: 'reviewSetup' })}>
          Review ({props.dueCount} due)
        </button>
      )}
    </div>
  );
}

function ImportVocab(props: { error: string | null; onImported: (w: Word[]) => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div class="page">
      <Header title="Genki Vocab" />
      <section class="hero">
        <p>
          This app needs a word list. Choose the <code>vocab.tsv</code> file to import it. It is stored only on this
          device.
        </p>
        <FileButton
          label="Import word list"
          accept=".tsv,.txt,text/tab-separated-values,text/plain"
          onText={async (text) => {
            try {
              const w = parseVocab(text);
              await saveImportedVocab(text);
              props.onImported(w);
            } catch (e) {
              setMsg((e as Error).message);
            }
          }}
        />
        {(msg ?? props.error) && <p class="error">{msg ?? props.error}</p>}
      </section>
    </div>
  );
}

function FileButton(props: { label: string; accept: string; onText: (t: string) => void; primary?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button class={props.primary === false ? 'btn' : 'btn primary'} onClick={() => input.current?.click()}>
        {props.label}
      </button>
      <input
        ref={input}
        type="file"
        accept={props.accept}
        hidden
        onChange={async (e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (file) props.onText(await file.text());
          (e.target as HTMLInputElement).value = '';
        }}
      />
    </>
  );
}

async function shareOrDownload(text: string, filename: string) {
  const file = new File([text], filename, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SettingsScreen(props: {
  settings: Settings;
  setSettings: (p: Partial<Settings>) => void;
  cards: CardMap;
  log: LogEntry[];
  onRestore: (b: ReturnType<typeof parseBackup>) => void;
  onReset: () => void;
  onVocab: (w: Word[]) => void;
  onBack: () => void;
}) {
  const { settings: s, setSettings } = props;
  const [msg, setMsg] = useState<string | null>(null);
  const today = new Date().toDateString();
  const todayCount = props.log.filter((e) => new Date(e[2]).toDateString() === today).length;
  return (
    <div class="page">
      <Header title="Settings" onBack={props.onBack} />
      <label class="field-label">Target retention: {Math.round(s.retention * 100)}%</label>
      <input
        type="range"
        min={0.8}
        max={0.95}
        step={0.01}
        value={s.retention}
        onInput={(e) => setSettings({ retention: Number((e.target as HTMLInputElement).value) })}
      />
      <p class="hint">
        How sure you want to be of remembering a word when it comes up for review. Higher means more reviews. 90% is a
        good default.
      </p>

      <h2 class="section-title">Statistics</h2>
      <ul class="stats">
        <li>
          <span>Cards started</span>
          <b>{Object.keys(props.cards).length}</b>
        </li>
        <li>
          <span>Answers today</span>
          <b>{todayCount}</b>
        </li>
        <li>
          <span>Answers in total</span>
          <b>{props.log.length}</b>
        </li>
      </ul>

      <h2 class="section-title">Backup</h2>
      <p class="hint">Your progress is stored only on this device. Export a backup now and then.</p>
      <button
        class="btn"
        onClick={() =>
          shareOrDownload(
            makeBackup(props.cards, props.log, s),
            `genki-vocab-backup-${new Date().toISOString().slice(0, 10)}.json`,
          )
        }
      >
        Export backup
      </button>
      <FileButton
        label="Restore backup"
        primary={false}
        accept=".json,application/json"
        onText={(t) => {
          try {
            const b = parseBackup(t);
            if (confirm('Replace your current progress with this backup?')) {
              props.onRestore(b);
              setMsg('Backup restored.');
            }
          } catch (e) {
            setMsg((e as Error).message);
          }
        }}
      />

      <h2 class="section-title">Word list</h2>
      <p class="hint">Only used when the app has no built-in word list.</p>
      <FileButton
        label="Import word list"
        primary={false}
        accept=".tsv,.txt,text/tab-separated-values,text/plain"
        onText={async (t) => {
          try {
            const w = parseVocab(t);
            await saveImportedVocab(t);
            props.onVocab(w);
            setMsg(`Imported ${w.length} words.`);
          } catch (e) {
            setMsg((e as Error).message);
          }
        }}
      />

      <h2 class="section-title">Danger zone</h2>
      <button
        class="btn danger"
        onClick={() => {
          if (confirm('Delete all progress? This cannot be undone.')) {
            props.onReset();
            setMsg('Progress deleted.');
          }
        }}
      >
        Reset all progress
      </button>
      {msg && <p class="hint">{msg}</p>}
      <p class="version">Version 0.1</p>
    </div>
  );
}
