# The Storywink voice

Every string a parent sees comes from one persona: **a kind children's librarian**. She knows the book will be wonderful, she never panics, she never talks about the computer, and she always knows the next step. Every example below is a real string from `apps/web/messages/` (befores are quoted from the pre-rewrite catalog).

Enforced mechanically by `npm run check-messages` (`scripts/check-messages.mjs`): en/ja key parity, no `{error}` interpolation, no standalone system words (error, failed, invalid, unauthorized), `…` instead of `...`.

## Rule 1 — Talk about the book, never the system

Banned in parent-facing copy: ID, URL, data, status, error, failed, invalid, unauthorized, generate/generation, content, timeout, flagged, and any enum value. The book, the story, the pages, the pictures, and the child's name are the only nouns that matter.

- Before: "Book ID not found in URL. Cannot load review data." (`review.bookIdNotFound`)
- After: "We couldn't find that book. Your library has everything you've made."
- Before: "Content flagged" (`review.contentFlagged`, moderation jargon on a child's page)
- After: "This page needs a different photo"

## Rule 2 — Reassure first, then give the one next step

Every failure message has exactly two jobs: say the child's book is safe, and name the single tap that fixes things. Never diagnose, never apologize twice, never offer two paths.

- Before: "Story generation failed. Please check the book status or try again." (`review.storyGenerationFailed` — two paths, one of them our enum vocabulary)
- After: "The story hit a snag. Let's try that again."
- Benchmark: `resolve.title` + `resolve.subtitle`: "Your book is almost ready!" / "Just 1 page needs a quick fix!" — leads with the good news, sizes the problem as small.

## Rule 3 — Raw error text goes to the log, never to the parent

`err.message` is for the logger, not for a toast. No `{error}` placeholder may exist in any message key.

- Before: "Error loading review data: {error}" (`review.errorLoadingReviewData` — parents saw raw server vocabulary)
- After: "We couldn't open your story. Try again in a moment."

## Rule 4 — Waiting is anticipation, not dead time

Waiting copy says what is being made right now, that leaving is safe, and one honest time expectation. The canonical number is **10-15 minutes for the full book, counted from the start** (`bookCard.usuallyTakes`, `landing.faq3A`). Mid-pipeline screens must not restate it as time remaining — let the progress bar carry it. Polling and refresh mechanics are our business, not the parent's.

- Before: "Loading review data..." (`review.loadingReviewData`)
- After: "Opening your story…"
- Benchmark: `progress.illustratingPage` "Illustrating page {current} of {total}" — concrete, moving, honest.

## Rule 5 — Keep the child in the sentence

Copy that names the child or their book always beats copy about the app. `book.childName` is available on every book-scoped screen; use it where it fits naturally, at most once per screen.

- Benchmark: `setup.childNameRequired` "Add a name so the story can star them."

## Rule 6 — Calm playfulness: small warm words, low punctuation pressure

"Snag", "hooray", "almost there" — yes. Exclamation marks: at most one per screen, only for genuinely good news. No "amazing/magical/beautiful" self-praise; the book earns the adjectives, we don't award them to ourselves. Sentence case for all buttons and headings ("Make my book", not "Illustrate Book"). One ellipsis character (…), never three dots.

- Before: "Illustrate Book" (`review.illustrateBook`)
- After: "Illustrate my book"

## Rule 7 — Promise only what the code does

Every number, every "we'll email you", every privacy claim must trace to a code path. If the code doesn't send it, the copy doesn't say it.

- Before: "Most storybooks are ready within minutes!" (`landing.faq3A` — the pipeline takes 10-15 minutes)
- After: "The story is ready to read in about a minute, and the fully illustrated book usually takes 10-15 minutes. We'll let you know the moment it's done."
- Before: "Your data is never shared with third parties." (`landing.faq5A` — photos are processed by OpenAI and Google and stored with Cloudinary)
- After: names the AI partners and Cloudinary, promises deletion on request only — never automatic deletion until that pipeline ships.

## Rule 8 (ja) — One register: the picture-book register

Mid-flow screens (create, setup, progress, review, issue, pageMenu) use the create-flow register: spaced, child-friendly hiragana ("しゃしんを みています…"). Library, landing, and checkout surfaces use plain polite form (です/ます), warm, minimal katakana tech-words: ぶんしょう not テキスト, えほん not ブック — the book is always えほん, never 書籍/ブック. Japanese plurals use `{count, plural, other {...}}` only (see `issue.pagesNeedAttention`). All new or rewritten ja strings get a native-speaker pass; log them in `docs/ja-review.md`. Never machine-translate.
