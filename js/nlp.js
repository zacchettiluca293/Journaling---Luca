/* Text analysis primitives. Pure functions, no state, no network.
 *
 * Everything here runs on the phone. The vocabulary lists cover English and
 * Italian so mixed-language journalling still produces sensible topics.
 */

/* Lowercase, strip accents, and fold simple English plurals together.
 * Defined before the word lists so those can be stored already folded —
 * otherwise "always" folds to "alway" at lookup time and misses the list. */
const PLAIN_ASCII = /^[A-Za-z0-9']+$/;

function fold(word) {
  let w = word.toLowerCase();
  // Unicode normalisation is the single most expensive call in the whole
  // analysis, and most words never need it. Only accented text pays for it.
  if (!PLAIN_ASCII.test(w)) {
    w = w.normalize('NFD').replace(/[̀-ͯ]/g, '');
    w = w.replace(/^[^\p{L}\p{N}#]+|[^\p{L}\p{N}]+$/gu, '');
  }
  if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) {
    w = w.slice(0, -1);
  }
  return w;
}

const wordSet = (block) => new Set(block.trim().split(/\s+/).map(fold));

const STOPWORDS = wordSet(`
a about above after again against all almost also am an and another any are aren't around as at
be because been before being below between both but by
can cannot can't could couldn't
did didn't do does doesn't doing don't down during
each either else enough even ever every
few for from further
get gets getting go goes going got
had hadn't has hasn't have haven't having he her here hers herself him himself his how however
i i'd i'll i'm i've if in into is isn't it it's its itself
just
keep kind
let let's like likely little lot
make makes many may maybe me might mine more most much must my myself
need never new next no nor not now
of off often on once one only or other others our ours ourselves out over own
per perhaps
quite
rather really
same say says see seems she should shouldn't since so some someone something soon still such sure
than that that's the their theirs them themselves then there these they thing things think this
those though through thus to today too took try trying
under until up upon us use used using usually
very
want was wasn't way we well went were weren't what when where whether which while who whom why will
with within without won't would wouldn't
yes yet you you're your yours yourself
`);

const STOPWORDS_IT = wordSet(`
a ad affinche agli ai al alcun alcuni all alla alle allo allora altre altri altro anche ancora
avere avevo avuto
c che chi ci cio cioe come con cosa cosi cui
da dagli dai dal dall dalla dalle dallo davvero degli dei del dell della delle dello dentro deve
devo di dopo dove due dunque durante
e ed ecco egli ella entro era erano essere essi
fa fare fatto forse fra fu fuori
gia gli grande
ha hai hanno ho
i il in infatti insieme invece io
la le lei li lo loro lui
ma magari mai me meglio mentre mi mia mie miei mio molta molte molti molto
ne negli nei nel nell nella nelle nello nessun niente no noi non nostra nostre nostri nostro nulla
o oggi ogni oltre ora
per percio perche pero piu poco poi possiamo posso potere prima puo
qua qual quale quando quanto quasi quel quella quelle quelli quello questa queste questi questo qui
sara sarebbe se sei sempre senza si sia siamo sono sopra sotto sta stanno stare stata stato stesso su
sua sue sugli sui sul sull sulla sulle sullo suo suoi
tanto te tra troppo tu tua tue tuo tuoi tutta tutte tutti tutto
un una uno
va vai verso vi via voi vostra vostro
`);

/* Words that are too vague to be a topic on their own. They split into two
 * kinds, because they behave differently inside a phrase:
 *
 *   NOUNS  — vague alone, but can anchor a real topic: "morning routine".
 *   OTHER  — adverbs, light verbs and judgements that never name a subject.
 *            A phrase containing one of these is a fragment of a sentence,
 *            not a topic: "actually decide", "felt heavy", "real work".
 */
const WEAK_NOUNS = wordSet(`
day days time times today tomorrow yesterday morning evening night week weeks
month months year years hour hours minute minutes thing stuff bit lot
giorno giorni settimana mese mesi anno anni cosa cose roba volta volte
`);

const WEAK_OTHER = wordSet(`
feel feeling felt kinda gonna wanna okay ok yeah nope maybe
actually already always back bad better best big done finally first good great last later
long longer nice pretty proper properly real really right seriously small started starting
sure thinking thought told whole came come coming gets getting given giving goes going gone
kept keeping knew know known look looked looking made making put putting said saying seen
seem seemed taken taking turned wanted wanting
two three four five six seven eight nine ten twenty thirty forty fifty hundred
cominciato iniziato davvero proprio veramente bene male detto visto andato preso messo
due tre quattro cinque dieci venti trenta quaranta cento
`);

/** Structural words: never a topic, in any position. */
export function isStopword(word) {
  return STOPWORDS.has(word) || STOPWORDS_IT.has(word);
}

/**
 * Words that are too vague to stand alone as a topic but are fine inside a
 * phrase — "morning" is noise by itself and the point of "morning routine".
 */
export function isWeak(word) {
  return WEAK_NOUNS.has(word) || WEAK_OTHER.has(word);
}

/** Can these two words sit together as a topic? */
function phraseAllowed(a, b) {
  if (WEAK_OTHER.has(a) || WEAK_OTHER.has(b)) return false;
  return !(WEAK_NOUNS.has(a) && WEAK_NOUNS.has(b));
}


export const normalize = fold;

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu;

/**
 * Split text into tokens carrying just enough context for topic detection:
 * whether the token started a sentence, and whether it was capitalised.
 */
export function tokenize(text) {
  const tokens = [];
  let sentenceStart = true;
  let lastEnd = 0;
  let match;
  WORD_RE.lastIndex = 0;
  while ((match = WORD_RE.exec(text)) !== null) {
    const raw = match[0];
    const gap = text.slice(lastEnd, match.index);
    if (/[.!?…\n]/.test(gap)) sentenceStart = true;
    tokens.push({
      raw,
      norm: normalize(raw),
      start: match.index,
      sentenceStart,
      capitalized: /^\p{Lu}/u.test(raw),
      hashtag: match.index > 0 && text[match.index - 1] === '#',
    });
    sentenceStart = false;
    lastEnd = match.index + raw.length;
  }
  return tokens;
}

export function sentences(text) {
  const parts = text.match(/[^.!?…\n]+[.!?…]*/g) || [];
  return parts.map((s) => s.trim()).filter(Boolean);
}

export function countWords(text) {
  const m = text.match(WORD_RE);
  return m ? m.length : 0;
}

/** Reading time in whole minutes, floored at one. */
export function readingMinutes(words) {
  return Math.max(1, Math.round(words / 200));
}

/** #tags the user typed by hand. These always win as topics. */
export function hashtags(text) {
  const out = [];
  const re = /#([\p{L}\p{N}][\p{L}\p{N}_\-]{1,30})/gu;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

/**
 * Candidate terms for one entry, before corpus weighting.
 * Returns a Map of normalised term -> { label, kind, count }.
 *   kind: 'tag' | 'entity' | 'phrase' | 'word'
 */
export function candidates(text) {
  const out = new Map();

  const add = (key, label, kind, weight = 1) => {
    if (!key || key.length < 2) return;
    const prev = out.get(key);
    if (prev) {
      prev.count += weight;
      if (kindRank(kind) > kindRank(prev.kind)) {
        prev.kind = kind;
        prev.label = label;
      }
    } else {
      out.set(key, { label, kind, count: weight });
    }
  };

  for (const tag of hashtags(text)) {
    add(normalize(tag), tag.replace(/[-_]/g, ' '), 'tag');
  }

  const tokens = tokenize(text);

  // Runs of capitalised words read as names: "Project Atlas", "Marco".
  // A capital at the start of a sentence is usually just grammar, so it only
  // joins in when the word after it is capitalised too — which is how
  // "Project Atlas review again." still yields the whole name.
  let run = [];
  const flushRun = () => {
    if (run.length) {
      const label = run.map((t) => t.raw).join(' ');
      const key = run.map((t) => t.norm).join(' ');
      if (key.length >= 3) add(key, label, 'entity');
    }
    run = [];
  };
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    const next = tokens[i + 1];
    const leadsAName = t.sentenceStart
      && next && next.capitalized && !isStopword(next.norm) && !isWeak(next.norm);
    const isName = t.capitalized
      && !isStopword(t.norm)
      && !isWeak(t.norm)
      && (!t.sentenceStart || leadsAName);
    if (isName) run.push(t);
    else flushRun();
  }
  flushRun();

  // Single words, then two-word phrases. A phrase may include one vague word
  // as long as the other carries meaning.
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (isStopword(t.norm) || t.norm.length < 3 || /^\d+$/.test(t.norm)) continue;
    if (!isWeak(t.norm)) add(t.norm, t.raw.toLowerCase(), 'word');

    const next = tokens[i + 1];
    if (!next || isStopword(next.norm) || next.norm.length < 3 || /^\d+$/.test(next.norm)) continue;
    if (next.start - (t.start + t.raw.length) > 1) continue;
    if (!phraseAllowed(t.norm, next.norm)) continue;
    add(`${t.norm} ${next.norm}`, `${t.raw.toLowerCase()} ${next.raw.toLowerCase()}`, 'phrase', 1);
  }

  return out;
}

function kindRank(kind) {
  return { word: 0, phrase: 1, entity: 2, tag: 3 }[kind] ?? 0;
}

export function kindBoost(kind) {
  return { word: 1, phrase: 1.8, entity: 2.2, tag: 4 }[kind] ?? 1;
}

/** First N characters, cut on a word boundary, with an ellipsis if trimmed. */
export function excerpt(text, max = 150) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${cut.slice(0, space > max * 0.6 ? space : max)}…`;
}
