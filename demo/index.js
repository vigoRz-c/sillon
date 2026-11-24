// Browser demo of Sillon (see index.html). Loads the real chosen page
// (src/renderer/pages/*.html) in the iframe and injects fake-bridge.js before
// its scripts. No page is rewritten: each one's CSP applies as is, and the
// demo cannot drift from the application.
(function () {
  'use strict';

  const PAGE_FILES = {
    widget: 'widget.html',
    fullscreen: 'fullscreen.html',
    settings: 'settings.html',
    controls: 'controls.html',
  };
  const PAGES_DIR = new URL('../src/renderer/pages/', location.href);
  const FAKE_BRIDGE = new URL('fake-bridge.js', location.href).href;

  const $ = (id) => document.getElementById(id);
  const frame = $('frame');
  const catalog = window.SillonCatalog;

  function fillSelect(select, items, value) {
    select.textContent = '';
    for (const [id, label] of items) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = label;
      select.appendChild(option);
    }
    select.value = value;
  }

  const initial = new URLSearchParams(location.search);
  fillSelect($('style'), catalog.STYLES, initial.get('style') || 'bars');
  fillSelect($('theme'), catalog.THEMES, initial.get('theme') || 'wallpaper');
  if (initial.get('page') && PAGE_FILES[initial.get('page')]) $('page').value = initial.get('page');
  if (initial.get('mode')) $('mode').value = initial.get('mode');

  // Parameters read by fake-bridge.js in the parent page (same origin).
  function currentParams() {
    return new URLSearchParams({
      page: $('page').value,
      style: $('style').value,
      theme: $('theme').value,
      mode: $('mode').value,
    });
  }

  function resumeAudio() {
    const resumed =
      frame.contentWindow && frame.contentWindow.sillonDemo && frame.contentWindow.sillonDemo.resumeAudio();
    if (resumed) $('hint').hidden = true;
  }

  async function load() {
    $('error').hidden = true;
    const params = currentParams();
    history.replaceState(null, '', `?${params}`);
    try {
      const res = await fetch(new URL(PAGE_FILES[params.get('page')], PAGES_DIR));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // <base>: the page's relative links (../style.css, ../shared/…) stay the application's.
      const inject = `<base href="${PAGES_DIR.href}"><script src="${FAKE_BRIDGE}"></script>`;
      const html = (await res.text()).replace(/<head[^>]*>/i, (head) => head + inject);
      const doc = frame.contentDocument;
      doc.open();
      doc.write(html);
      doc.close();
      doc.addEventListener('pointerdown', resumeAudio);
    } catch (e) {
      $('error').textContent =
        `Could not load the page: ${e.message}. Run the demo from an HTTP server (see index.html).`;
      $('error').hidden = false;
    }
  }

  for (const id of ['page', 'style', 'theme', 'mode']) $(id).addEventListener('change', load);
  document.addEventListener('pointerdown', resumeAudio);
  // The pages ask to change screens (open the settings, leave the full screen).
  window.addEventListener('sillon-demo', (e) => {
    if (PAGE_FILES[e.detail.page]) {
      $('page').value = e.detail.page;
      load();
    }
  });

  load();
})();
