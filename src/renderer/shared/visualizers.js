/* Sillon — dessins : visualiseurs (barres, miroir, anneau, halo, spectre, points,
   étincelles, rosace, disque…),
   bord lumineux et anneaux de pochette.
   Script classique : expose window.SillonVisuals. Chargé après colors.js. */
(function () {
  'use strict';

  const { withAlpha } = window.SillonColors;

  function hGradient(ctx, w, pal) {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, pal[0]);
    g.addColorStop(0.5, pal[1]);
    g.addColorStop(1, pal[2]);
    return g;
  }

  // Ajoute une barre arrondie en haut au tracé en cours (remplie par l'appelant).
  function roundedBar(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
  }

  // Traits regroupés par couleur et opacité : un seul tracé (et un seul flou de
  // lueur) par groupe au lieu d'un par trait. La lueur (shadowBlur) coûte cher :
  // elle est recalculée à chaque appel de stroke()/fill().
  const ALPHA_STEPS = 4;
  class StrokeBatch {
    constructor() {
      this.paths = new Map();
    }
    // alpha arrondi à ALPHA_STEPS paliers entre lo et 1.
    add(color, alpha, lo, x0, y0, x1, y1) {
      const step = Math.round(((alpha - lo) / (1 - lo)) * (ALPHA_STEPS - 1));
      const key = color + '|' + step;
      let p = this.paths.get(key);
      if (!p) {
        p = { path: new Path2D(), color, alpha: lo + ((1 - lo) * step) / (ALPHA_STEPS - 1), step };
        this.paths.set(key, p);
      }
      p.path.moveTo(x0, y0);
      p.path.lineTo(x1, y1);
    }
    // La lueur n'est appliquée qu'aux deux paliers d'opacité les plus hauts
    // (les traits les plus visibles) : c'est là que le flou coûte le plus.
    stroke(ctx, glow) {
      const blur = ctx.shadowBlur;
      for (const { path, color, alpha, step } of this.paths.values()) {
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha;
        if (glow) {
          const on = step >= ALPHA_STEPS - 2;
          ctx.shadowBlur = on ? blur : 0;
          if (on) ctx.shadowColor = color;
        }
        ctx.stroke(path);
      }
      this.paths.clear();
      ctx.shadowBlur = blur;
      ctx.globalAlpha = 1;
    }
  }
  const batch = new StrokeBatch();

  // Anneaux du disque autres que les rayons (réglage discRays, voir catalog.js).
  // Chacun reçoit : centre (cx, cy), rayon de la pochette (r), intensité (k),
  // analyse (a), palette, temps (t, ms), écart depuis l'image précédente (dt, ms),
  // animations réduites (rm) et lueur (glow).
  const DISC_RINGS = {
    // Courbe lisse fermée qui ondule avec le spectre, doublée d'une seconde
    // courbe plus courte : un anneau liquide autour de la pochette.
    wave(ctx, { cx, cy, r, k, a, pal, t, rm, glow }) {
      const bands = a.bands(48);
      const n = 96;
      const inner = r + 10,
        len = r * 0.9 * k;
      const rot = rm ? 0 : t * 0.00005;
      ctx.lineJoin = 'round';
      for (const [layer, color, scale, width] of [
        [0, pal[0], 1, Math.max(2, r * 0.03)],
        [1, pal[2], 0.55, Math.max(1.5, r * 0.018)],
      ]) {
        const xs = new Float32Array(n),
          ys = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const half = i < n / 2 ? i : n - i; // symétrique, basses en haut
          const v = bands[Math.min(47, Math.floor((half / (n / 2)) * 48))];
          const wob = rm ? 0 : Math.sin(i * 0.5 + t * 0.003 + layer * 2) * 2;
          const rr = inner + 2 + v * len * scale + wob;
          const ang = (i / n) * Math.PI * 2 - Math.PI / 2 + rot * (layer ? -1 : 1);
          xs[i] = cx + Math.cos(ang) * rr;
          ys[i] = cy + Math.sin(ang) * rr;
        }
        // Courbe par les milieux des segments : lisse et fermée.
        ctx.beginPath();
        ctx.moveTo((xs[n - 1] + xs[0]) / 2, (ys[n - 1] + ys[0]) / 2);
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          ctx.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[j]) / 2, (ys[i] + ys[j]) / 2);
        }
        ctx.closePath();
        if (layer === 0) {
          // Voile entre la pochette et la courbe.
          ctx.fillStyle = withAlpha(pal[1], 0.14);
          ctx.fill();
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.shadowColor = color;
        ctx.shadowBlur = glow ? 10 + 4 * k : 0;
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    },

    // Couronne de colonnes de points : chaque direction s'allume vers
    // l'extérieur selon sa bande, les points rapetissent en s'éloignant.
    dots(ctx, { cx, cy, r, k, a, pal, glow }) {
      const bands = a.bands(32);
      const n = 64;
      const rows = Math.max(3, Math.round(4 + 2 * k));
      const inner = r + 12;
      const step = Math.max(5, r * 0.13);
      const dot = Math.max(1.5, r * 0.035);
      const paths = [new Path2D(), new Path2D(), new Path2D()];
      const off = new Path2D();
      for (let i = 0; i < n; i++) {
        const half = i < n / 2 ? i : n - 1 - i;
        const v = bands[Math.min(31, Math.floor((half / (n / 2)) * 32))];
        const lit = v * rows;
        const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
        const c = Math.cos(ang),
          s = Math.sin(ang);
        for (let j = 0; j < rows; j++) {
          const rr = inner + j * step;
          const x = cx + c * rr,
            y = cy + s * rr;
          const on = Math.min(1, Math.max(0, lit - j));
          const size = dot * (1 - (j / rows) * 0.45) * (on > 0.05 ? 0.6 + 0.4 * on : 0.45);
          const p = on > 0.05 ? paths[j < rows / 3 ? 0 : j < (2 * rows) / 3 ? 1 : 2] : off;
          p.moveTo(x + size, y);
          p.arc(x, y, size, 0, Math.PI * 2);
        }
      }
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = pal[0];
      ctx.fill(off);
      ctx.globalAlpha = 1;
      ctx.shadowBlur = glow ? 8 : 0;
      for (let c = 0; c < 3; c++) {
        ctx.fillStyle = pal[c];
        ctx.shadowColor = pal[c];
        ctx.fill(paths[c]);
      }
      ctx.shadowBlur = 0;
    },

    // Jauge circulaire : le spectre découpé en segments d'arc épais, séparés
    // par un petit jour, qui s'épaississent vers l'extérieur.
    arcs(ctx, { cx, cy, r, k, a, pal, glow }) {
      const bands = a.bands(24);
      const n = 48;
      const inner = r + 12,
        len = r * 0.85 * k;
      const gap = 0.018; // radians entre deux segments
      const paths = [new Path2D(), new Path2D()];
      const track = new Path2D();
      for (let i = 0; i < n; i++) {
        const half = i < n / 2 ? i : n - 1 - i;
        const v = bands[Math.min(23, Math.floor((half / (n / 2)) * 24))];
        const a0 = (i / n) * Math.PI * 2 - Math.PI / 2 + gap;
        const a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2 - gap;
        const h = 3 + v * len;
        const p = paths[i % 2];
        p.moveTo(cx + Math.cos(a0) * inner, cy + Math.sin(a0) * inner);
        p.arc(cx, cy, inner + h, a0, a1);
        p.arc(cx, cy, inner, a1, a0, true);
        p.closePath();
        // Rail discret jusqu'à la longueur maximale.
        track.moveTo(cx + Math.cos(a0) * (inner + h), cy + Math.sin(a0) * (inner + h));
        track.arc(cx, cy, inner + 3 + len, a0, a1);
        track.arc(cx, cy, inner + h, a1, a0, true);
        track.closePath();
      }
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = pal[2];
      ctx.fill(track);
      ctx.globalAlpha = 1;
      ctx.shadowBlur = glow ? 10 : 0;
      for (let c = 0; c < 2; c++) {
        ctx.fillStyle = pal[c];
        ctx.shadowColor = pal[c];
        ctx.fill(paths[c]);
      }
      ctx.shadowBlur = 0;
    },

    // Ondes concentriques : un anneau part du bord de la pochette à chaque
    // battement (et de temps en temps quand la musique est forte), s'élargit et
    // s'efface. Animations réduites : deux anneaux fixes.
    ripples(ctx, { cx, cy, r, k, a, pal, t, dt, rm, glow }) {
      const st = discState;
      if (!st.ripples) st.ripples = [];
      const list = st.ripples;
      const reach = r * (1.2 + 0.9 * k); // distance parcourue avant de disparaître
      ctx.lineWidth = Math.max(1.5, r * 0.025);
      if (rm) {
        for (const [f, color] of [
          [0.35, pal[0]],
          [0.7, pal[1]],
        ]) {
          ctx.strokeStyle = color;
          ctx.globalAlpha = 0.5 * (1 - f);
          ctx.beginPath();
          ctx.arc(cx, cy, r + 8 + f * reach, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        return;
      }
      if (a.beat || (a.level > 0.25 && t - (st.lastRipple || 0) > 900)) {
        if (t - (st.lastRipple || 0) > 220 && list.length < 12) {
          st.lastRipple = t;
          list.push({ f: 0, color: pal[list.length % 3], w: 0.6 + a.bass * 0.8 });
        }
      }
      const speed = 0.00055; // fraction de « reach » par ms (~1,8 s de vie)
      ctx.shadowBlur = glow ? 10 : 0;
      for (let i = list.length - 1; i >= 0; i--) {
        const o = list[i];
        o.f += dt * speed;
        if (o.f >= 1) {
          list.splice(i, 1);
          continue;
        }
        ctx.strokeStyle = o.color;
        ctx.shadowColor = o.color;
        ctx.globalAlpha = (1 - o.f) * (1 - o.f) * 0.9;
        ctx.lineWidth = Math.max(1, r * 0.03 * o.w * (1 - o.f * 0.6));
        ctx.beginPath();
        ctx.arc(cx, cy, r + 8 + o.f * reach, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // Anneau de base qui respire avec le niveau lissé (pas de clignotement).
      ctx.strokeStyle = pal[2];
      ctx.globalAlpha = 0.35 + a.pulse * 0.4;
      ctx.lineWidth = Math.max(1.5, r * 0.02);
      ctx.beginPath();
      ctx.arc(cx, cy, r + 8 + a.glowLevel * r * 0.15, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    },
  };

  // Rayons du disque (« fins » ou « épais »).
  function drawRays(ctx, cx, cy, r, k, a, pal, t, rm, opts) {
    const bold = opts.rays === 'bold';
    const n = bold ? Math.round(56 + 16 * k) : Math.min(320, Math.round(140 + 90 * k));
    const bands = a.bands(64);
    const inner = r + 12,
      len = r * (bold ? 1.35 : 1.15) * k;
    ctx.lineCap = 'round';
    ctx.lineWidth = bold ? Math.max(3, r * 0.055) : Math.max(1.1, r * 0.014);
    ctx.shadowBlur = opts.glow === false ? 0 : 8 + 6 * k;
    for (let i = 0; i < n; i++) {
      const half = i < n / 2 ? i : n - 1 - i;
      const v = bands[Math.min(63, Math.floor((half / (n / 2)) * 64))];
      const wob = rm ? 0.5 : 0.5 + 0.5 * Math.sin(i * 1.7 + t * 0.004); // un peu de vie au repos
      const l = 3 + v * len + wob * 3 * k;
      const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
      batch.add(
        pal[i % 2 ? 0 : 1],
        0.55 + v * 0.45,
        0.55,
        cx + Math.cos(ang) * inner,
        cy + Math.sin(ang) * inner,
        cx + Math.cos(ang) * (inner + l),
        cy + Math.sin(ang) * (inner + l),
      );
    }
    batch.stroke(ctx, opts.glow !== false);
    ctx.shadowBlur = 0;
  }

  const VISUALIZERS = {
    // Disque masqué : on ne dessine rien (le moteur n'efface même pas le canvas sans décor).
    none() {},

    bars(ctx, w, h, a, pal, opts) {
      const n = Math.max(16, Math.min(96, Math.floor(w / 14)));
      const bands = a.bands(n);
      const slot = w / n,
        bw = slot * 0.62;
      const base = opts.reflection === false ? h : h * 0.8;
      const fill = hGradient(ctx, w, pal);
      ctx.fillStyle = fill;
      ctx.shadowColor = pal[1];
      ctx.shadowBlur = opts.glow ? 18 : 0;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const bh = Math.max(3, bands[i] * base * 0.95);
        roundedBar(ctx, i * slot + (slot - bw) / 2, base - bh, bw, bh, bw / 2);
      }
      ctx.fill(); // un seul remplissage (et une seule lueur) pour toutes les barres
      ctx.shadowBlur = 0;
      if (opts.reflection !== false) {
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.translate(0, base * 2 + 4);
        ctx.scale(1, -1);
        for (let i = 0; i < n; i++) {
          const bh = Math.max(3, bands[i] * base * 0.95) * 0.45;
          ctx.fillRect(i * slot + (slot - bw) / 2, base - bh, bw, bh);
        }
        ctx.restore();
      }
    },

    mirror(ctx, w, h, a, pal, opts) {
      const n = Math.max(24, Math.min(128, Math.floor(w / 20) * 2));
      const bands = a.bands(n / 2);
      const slot = w / n,
        bw = slot * 0.55,
        mid = h / 2;
      ctx.fillStyle = hGradient(ctx, w, [pal[2], pal[0], pal[2]]);
      ctx.shadowColor = pal[0];
      ctx.shadowBlur = opts.glow ? 14 : 0;
      for (let i = 0; i < n; i++) {
        const k = i < n / 2 ? n / 2 - 1 - i : i - n / 2; // basses au centre
        const bh = Math.max(2, bands[k] * h * 0.46);
        const x = i * slot + (slot - bw) / 2;
        if (i === 0) ctx.beginPath();
        ctx.roundRect(x, mid - bh, bw, bh * 2, bw / 2);
      }
      ctx.fill();
      ctx.shadowBlur = 0;
    },

    ring(ctx, w, h, a, pal, opts) {
      const n = 120;
      const bands = a.bands(60);
      const cx = opts.cx ?? w / 2,
        cy = opts.cy ?? h / 2;
      const m = Math.min(w, h);
      const rm = opts.reduceMotion;
      const r0 = opts.radius ?? m * 0.2 * (1 + (rm ? 0 : a.bass * 0.08));
      const len = opts.radius ? m * 0.16 : m * 0.2;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(2, ((2 * Math.PI * r0) / n) * 0.45);
      ctx.shadowBlur = opts.glow ? 16 : 0;
      const rot = rm ? 0 : (opts.t || 0) * 0.00005;
      for (let i = 0; i < n; i++) {
        const k = i < n / 2 ? i : n - 1 - i; // symétrique
        const v = bands[k];
        const ang = (i / n) * Math.PI * 2 - Math.PI / 2 + rot;
        const c = pal[i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : 2];
        batch.add(
          c,
          1,
          0,
          cx + Math.cos(ang) * r0,
          cy + Math.sin(ang) * r0,
          cx + Math.cos(ang) * (r0 + 3 + v * len),
          cy + Math.sin(ang) * (r0 + 3 + v * len),
        );
      }
      batch.stroke(ctx, opts.glow);
      ctx.shadowBlur = 0;
      if (!opts.radius) {
        ctx.strokeStyle = pal[2];
        ctx.globalAlpha = 0.35 + (rm ? 0 : a.pulse) * 0.25;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(0, r0 - 6), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    },

    wave(ctx, w, h, a, pal, opts) {
      const data = a.wave;
      const mid = h / 2;
      const layers = [
        [pal[0], 1, 3],
        [pal[1], 0.7, 2],
        [pal[2], 0.45, 1.5],
      ];
      ctx.shadowBlur = opts.glow ? 14 : 0;
      layers.forEach(([color, amp, lw], li) => {
        ctx.strokeStyle = color;
        ctx.shadowColor = color;
        ctx.lineWidth = lw;
        ctx.beginPath();
        const step = Math.max(1, Math.floor(data.length / w / 1.5));
        const offset = li * 37;
        for (let x = 0, i = 0; x <= w; x += 2, i += step * 2) {
          const s = data[(i + offset) % data.length] || 0;
          const edge = Math.sin((x / w) * Math.PI); // fondu aux bords
          const y = mid + s * h * 1.6 * amp * edge * (opts.sensitivity || 1);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });
      ctx.shadowBlur = 0;
    },

    aurora(ctx, w, h, a, pal, opts) {
      const bands = a.bands(24);
      const t = opts.reduceMotion ? 0 : (opts.t || 0) / 1000;
      ctx.globalCompositeOperation = 'lighter';
      for (let layer = 0; layer < 3; layer++) {
        const color = pal[layer];
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, 'transparent');
        g.addColorStop(0.55, color);
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.moveTo(0, h);
        const pts = 48;
        for (let i = 0; i <= pts; i++) {
          const x = (i / pts) * w;
          const e = bands[Math.floor((i / pts) * 23)];
          const wobble =
            Math.sin(i * 0.35 + t * (0.6 + layer * 0.25) + layer * 2) * 0.12 +
            Math.sin(i * 0.11 - t * 0.4 + layer) * 0.1;
          const y = h * (0.75 - layer * 0.08 - e * 0.55 - wobble);
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },

    // Colonnes de blocs empilés, façon VU-mètre : le bloc du haut retombe
    // lentement (crête).
    blocks(ctx, w, h, a, pal) {
      const n = Math.max(12, Math.min(48, Math.floor(w / 26)));
      const rows = Math.max(8, Math.min(24, Math.floor(h / 16)));
      const bands = a.bands(n);
      const slot = w / n,
        bw = slot * 0.72,
        bh = (h / rows) * 0.7,
        gap = h / rows;
      if (!blocksState.peaks || blocksState.peaks.length !== n) blocksState.peaks = new Float32Array(n);
      const peaks = blocksState.peaks;
      // Blocs regroupés par couleur et opacité (3 couleurs x 6 paliers) : un
      // seul tracé et un seul remplissage par groupe, au lieu d'un par bloc.
      const groups = blocksState.groups;
      groups.fill(null);
      const rad = Math.min(3, bh / 3);
      for (let i = 0; i < n; i++) {
        const lit = Math.round(bands[i] * rows);
        peaks[i] = Math.max(lit, peaks[i] - 0.12);
        const x = i * slot + (slot - bw) / 2;
        for (let r = 0; r < rows; r++) {
          const y = h - (r + 1) * gap + (gap - bh) / 2;
          const on = r < lit;
          const top = Math.round(peaks[i]) === r + 1 && r >= lit - 1;
          const f = r / rows;
          const ci = !on && !top ? 0 : f > 0.75 ? 2 : f > 0.4 ? 1 : 0;
          // Paliers : 0-3 blocs allumés (opacité 0,55 -> 1), 4 éteint, 5 crête.
          const step = !on && !top ? 4 : top && !on ? 5 : Math.min(3, Math.floor(f * 4));
          const gi = ci * 6 + step;
          const p = groups[gi] || (groups[gi] = new Path2D());
          p.roundRect(x, y, bw, bh, rad);
        }
      }
      for (let gi = 0; gi < groups.length; gi++) {
        const p = groups[gi];
        if (!p) continue;
        const step = gi % 6;
        ctx.globalAlpha = step === 4 ? 0.07 : step === 5 ? 0.9 : 0.55 + 0.45 * ((step + 0.5) / 4);
        ctx.fillStyle = pal[Math.floor(gi / 6)];
        ctx.fill(p);
      }
      ctx.globalAlpha = 1;
    },

    // Anneau dense de traits fins autour d'un cœur lumineux qui respire.
    halo(ctx, w, h, a, pal, opts) {
      const cx = w / 2,
        cy = h / 2,
        m = Math.min(w, h);
      // Lueurs pilotées par les valeurs lissées (pas de clignotement rapide), et
      // figées en mode animations réduites.
      const rm = opts.reduceMotion;
      const pl = rm ? 0 : a.pulse,
        lv = rm ? 0 : a.glowLevel;
      const r = m * 0.17 * (1 + (rm ? 0 : a.bass * 0.06));
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.6);
      core.addColorStop(0, withAlpha('#ffffff', 0.35 + lv * 0.3));
      core.addColorStop(0.3, withAlpha(pal[0], 0.35 + pl * 0.25));
      core.addColorStop(1, withAlpha(pal[0], 0));
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 2.6, 0, Math.PI * 2);
      ctx.fill();
      const n = 180,
        bands = a.bands(64),
        len = m * 0.22;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1, m * 0.004);
      ctx.shadowBlur = opts.glow === false ? 0 : 10;
      const rot = rm ? 0 : (opts.t || 0) * 0.00004;
      for (let i = 0; i < n; i++) {
        const half = i < n / 2 ? i : n - 1 - i;
        const v = bands[Math.min(63, Math.floor((half / (n / 2)) * 64))];
        const ang = (i / n) * Math.PI * 2 - Math.PI / 2 + rot;
        batch.add(
          pal[i % 2 ? 1 : 2],
          0.5 + v * 0.5,
          0.5,
          cx + Math.cos(ang) * r,
          cy + Math.sin(ang) * r,
          cx + Math.cos(ang) * (r + 4 + v * len),
          cy + Math.sin(ang) * (r + 4 + v * len),
        );
      }
      batch.stroke(ctx, opts.glow !== false);
      ctx.shadowBlur = 0;
    },

    // Courbe lisse du spectre, remplie en dégradé jusqu'en bas : un relief qui
    // ondule avec la musique.
    spectrum(ctx, w, h, a, pal, opts) {
      const n = Math.max(24, Math.min(80, Math.floor(w / 18)));
      const bands = a.bands(n);
      const base = opts.reflection === false ? h : h * 0.85;
      const pts =
        spectrumState.pts.length === n + 2 ? spectrumState.pts : (spectrumState.pts = new Float32Array(n + 2));
      // Bords posés au ras du bas : la courbe y entre et en sort en douceur.
      pts[0] = base;
      pts[n + 1] = base;
      for (let i = 0; i < n; i++) pts[i + 1] = base - Math.max(0.01, bands[i]) * base * 0.92;
      const xAt = (i) => (i === 0 ? 0 : i === n + 1 ? w : ((i - 0.5) / n) * w);
      const trace = () => {
        ctx.moveTo(0, pts[0]);
        for (let i = 1; i <= n; i++) {
          const mx = (xAt(i) + xAt(i + 1)) / 2,
            my = (pts[i] + pts[i + 1]) / 2;
          ctx.quadraticCurveTo(xAt(i), pts[i], mx, my);
        }
        ctx.lineTo(w, pts[n + 1]);
      };
      const g = ctx.createLinearGradient(0, base * 0.1, 0, base);
      g.addColorStop(0, withAlpha(pal[2], 0.55));
      g.addColorStop(0.5, withAlpha(pal[0], 0.35));
      g.addColorStop(1, withAlpha(pal[0], 0.02));
      ctx.fillStyle = g;
      ctx.beginPath();
      trace();
      ctx.lineTo(w, base);
      ctx.lineTo(0, base);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = hGradient(ctx, w, pal);
      ctx.lineWidth = Math.max(2, Math.min(4, h / 60));
      ctx.lineJoin = 'round';
      ctx.shadowColor = pal[1];
      ctx.shadowBlur = opts.glow ? 14 : 0;
      ctx.beginPath();
      trace();
      ctx.stroke();
      ctx.shadowBlur = 0;
      if (opts.reflection !== false) {
        // Reflet sous la ligne de base, comme pour les barres.
        ctx.save();
        ctx.globalAlpha = 0.18;
        ctx.translate(0, base * 2 + 4);
        ctx.scale(1, -1);
        ctx.fillStyle = g;
        ctx.beginPath();
        trace();
        ctx.lineTo(w, base);
        ctx.lineTo(0, base);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    },

    // Matrice de points, façon tableau lumineux : chaque colonne s'allume du bas
    // vers le haut, les points allumés grossissent.
    dots(ctx, w, h, a, pal) {
      const n = Math.max(12, Math.min(64, Math.floor(w / 18)));
      const rows = Math.max(6, Math.min(20, Math.floor(h / 18)));
      const bands = a.bands(n);
      const slot = w / n,
        gap = h / rows;
      const rMax = Math.max(1.5, Math.min(slot, gap) * 0.38);
      // Un tracé par couleur (3) plus un pour les points éteints : quatre remplissages en tout.
      const lit = [new Path2D(), new Path2D(), new Path2D()];
      const off = new Path2D();
      for (let i = 0; i < n; i++) {
        const level = bands[i] * rows;
        const x = (i + 0.5) * slot;
        for (let r = 0; r < rows; r++) {
          const y = h - (r + 0.5) * gap;
          const on = Math.min(1, Math.max(0, level - r)); // point à moitié allumé en haut de colonne
          if (on <= 0.05) {
            off.moveTo(x + rMax * 0.35, y);
            off.arc(x, y, rMax * 0.35, 0, Math.PI * 2);
            continue;
          }
          const f = r / rows;
          const p = lit[f > 0.7 ? 2 : f > 0.35 ? 1 : 0];
          const rad = rMax * (0.45 + 0.55 * on);
          p.moveTo(x + rad, y);
          p.arc(x, y, rad, 0, Math.PI * 2);
        }
      }
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = pal[0];
      ctx.fill(off);
      ctx.globalAlpha = 1;
      for (let c = 0; c < 3; c++) {
        ctx.fillStyle = pal[c];
        ctx.fill(lit[c]);
      }
    },

    // Étincelles qui montent du bas, plus nombreuses et plus rapides quand le son
    // est fort ; une gerbe à chaque battement.
    sparks(ctx, w, h, a, pal, opts) {
      const st = sparksStateOf(ctx);
      const rm = opts.reduceMotion;
      const t = opts.t || 0;
      const dt = Math.min(0.1, Math.max(0, (t - (st.last || t)) / 1000));
      st.last = t;
      const bands = a.bands(32);
      const P = st.p,
        max = rm ? SPARKS_MAX / 3 : SPARKS_MAX;
      // Naissances : selon le niveau sonore, à l'aplomb des bandes les plus fortes.
      let births = dt * (rm ? 15 : 45) * (0.3 + a.level * 2.5) + (a.beat ? 18 : 0);
      for (let i = 0; i < SPARKS_MAX && births > 0; i++) {
        if (P[i * 6 + 4] > 0 || st.count >= max) continue;
        if (births < 1 && Math.random() > births) break;
        births--;
        const b = Math.floor(Math.random() * 32);
        const v = bands[b];
        const o = i * 6;
        P[o] = (b + Math.random()) / 32; // x (0 à 1)
        P[o + 1] = 1.02; // y (0 en haut, 1 en bas)
        P[o + 2] = (Math.random() - 0.5) * 0.06; // vitesse x
        P[o + 3] = -(0.12 + v * 0.55 + Math.random() * 0.1) * (rm ? 0.4 : 1); // vitesse y
        P[o + 4] = 1; // vie
        P[o + 5] = Math.floor(Math.random() * 3); // couleur
        st.count++;
      }
      // Mouvement, puis tracés regroupés par couleur et par palier de vie.
      const paths = st.paths;
      for (let k = 0; k < paths.length; k++) paths[k] = null;
      const size = Math.max(1.2, Math.min(w, h) * 0.012);
      for (let i = 0; i < SPARKS_MAX; i++) {
        const o = i * 6;
        if (P[o + 4] <= 0) continue;
        P[o] += P[o + 2] * dt;
        P[o + 1] += P[o + 3] * dt;
        P[o + 3] *= 1 - 0.35 * dt; // ralentit en montant
        P[o + 4] -= dt * (0.35 + Math.random() * 0.1);
        if (P[o + 4] <= 0 || P[o + 1] < -0.05) {
          P[o + 4] = 0;
          st.count--;
          continue;
        }
        const life = P[o + 4];
        const step = Math.min(2, Math.floor(life * 3));
        const gi = P[o + 5] * 3 + step;
        const p = paths[gi] || (paths[gi] = new Path2D());
        const x = P[o] * w,
          y = P[o + 1] * h,
          r = size * (0.5 + life * 0.7);
        p.moveTo(x + r, y);
        p.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.globalCompositeOperation = 'lighter';
      ctx.shadowBlur = opts.glow ? 8 : 0;
      for (let gi = 0; gi < paths.length; gi++) {
        if (!paths[gi]) continue;
        const color = pal[Math.floor(gi / 3)];
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.globalAlpha = 0.3 + 0.35 * (gi % 3);
        ctx.fill(paths[gi]);
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },

    // Rosace : trois pétales de spectre superposés, symétriques, qui tournent
    // lentement autour du centre.
    rosace(ctx, w, h, a, pal, opts) {
      const cx = opts.cx ?? w / 2,
        cy = opts.cy ?? h / 2;
      const m = Math.min(w, h);
      const rm = opts.reduceMotion;
      const bands = a.bands(48);
      const r0 = m * 0.14 * (1 + (rm ? 0 : a.bass * 0.06));
      const len = m * 0.28;
      const n = 96;
      const t = rm ? 0 : opts.t || 0;
      ctx.lineJoin = 'round';
      for (let layer = 2; layer >= 0; layer--) {
        const scale = 1 - layer * 0.22;
        const rot = t * 0.00006 * (layer % 2 ? -1 : 1) + layer * 0.4;
        ctx.beginPath();
        let fx = 0,
          fy = 0;
        for (let i = 0; i <= n; i++) {
          const half = i % n < n / 2 ? i % n : n - (i % n); // symétrique
          const v = bands[Math.min(47, Math.floor((half / (n / 2)) * 48))];
          const ang = (i / n) * Math.PI * 2 - Math.PI / 2 + rot;
          const rr = r0 + (2 + v * len) * scale;
          const x = cx + Math.cos(ang) * rr,
            y = cy + Math.sin(ang) * rr;
          if (i === 0) {
            fx = x;
            fy = y;
            ctx.moveTo(x, y);
          } else ctx.lineTo(x, y);
        }
        ctx.lineTo(fx, fy);
        ctx.closePath();
        const color = pal[layer];
        ctx.fillStyle = withAlpha(color, 0.16 + (2 - layer) * 0.08);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.5, m * 0.004);
        ctx.shadowColor = color;
        ctx.shadowBlur = opts.glow ? 12 : 0;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      // Cœur : un cercle qui respire doucement (valeur lissée, jamais de clignotement).
      ctx.strokeStyle = pal[2];
      ctx.globalAlpha = 0.4 + (rm ? 0 : a.pulse) * 0.3;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(0, r0 - 6), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    },

    // Pochette ronde qui tourne, couronne de points et rayons en soleil qui
    // jaillissent avec le son, sur un halo aux couleurs de la pochette.
    // opts : cx, cy, radius, image, spin (lecture en cours), halo (couleur).
    disc(ctx, w, h, a, basePal, opts) {
      // Comme sur une pochette de vinyle : rayons et points aux couleurs de la pochette.
      const pal = opts.palette || basePal;
      const cx = opts.cx ?? w / 2,
        cy = opts.cy ?? h / 2;
      // Animations réduites : ni pulsation du disque, ni rotation, ni lueur qui bat.
      const rm = opts.reduceMotion;
      const pulse = rm ? 1 : 1 + a.bass * 0.06;
      const baseR = opts.radius ?? Math.min(w, h) * 0.12;
      const r = baseR * pulse;
      const t = opts.t || 0;
      const dt = Math.min(100, t - (discState.last || t));
      discState.last = t;
      if (opts.spin && !rm) discState.rot += dt * 0.00012; // ~1 tour en 50 s
      // Lueurs pilotées par les valeurs lissées de l'analyse (au plus quelques
      // éclats par seconde) et d'amplitude plafonnée : WCAG 2.3.1.
      const pl = rm ? 0 : a.pulse,
        lv = rm ? 0 : a.glowLevel;

      // Intensité (réglage) : longueur et densité de l'anneau (rayons, onde…).
      const k = Math.max(0.4, Math.min(2.2, opts.intensity ?? 1.3));

      // Halo : respire avec le niveau sonore. Indépendant de l'intensité (qui ne
      // règle que l'anneau) : toujours au niveau de l'intensité par défaut.
      const hk = 1.3;
      const haloR = r * (2.4 + 1.1 * hk + lv * 0.9 * hk);
      const halo = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, haloR);
      halo.addColorStop(0, withAlpha(opts.halo || pal[0], Math.min(0.8, (0.5 + pl * 0.2) * Math.sqrt(hk))));
      halo.addColorStop(0.4, withAlpha(opts.halo || pal[0], Math.min(0.5, 0.16 * hk)));
      halo.addColorStop(1, withAlpha(opts.halo || pal[0], 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
      ctx.fill();

      // Lueur du centre : un cœur presque blanc qui s'illumine avec le son.
      // Animations réduites : lueur fixe, sans pulsation.
      const bloom = Math.max(0, Math.min(1.5, opts.bloom ?? 0.8));
      if (bloom > 0) {
        const bR = r * (1.9 + lv * 0.8);
        const b = ctx.createRadialGradient(cx, cy, r * 0.9, cx, cy, bR);
        b.addColorStop(0, withAlpha('#ffffff', Math.min(0.55, bloom * (0.3 + pl * 0.2))));
        b.addColorStop(0.35, withAlpha(pal[2], Math.min(0.4, bloom * (0.18 + lv * 0.15))));
        b.addColorStop(1, withAlpha(pal[2], 0));
        ctx.fillStyle = b;
        ctx.beginPath();
        ctx.arc(cx, cy, bR, 0, Math.PI * 2);
        ctx.fill();
      }

      // Anneau autour de la pochette : onde, points, arcs ou ondes concentriques
      // (DISC_RINGS), sinon les rayons.
      const ring = Object.hasOwn(DISC_RINGS, opts.rays) ? DISC_RINGS[opts.rays] : null;
      if (ring) ring(ctx, { cx, cy, r, k, a, pal, t, dt, rm, glow: opts.glow !== false });
      // Rayons : traits fins et serrés (« fins ») ou barres épaisses et espacées
      // (« épais »), symétriques, basses en haut et en bas.
      else drawRays(ctx, cx, cy, r, k, a, pal, t, rm, opts);

      // Couronne de points.
      ctx.fillStyle = pal[2];
      const dots = 96;
      const dotR = Math.max(1, r * 0.012);
      ctx.beginPath();
      for (let i = 0; i < dots; i++) {
        const ang = (i / dots) * Math.PI * 2 + discState.rot * 0.5;
        const x = cx + Math.cos(ang) * (r + 5),
          y = cy + Math.sin(ang) * (r + 5);
        ctx.moveTo(x + dotR, y);
        ctx.arc(x, y, dotR, 0, Math.PI * 2);
      }
      ctx.fill();

      // Pochette ronde qui tourne : dessinée depuis un canvas hors écran, déjà
      // découpé en cercle à la bonne taille (au lieu de redimensionner l'image
      // de 500 px à chaque image).
      const sprite = coverSprite(opts.image, baseR, opts.dpr || 1);
      if (sprite) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(discState.rot);
        ctx.drawImage(sprite, -r, -r, r * 2, r * 2);
        ctx.restore();
      } else {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.clip();
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, pal[1]);
        g.addColorStop(1, pal[0]);
        ctx.fillStyle = g;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
        ctx.restore();
      }
      // Liseré sombre pour détacher la pochette des rayons.
      ctx.strokeStyle = 'rgba(0,0,0,.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    },
  };

  const discState = { rot: 0, last: 0 };

  // Pochette découpée en cercle, à la taille d'affichage (en pixels du canvas).
  // Régénérée seulement quand l'image ou le rayon change.
  const coverCache = { img: null, px: 0, canvas: null };
  function coverSprite(img, radius, dpr) {
    if (!img || !img.complete || !img.naturalWidth) return null;
    const px = Math.max(2, Math.round(radius * 2 * dpr));
    if (coverCache.img !== img || coverCache.px !== px || !coverCache.canvas) {
      const c = coverCache.canvas || document.createElement('canvas');
      c.width = c.height = px;
      const x = c.getContext('2d');
      x.clearRect(0, 0, px, px);
      x.save();
      x.beginPath();
      x.arc(px / 2, px / 2, px / 2, 0, Math.PI * 2);
      x.clip();
      x.drawImage(img, 0, 0, px, px);
      x.restore();
      coverCache.img = img;
      coverCache.px = px;
      coverCache.canvas = c;
    }
    return coverCache.canvas;
  }
  const blocksState = { peaks: null, groups: new Array(18).fill(null) };
  const spectrumState = { pts: new Float32Array(0) };

  // Étincelles : 6 valeurs par particule (x, y, vitesse x, vitesse y, vie,
  // couleur), positions de 0 à 1. Un état par canvas (les aperçus des réglages
  // en dessinent plusieurs à la fois), pré-rempli pour qu'une image figée
  // (animations réduites) montre déjà quelque chose.
  const SPARKS_MAX = 240;
  const sparksStates = new WeakMap();
  function sparksStateOf(ctx) {
    let st = sparksStates.get(ctx);
    if (!st) {
      st = { p: new Float32Array(SPARKS_MAX * 6), count: 0, last: 0, paths: new Array(9).fill(null) };
      for (let i = 0; i < 60; i++) {
        const o = i * 6;
        st.p.set([Math.random(), 0.2 + Math.random() * 0.8, 0, -0.15 - Math.random() * 0.2, Math.random(), i % 3], o);
        st.count++;
      }
      sparksStates.set(ctx, st);
    }
    return st;
  }

  // ================= Décors de la scène =================

  // Bord de l'écran lumineux qui pulse avec les basses.
  // La luminosité suit la basse lissée (a.pulse) avec une amplitude plafonnée :
  // pas de clignotement rapide (WCAG 2.3.1). `reduce` : bord fixe, sans pulsation.
  function drawEdgeGlow(ctx, w, h, a, pal, strength = 1, reduce = false) {
    const s = Math.max(0, Math.min(2, strength));
    if (!s) return;
    const p = reduce ? 0 : (a.pulse ?? a.bass);
    const thick = Math.min(w, h) * (0.035 + p * 0.02);
    const alpha = Math.min(0.6, s * (0.18 + p * 0.25));
    const edges = [
      [0, 0, 0, thick, 0, 0, w, thick, pal[0]],
      [0, h, 0, h - thick, 0, h - thick, w, thick, pal[1]],
      [0, 0, thick, 0, 0, 0, thick, h, pal[1]],
      [w, 0, w - thick, 0, w - thick, 0, thick, h, pal[0]],
    ];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const [x0, y0, x1, y1, rx, ry, rw, rh, c] of edges) {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, withAlpha(c, alpha));
      g.addColorStop(1, withAlpha(c, 0));
      ctx.fillStyle = g;
      ctx.fillRect(rx, ry, rw, rh);
    }
    ctx.restore();
  }

  // Anneaux qui vibrent autour de la petite pochette du panneau.
  function drawCoverRings(ctx, cx, cy, R, a, pal, reduce = false) {
    const bands = a.bands(16);
    ctx.save();
    ctx.lineWidth = Math.max(1.5, R * 0.025);
    for (let i = 0; i < 3; i++) {
      const v = reduce ? 0.15 : (bands[i * 2] + bands[i * 2 + 1]) / 2;
      const rr = R + 7 + i * (R * 0.11) + v * R * 0.12;
      ctx.strokeStyle = pal[i % 3];
      // Le flou de lueur n'est payé que quand l'anneau est visiblement animé.
      ctx.shadowColor = pal[i % 3];
      ctx.shadowBlur = v > 0.3 ? 10 : 0;
      ctx.globalAlpha = Math.min(0.8, 0.2 + v * 0.7) * (1 - i * 0.22);
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  window.SillonVisuals = { VISUALIZERS, drawEdgeGlow, drawCoverRings };
})();
