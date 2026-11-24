/* Synced lyrics in big letters, word by word.
   Important words are large, small words (articles, pronouns...)
   smaller, like kinetic typography. Shared by the widget and the full screen. */
(function () {
  'use strict';

  const SMALL = new Set([
    'a',
    'an',
    'the',
    'and',
    'or',
    'of',
    'to',
    'in',
    'on',
    'at',
    'for',
    'it',
    'is',
    'are',
    'am',
    'be',
    'my',
    'me',
    'i',
    "i'm",
    "i've",
    "i'll",
    "i'd",
    'you',
    "you're",
    'we',
    'so',
    'but',
    'with',
    'de',
    'la',
    'le',
    'les',
    'un',
    'une',
    'des',
    'et',
    'je',
    'tu',
    'il',
    'on',
    'au',
    'du',
    'en',
    'que',
    'qui',
  ]);
  const isSmall = (w, last) => !last && (SMALL.has(w.toLowerCase().replace(/[^a-z'à-ÿ]/g, '')) || w.length <= 2);

  // Approximate syllable count (vowel groups): used to share a line's time
  // between its words when the lyrics have no word-by-word timing.
  const syllables = (w) => Math.max(1, (w.toLowerCase().match(/[aeiouyàâäéèêëîïôöùûüÿœæ]+/g) || []).length);

  // Line without word-by-word timing (LRC): how long it is sung. Until the
  // next line (the singer may hold the notes), unless the gap is too long for
  // this number of syllables (instrumental break).
  const spans = new WeakMap();
  function sungSpan(line, next) {
    let v = spans.get(line);
    if (v !== undefined) return v;
    const syl = line.text
      .split(/\s+/)
      .filter(Boolean)
      .reduce((n, w) => n + syllables(w), 0);
    const gap = next ? next.t - line.t : Math.max(line.end - line.t, 5);
    v = Math.max(0.3, Math.min(gap * 0.9, 1.2 + 0.7 * syl));
    spans.set(line, v);
    return v;
  }

  // Same track and same lines (only the offset may have changed).
  function sameLyrics(a, b) {
    if (!a || !b || !a.lines || !b.lines || !a.lines.length) return false;
    if (a.title !== b.title || a.artist !== b.artist || a.lines.length !== b.lines.length) return false;
    return a.lines.every((l, i) => l.t === b.lines[i].t && l.text === b.lines[i].text);
  }

  class LyricsView {
    constructor(el, { maxChars = 14 } = {}) {
      this.el = el;
      this.maxChars = maxChars;
      this.data = null;
      this.index = -2;
      this.current = null;
      // Next line announced in small type under the sung line.
      this.preview = null;
      this.previewIndex = -1;
      this.fallbackKey = '';
    }

    set(data) {
      // Same lyrics with another offset ([ / ]): keep the displayed line,
      // otherwise it would be rebuilt and the old one would float up as a ghost.
      if (sameLyrics(this.data, data)) {
        this.data = data;
        return;
      }
      this.data = data;
      this.index = -2;
      this.fallbackKey = '';
    }

    lineAt(pos) {
      const lines = (this.data && this.data.lines) || [];
      let lo = 0,
        hi = lines.length - 1,
        found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (lines[mid].t <= pos) {
          found = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      // After the end of a line (with a margin), clear it if the next one is late.
      if (found >= 0) {
        const l = lines[found];
        const next = lines[found + 1];
        // Without word-by-word timing, the line stays at least as long as it is sung.
        const end = l.words && l.words.length ? l.end : Math.max(l.end, l.t + sungSpan(l, next));
        if (pos > end + 1.5 && (!next || next.t - pos > 1)) return -1;
      }
      return found;
    }

    // Builds the words of a line, with their start and end.
    words(line, nextLine) {
      if (line.words && line.words.length) {
        // Word-by-word timing: each word lasts until the next one (held note
        // included, up to 3 s), the last one until the end of the line.
        const list = line.words.map((w) => ({ ...w }));
        list.forEach((w, i) => {
          const next = list[i + 1];
          w.end = Math.min(next ? next.t : line.end, w.t + 3);
          if (w.end <= w.t) w.end = w.t + 0.25;
        });
        return list;
      }
      // Without word-by-word timing: the line's sung time is shared between the
      // words according to their syllables (a long word lasts longer than "of").
      const parts = line.text.split(/\s+/).filter(Boolean);
      const syl = parts.map(syllables);
      const total = syl.reduce((a, b) => a + b, 0);
      const span = sungSpan(line, nextLine);
      let acc = 0;
      return parts.map((text, i) => {
        const t = line.t + (span * acc) / total;
        acc += syl[i];
        return { text, t, end: line.t + (span * acc) / total };
      });
    }

    render(wordList, extraClass) {
      const node = document.createElement('div');
      node.className = `lyr-line ${extraClass || ''}`;
      // Lines of ~maxChars characters to form a compact block.
      let row = document.createElement('div');
      row.className = 'lyr-row';
      let count = 0;
      wordList.forEach((w, i) => {
        const len = w.text.length;
        if (count && count + len > this.maxChars) {
          node.appendChild(row);
          row = document.createElement('div');
          row.className = 'lyr-row';
          count = 0;
        }
        const span = document.createElement('span');
        span.className = `lyr-word${isSmall(w.text, i === wordList.length - 1) ? ' small' : ''}`;
        span.textContent = w.text;
        span._t = w.t;
        span._end = w.end ?? w.t;
        span._p = -1; // last fill written (see update)
        row.appendChild(span);
        (node._words || (node._words = [])).push(span);
        count += len + 1;
      });
      node.appendChild(row);
      return node;
    }

    swap(node) {
      for (const g of this.el.querySelectorAll('.lyr-line.ghost')) {
        g.classList.add('out');
        setTimeout(() => g.remove(), 450);
      }
      const old = this.current;
      this.current = node;
      if (node) this.el.appendChild(node);
      if (!old) return;
      // The line that leaves must no longer be read by a screen reader.
      old.setAttribute('aria-hidden', 'true');
      if (!node || old.classList.contains('fallback')) {
        old.classList.add('out');
        setTimeout(() => old.remove(), 450);
        return;
      }
      // Ghost: the line just sung floats up, shrunk and pale.
      old.querySelectorAll('.lyr-word').forEach((s) => {
        s.classList.add('on');
        s.style.setProperty('--p', '100%');
      });
      const gap = parseFloat(getComputedStyle(node).fontSize) * 0.25;
      const shift = node.offsetHeight / 2 + (old.offsetHeight * 0.6) / 2 + gap;
      old.style.setProperty('--gy', `${-shift}px`);
      old.classList.add('ghost');
    }

    // Announces line `i` (or nothing if -1) under the sung line, small and pale.
    setPreview(i) {
      if (i === this.previewIndex) return;
      this.previewIndex = i;
      const old = this.preview;
      this.preview = null;
      if (old) {
        old.classList.add('out');
        setTimeout(() => old.remove(), 450);
      }
      const line = i >= 0 && this.data ? this.data.lines[i] : null;
      if (!line || !line.text || /^[♪♫\s]*$/.test(line.text)) return;
      const node = this.render(this.words(line, this.data.lines[i + 1]), 'preview');
      // Already read with the current line by screen readers: not twice.
      node.setAttribute('aria-hidden', 'true');
      this.el.appendChild(node);
      this.preview = node;
      this.placePreview();
    }

    // Under the sung line (or in the middle if there is none: pause before the verse).
    placePreview() {
      const node = this.preview;
      if (!node) return;
      const cur = this.current && !this.current.classList.contains('fallback') ? this.current : null;
      const gap = parseFloat(getComputedStyle(node).fontSize) * 0.25;
      const shift = cur ? cur.offsetHeight / 2 + (node.offsetHeight * 0.6) / 2 + gap : 0;
      node.style.setProperty('--py', `${shift}px`);
    }

    // Next line to announce: the following one as long as it comes within 8 s.
    upcoming(pos) {
      const lines = this.data.lines;
      let j = this.index >= 0 ? this.index + 1 : 0;
      while (j < lines.length && lines[j].t <= pos) j++;
      return j < lines.length && lines[j].t - pos < 8 ? j : -1;
    }

    // Call every frame.
    update(media, pos) {
      const d = this.data;
      const title = (media && media.title) || '';
      const has = d && d.lines && d.lines.length && media && media.active && (d.title || '') === title;
      if (!has) {
        // No lyrics: show the title in large type, without word-by-word animation.
        // Search in progress or player stopped: empty key, so nothing left on screen.
        // Lyrics unreachable (d.error): a small note, distinct from no lyrics at all.
        const failed = !!(d && d.error && (!d.title || d.title === title));
        const key = media && media.active && (!d || !d.pending) ? `${title}|${media.artist}|${failed ? 'e' : ''}` : '';
        // Without a key, a line still displayed (the previous track's) is removed.
        if (key !== this.fallbackKey || (!key && this.current)) {
          this.fallbackKey = key;
          this.index = -2;
          this.setPreview(-1);
          if (!key) {
            this.swap(null);
            return;
          }
          const node = this.render(
            title
              .split(/\s+/)
              .filter(Boolean)
              .map((text) => ({ text, t: 0 })),
            'fallback',
          );
          const by = document.createElement('div');
          by.className = 'lyr-artist';
          by.textContent = media.artist || '';
          node.appendChild(by);
          if (failed) {
            const note = document.createElement('div');
            note.className = 'lyr-unavailable';
            note.textContent = window.SillonI18n.t('common.lyricsUnavailable');
            node.appendChild(note);
          }
          node.querySelectorAll('.lyr-word').forEach((s) => {
            s.classList.add('on', 'full');
            s.style.setProperty('--p', '100%');
          });
          this.swap(node);
        }
        return;
      }
      this.fallbackKey = '';
      // Offset set for this track (lyrics of another version), then a small
      // lead: the eye reads a little before the voice sings.
      pos += d.offset || 0;
      const i = this.lineAt(pos + 0.15);
      if (i !== this.index) {
        this.index = i;
        const line = i >= 0 ? d.lines[i] : null;
        const empty = !line || !line.text || /^[♪♫\s]*$/.test(line.text);
        this.swap(empty ? null : this.render(this.words(line, d.lines[i + 1])));
        this.placePreview();
      }
      this.setPreview(this.upcoming(pos + 0.15));
      if (this.current && this.current._words) {
        // The next word to sing is marked a little more than the following ones.
        const nextWord = this.current._words.find((sp) => pos + 0.1 < sp._t) || null;
        if (nextWord !== this.current._next) {
          if (this.current._next) this.current._next.classList.remove('next');
          if (nextWord) nextWord.classList.add('next');
          this.current._next = nextWord;
        }
        for (const span of this.current._words) {
          if (pos + 0.1 < span._t) {
            // Going back (seek, offset): the word already colored turns dark again.
            if (span._p >= 0) {
              span.classList.remove('on', 'full');
              span.style.removeProperty('--p');
              span._p = -1;
            }
            continue;
          }
          if (span._p >= 100 && pos >= span._end) continue;
          // Karaoke fill: the word gets colored while it is sung.
          const p = span._end > span._t ? (pos - span._t) / (span._end - span._t) : 1;
          const pct = Math.max(0, Math.min(1, p)) * 100;
          // Only write to the page if the fill moved by at least 1 %.
          if (pct < 100 && span._p >= 0 && Math.abs(pct - span._p) < 1) continue;
          if (span._p < 0) span.classList.add('on');
          if (pct < 100) span.classList.remove('full');
          span._p = pct;
          span.style.setProperty('--p', `${pct.toFixed(1)}%`);
          if (pct >= 100) span.classList.add('full');
        }
      }
    }
  }

  window.LyricsView = LyricsView;
})();
