/* Paroles synchronisées en grosses lettres, mot par mot.
   Les mots importants sont grands, les petits mots (articles, pronoms...)
   plus petits, comme une typographie animée. Partagé widget / plein écran. */
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

  // Même morceau et mêmes lignes (seul le décalage a pu changer).
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
      this.fallbackKey = '';
    }

    set(data) {
      // Mêmes paroles avec un autre décalage ([ / ]) : on garde la ligne affichée,
      // sinon elle serait reconstruite et l'ancienne remonterait en fantôme.
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
      let list;
      if (line.words && line.words.length) list = line.words.map((w) => ({ ...w }));
      else {
        const parts = line.text.split(/\s+/).filter(Boolean);
        const span = Math.max(0.6, Math.min(line.end - line.t, 4) * 0.7);
        list = parts.map((text, i) => ({ text, t: line.t + (span * i) / parts.length }));
      }
      list.forEach((w, i) => {
        const next = list[i + 1];
        w.end = Math.min(next ? next.t : line.end, w.t + 1.5);
        if (w.end <= w.t) w.end = w.t + 0.25;
      });
      return list;
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
        span._end = w.end ?? w.t;
        span._p = -1; // dernier remplissage écrit (voir update)
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
      // La ligne qui s'en va ne doit plus être lue par un lecteur d'écran.
      old.setAttribute('aria-hidden', 'true');
      if (!node || old.classList.contains('fallback')) {
        old.classList.add('out');
        setTimeout(() => old.remove(), 450);
        return;
      }
      // Fantôme : la ligne qu'on vient de chanter remonte, réduite et pâle.
      old.querySelectorAll('.lyr-word').forEach((s) => {
        s.classList.add('on');
        s.style.setProperty('--p', '100%');
      });
      const gap = parseFloat(getComputedStyle(node).fontSize) * 0.25;
      const shift = node.offsetHeight / 2 + (old.offsetHeight * 0.6) / 2 + gap;
      old.style.setProperty('--gy', `${-shift}px`);
      old.classList.add('ghost');
    }

    // À appeler à chaque image.
    update(media, pos) {
      const d = this.data;
      const title = (media && media.title) || '';
      const has = d && d.lines && d.lines.length && media && media.active && (d.title || '') === title;
      if (!has) {
        // Pas de paroles : on montre le titre en grand, sans animation mot à mot.
        // Recherche en cours ou lecteur arrêté : clé vide, donc plus rien à l'écran.
        // Paroles injoignables (d.error) : une petite note, distincte d'une absence.
        const failed = !!(d && d.error && (!d.title || d.title === title));
        const key = media && media.active && (!d || !d.pending) ? `${title}|${media.artist}|${failed ? 'e' : ''}` : '';
        // Sans clé, une ligne encore affichée (celle du morceau précédent) est retirée.
        if (key !== this.fallbackKey || (!key && this.current)) {
          this.fallbackKey = key;
          this.index = -2;
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
            note.textContent = 'Paroles indisponibles';
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
      // Décalage réglé pour ce morceau (paroles d'une autre version), puis
      // petite avance : l'œil lit un peu avant que la voix ne chante.
      pos += d.offset || 0;
      const i = this.lineAt(pos + 0.15);
      if (i !== this.index) {
        this.index = i;
        const line = i >= 0 ? d.lines[i] : null;
        const empty = !line || !line.text || /^[♪♫\s]*$/.test(line.text);
        this.swap(empty ? null : this.render(this.words(line)));
      }
      if (this.current && this.current._words) {
        for (const span of this.current._words) {
          if (pos + 0.1 < span._t) {
            // Retour en arrière (seek, décalage) : le mot déjà coloré redevient éteint.
            if (span._p >= 0) {
              span.classList.remove('on', 'full');
              span.style.removeProperty('--p');
              span._p = -1;
            }
            continue;
          }
          if (span._p >= 100 && pos >= span._end) continue;
          // Remplissage karaoké : le mot se colore pendant qu'il est chanté.
          const p = span._end > span._t ? (pos - span._t) / (span._end - span._t) : 1;
          const pct = Math.max(0, Math.min(1, p)) * 100;
          // On n'écrit dans la page que si le remplissage a bougé d'au moins 1 %.
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
