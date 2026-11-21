/* Paroles synchronisées en grosses lettres, mot par mot.
   Les mots importants sont grands, les petits mots (articles, pronoms...)
   plus petits, comme une typographie animée. Partagé widget / plein écran. */
(function () {
  'use strict';

  const SMALL = new Set([
    'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'it', 'is', 'are', 'am',
    'be', 'my', 'me', 'i', "i'm", "i've", "i'll", "i'd", 'you', "you're", 'we', 'so', 'but', 'with',
    'de', 'la', 'le', 'les', 'un', 'une', 'des', 'et', 'je', 'tu', 'il', 'on', 'au', 'du', 'en', 'que', 'qui',
  ]);
  const isSmall = (w, last) => !last && (SMALL.has(w.toLowerCase().replace(/[^a-z'à-ÿ]/g, '')) || w.length <= 2);

  class LyricsView {
    constructor(el, { maxChars = 14 } = {}) {
      this.el = el;
      this.maxChars = maxChars;
      this.data = null;
      this.index = -2;
      this.current = null;
      this.fallbackKey = '';
    }

    set(data) {
      this.data = data;
      this.index = -2;
      this.fallbackKey = '';
    }

    lineAt(pos) {
      const lines = (this.data && this.data.lines) || [];
      let lo = 0, hi = lines.length - 1, found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (lines[mid].t <= pos) { found = mid; lo = mid + 1; } else hi = mid - 1;
      }
      // Après la fin d'une ligne (avec marge), on efface si la suivante tarde.
      if (found >= 0) {
        const l = lines[found];
        const next = lines[found + 1];
        if (pos > l.end + 1.5 && (!next || next.t - pos > 1)) return -1;
      }
      return found;
    }

    // Construit les mots d'une ligne, avec leur instant d'apparition.
    words(line) {
      if (line.words && line.words.length) return line.words;
      const parts = line.text.split(/\s+/).filter(Boolean);
      const span = Math.max(0.6, Math.min(line.end - line.t, 4) * 0.7);
      return parts.map((text, i) => ({ text, t: line.t + (span * i) / parts.length }));
    }

    render(wordList, extraClass) {
      const node = document.createElement('div');
      node.className = `lyr-line ${extraClass || ''}`;
      // Lignes de ~maxChars caractères pour former un bloc compact.
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
        row.appendChild(span);
        count += len + 1;
      });
      node.appendChild(row);
      return node;
    }

    swap(node) {
      const old = this.current;
      if (old) {
        old.classList.add('out');
        setTimeout(() => old.remove(), 450);
      }
      this.current = node;
      if (node) this.el.appendChild(node);
    }

    // À appeler à chaque image.
    update(media, pos) {
      const d = this.data;
      const has = d && d.lines && d.lines.length && media && media.active && d.title === media.title;
      if (!has) {
        // Pas de paroles : on montre le titre en grand, sans animation mot à mot.
        const key = media && media.active && (!d || !d.pending) ? `${media.title}|${media.artist}` : '';
        if (key !== this.fallbackKey) {
          this.fallbackKey = key;
          this.index = -2;
          if (!key) { this.swap(null); return; }
          const node = this.render(media.title.split(/\s+/).map((text) => ({ text, t: 0 })), 'fallback');
          const by = document.createElement('div');
          by.className = 'lyr-artist';
          by.textContent = media.artist || '';
          node.appendChild(by);
          node.querySelectorAll('.lyr-word').forEach((s) => s.classList.add('on'));
          this.swap(node);
        }
        return;
      }
      this.fallbackKey = '';
      // Petite avance : l'œil lit un peu avant que la voix ne chante.
      const i = this.lineAt(pos + 0.15);
      if (i !== this.index) {
        this.index = i;
        const line = i >= 0 ? d.lines[i] : null;
        const empty = !line || !line.text || /^[♪♫\s]*$/.test(line.text);
        this.swap(empty ? null : this.render(this.words(line)));
      }
      if (this.current) {
        for (const span of this.current.querySelectorAll('.lyr-word:not(.on)')) {
          if (pos + 0.1 >= span._t) span.classList.add('on');
        }
      }
    }
  }

  window.LyricsView = LyricsView;
})();
