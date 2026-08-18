# Journal

A private journal that lives on your phone. You type or dictate, it files
everything away, and when you want to think out loud with an AI you tap one
button and paste.

No account. No server. No subscription. Nothing you write ever leaves your
device unless you choose to copy it somewhere.

---

## Getting it onto your iPhone

This is the part worth doing properly, because everything else follows from it.
It takes about five minutes.

### 1. Put the files online (free, no account juggling)

**The easy way — Netlify Drop:**

1. Go to **https://app.netlify.com/drop** in your browser.
2. Drag this whole `Journal - Luca` folder onto the page.
3. Wait a few seconds. You get a web address like
   `https://calm-otter-38fa21.netlify.app`.
4. That address is your journal. Bookmark it.

The free tier covers this permanently — it's a handful of small files with no
server behind them, so there is nothing to bill you for. You can rename the
site to something friendlier in Netlify's site settings.

**Alternatives, if you'd rather:** GitHub Pages or Vercel both work the same
way and cost the same (nothing). Any host that serves plain files will do — the
app needs no build step and no configuration.

> **One requirement:** the address must start with `https://`. The microphone,
> offline mode, and one-tap copying all need a secure address. All three hosts
> above give you that automatically.

### 2. Add it to your Home Screen

On your iPhone:

1. Open the address in **Safari** (not Chrome — only Safari can install it).
2. Tap the **Share** button (the square with the arrow).
3. Scroll down, tap **Add to Home Screen**, then **Add**.

It now sits with your other apps, opens full screen with no browser bars, and
works with no signal. Storage is also more durable this way, so this step is
worth doing rather than just bookmarking.

### 3. Set your PIN

The first time it opens, you choose four digits. From then on it asks for them
when you open the app, and again after it's been in the background for a minute
(adjustable in Settings).

---

## Trying it on your Mac first

If you'd rather look at it before putting it online, open Terminal and run:

```bash
cd "/Users/lucazacchetti/Desktop/Journaling - Luca" && python3 -m http.server 8080
```

Then open **http://localhost:8080** in your browser. Press `Control-C` in
Terminal to stop it.

Opening `index.html` by double-clicking it will *not* work — browsers block
storage for files opened that way. The app will tell you so if you try.

---

## Using it

### The Feed — for dumping

Opens straight onto a blank line with the keyboard a tap away. Write a thought,
hit the arrow, it's saved. Write another. It reads like a chat with yourself,
newest at the bottom.

- **Voice:** tap the microphone and your iPhone's own dictation opens. Speak,
  tap send. Your voice is transcribed on the phone itself and never uploaded.
  (If you'd rather have the app record continuously, Settings → *Microphone
  button* → *Record inside the app*. That route sends audio to Apple or Google
  to be transcribed, which is why it isn't the default.)
- **Hashtags:** type `#atlas` or `#health` anywhere and it becomes a permanent
  label you can search on. Entirely optional — the app tags entries by itself
  too.
- **Tap any entry** to copy it, edit it, or delete it.
- Half-written thoughts are kept if you close the app mid-sentence.

### The Vault — for finding and reviewing

- **Search** — every word you've ever written, instantly.
- **Gone quiet** — topics that used to come up regularly and haven't lately:
  *"Project Atlas — last mentioned 25 days ago, 26 mentions across 13 days,
  previously about every 4 days."* It states the fact and stops there. Whether
  that matters is your call, not the app's.
- **New lately** — topics that have appeared for the first time this week.
- **Summaries** — weekly, monthly and yearly digests built from your entries:
  how much you wrote, when in the day you wrote it, which topics rose and fell
  against the period before, which questions you asked yourself, your longest
  entries.
- **Browse** — everything by month.

### Copy for AI

The copy button appears on entries, on summaries, on search results, and on
whole months. It produces clean Markdown (or JSON, if you prefer — Settings)
ready to paste into Claude, ChatGPT or Perplexity.

Each export ends with a short instruction asking the AI to stick to what you
actually wrote, connect the dots, and ask rather than assume. You can delete
that paragraph if you'd rather steer it yourself.

Good starting points once pasted:

- *"Read this month and tell me what I keep circling back to."*
- *"Which of the questions I asked myself here have I never answered?"*
- *"What's changed between the first week and the last?"*

---

## Backups — please do this

**Your journal exists in one place: this phone.** That is what makes it free
and private, and it is also the risk. Clear Safari's data, delete the app, or
lose the phone, and the entries go with it. There is no copy on a server to
restore from, because there is no server.

So: **Vault → ⚙︎ → Backup & restore → Save a backup file**, once a month. It
saves a single file to iCloud Drive, Files, wherever you like. To bring it back
— on a new phone, say — use *Restore from a file* and choose *Add to what I
have*.

Set a monthly reminder. It takes ten seconds and it's the difference between a
journal and a story about one.

---

## What it costs, and why

Nothing, ever. There's no server doing work on your behalf: the files are
static, the storage is your browser's own database, and the analysis runs on
your phone's processor while you look at it. Free hosting tiers exist precisely
for sites like this one, and this one will never outgrow them.

---

## Being straight with you about three things

**1. The "AI" in this app is arithmetic, not a mind.**
Gap detection, topic tagging and the digests are real statistics — word
frequencies, recency, medians between mentions — computed on your phone. They
are genuinely useful and completely private, but nothing here *understands* what
you wrote. The understanding happens when you tap Copy for AI and paste into a
real model. That is the design, not a shortcut.

**2. The PIN is a privacy screen, not a lock.**
It stops someone picking up your unlocked phone and reading your journal. It is
not encryption: your entries are stored in readable form, which is exactly what
makes a forgotten PIN harmless — after three wrong tries you can reset it and
your entries are untouched. Someone determined, holding your unlocked phone, and
willing to dig through browser developer tools could reach the text. If you want
protection against that, your iPhone's own passcode and Face ID are the layer
doing the real work.

**3. Everything is on one device.**
There's no sync between your phone and your laptop. Two devices means two
separate journals. You can move entries between them with the backup file, but
it's a manual copy, not a sync. See the Backups section above.

---

## If you ever want to change something

No build step, no dependencies — edit a file, refresh, done.

| File | What's in it |
|---|---|
| `index.html` | The page structure |
| `css/app.css` | Every colour, font and spacing choice — the palette is at the very top |
| `js/feed.js` | The writing screen |
| `js/vault.js` | Search, summaries, quiet threads |
| `js/analysis.js` | How patterns and digests are worked out |
| `js/nlp.js` | Which words count as topics (the word lists live here) |
| `js/format.js` | What "Copy for AI" produces |
| `js/settings.js` | Settings, backup and restore |
| `js/pin.js` | The lock screen logic |
| `sw.js` | Offline support — **bump `CACHE` to `journal-v2` etc. whenever you change any file**, or phones will keep the old version |

After editing, drag the folder onto Netlify Drop again to publish the update.
