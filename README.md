# Genki Vocab

A flashcard app (PWA for iPhone) for the vocabulary in the textbook *Genki I* (3rd edition), lessons 1–12.

## Two modes

- **Learn a chapter** – pick a chapter, a direction (JP → EN, EN → JP or both) and a number of words.
  Words you found hard or forgot come first, then new words. In the session, *Didn't know* brings the card
  back after 3 cards, *Hard* after 6, *Medium* once more at the end, and *Easy* finishes it.
- **Review** – pick the chapters to include. Cards are scheduled with [FSRS](https://github.com/open-spaced-repetition/ts-fsrs)
  (Free Spaced Repetition Scheduler), and the cards most likely to be forgotten come first.

Each word has two cards (one per direction), each with its own schedule. Everything you learn in
"Learn a chapter" goes into the review schedule.

## Word list

The word list (`public/vocab.tsv`) comes from the textbook and is **not** in this repository while it is public
(see `.gitignore`). Without it, the app asks you to import the file on the phone.
Columns: `lesson, section, kana, kanji, english, dialogue, additional` (tab-separated, lesson 0 = Greetings).

## Development

```sh
npm install
npm run dev      # local server
npm test         # unit tests
npm run build    # production build in dist/
```

Progress is stored on the device (IndexedDB). Use *Settings → Export backup* now and then.
