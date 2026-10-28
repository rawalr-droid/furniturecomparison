// Homepage (couchpotato.ae look, brand book 2026-10-09): Japandi hero with price dots, Shop by room, the mood panel, Top deals.
// Everything shown is live data: data/meta.json (counts), data/boards/* (the hero room and the moods), data/rooms.json (room counts),
// data/home.json (deals). Nothing here is hard-coded except the room photos (js/home-tiles.js) and the hero's shortcut pills.
(function () {
  'use strict';
  const { esc, enc, $, money } = FF;
  const num = n => Number(n).toLocaleString('en-AE');
  const off = d => (d.orig > d.price ? Math.round((d.orig - d.price) / d.orig * 100) : 0);

  // ------------------------------------------------------------------ hero: a room photo with its real pieces as dots
  // Tap a dot: "the piece in this room" (the product the room scene was built from) and similar pieces at OTHER stores
  // (the same similar-items lists the product pages use: database first, the published files as the fallback).
  let storeCount = 0;
  FF.loadMeta().then(m => {
    const live = m.stores.filter(s => s.c > 0);                       // only stores that have products on the site
    storeCount = live.length;
    if ($('heroCount')) $('heroCount').textContent = storeCount;
    const names = live.slice().sort((a, b) => b.c - a.c).map(s => `<span>${esc(s.n)}</span>`).join('');
    $('storeList').innerHTML = names + names;                           // twice, so the strip loops without a gap
    moodCopy();
  }).catch(() => {});

  // hero: one static banner (no room switcher)

  // ------------------------------------------------------------------ Shop by room: 8 photo cards (photos chosen in js/home-tiles.js)
  const ROOMS = ['Living Room', 'Bedroom', 'Dining Room', 'Home Office', 'Kids Room', 'Kitchen', 'Bathroom', 'Outdoor'];
  FF.loadRooms().then(() => {
    const by = new Map((window.FF_HOME_ROOMS || []).map(t => [t.n, t]));
    $('roomRow').innerHTML = ROOMS.filter(n => by.has(n)).map(n => {
      const t = by.get(n), k = (FF.rooms.rooms[n] || {}).n;
      return `<a class="cp-room" href="${esc(t.c)}"><img referrerpolicy="no-referrer" loading="lazy" src="${esc(t.i)}" alt="" onerror="this.remove()">
        <span class="cp-rl"><b>${esc(n)}</b>${k ? `<small>${num(k)} pieces →</small>` : '<small>Shop →</small>'}</span></a>`;
    }).join('');
  });

  // ------------------------------------------------------------------ Collections and Popular searches (fixed lists, js/home-tiles.js)
  $('colRow').innerHTML = (window.FF_HOME_COLLECTIONS || []).map(c => `<a class="cp-col" href="${esc(c.c)}"><img referrerpolicy="no-referrer" loading="lazy" src="${esc(c.i)}" alt="" onerror="this.remove()">
    <span class="cp-cl"><b>${esc(c.n)}</b><small>Shop the collection →</small></span></a>`).join('');
  $('termRow').innerHTML = (window.FF_HOME_TERMS || []).map(t => `<a href="browse.html?q=${enc(t)}">${esc(t)}</a>`).join('');

  // ------------------------------------------------------------------ Shop by mood: the panel takes the mood's colour
  // colour + text tone come with the boards data (agents/state/labels/moodboards.json); the table is the fallback for a board without one
  const MOOD = { japandi: ['#A9B79A', 'dark'], earthy: ['#B5532B', 'light'], scandinavian: ['#BFD8E8', 'dark'], midcentury: ['#E0A526', 'dark'],
    boucle: ['#E9DCC8', 'dark'], bohemian: ['#8F3E1E', 'light'], coastal: ['#2F6DA3', 'light'], colourpop: ['#2B4BE0', 'light'] };
  let moods = [];
  function moodCopy() {
    if (!moods.length || !storeCount) return;
    $('moodCopy').textContent = `We've pulled together ${moods.length} of the most-loved home styles from leading UAE stores. Pick the one that feels like you. Every piece is real and priced.`;
  }
  function setMood(i) {
    const m = moods[i], sec = $('moods'), img = $('moodImg');
    const [colour, tone] = [m.colour || (MOOD[m.key] || [])[0] || '#FFFFFF', m.tone || (MOOD[m.key] || [])[1] || 'dark'];
    sec.style.background = colour; sec.classList.toggle('light', tone === 'light'); sec.classList.toggle('dark', tone !== 'light');
    document.querySelectorAll('#moodChips .cp-mchip').forEach((c, k) => { c.classList.toggle('on', k === i); c.setAttribute('aria-pressed', k === i); });
    img.style.opacity = 0;
    setTimeout(() => { img.src = m.image; img.alt = m.name + ' living room'; img.style.opacity = 1; }, 160);
    $('moodName').textContent = m.name; $('moodLine').textContent = m.line;
    $('moodPrice').textContent = `${money(m.total)} · ${m.pieces} pieces`;
    $('moodLink').href = 'board.html?b=' + enc(m.key);
  }
  FF.fetchJSON('data/boards/index.json').then(d => {
    moods = d.boards || [];
    if (!moods.length) return;
    $('moodChips').innerHTML = moods.map((m, i) => `<button type="button" class="cp-mchip" data-i="${i}" aria-pressed="false"><i style="background:${esc(m.colour || (MOOD[m.key] || ['#fff'])[0])}"></i>${esc(m.name)}</button>`).join('');
    $('moodChips').addEventListener('click', e => { const c = e.target.closest('.cp-mchip'); if (c) setMood(Number(c.dataset.i)); });
    $('moods').hidden = false; $('moodLabel').hidden = false;
    setMood(Math.max(0, moods.findIndex(m => m.key === 'boucle')));
    moodCopy();
  }).catch(() => {});

  // ------------------------------------------------------------------ Top deals: 18 on the front (editorial grid), then all of them with the group chips
  FF.fetchJSON('data/home.json').then(home => {
    const deals = home.deals || [];
    const groups = [...new Set(deals.map(d => d.g).filter(Boolean))];
    // the 8 on the board: the best of each group in turn, so it is never eight sofas
    // The 18 on the front change every day: the nightly job keeps a pool of ~40 front-row-eligible deals (home.json "pool": living / dining / bedroom
    // furniture, no sets, office pieces or As Is items, AED 1,000-2,000, 50-80% off) and the page picks 8 from it with the Dubai date as the seed,
    // one per kind first, at most 2 per store. Without a pool (or under 8 in it) it falls back to the filtered deals list.
    const dayKey = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date()).replace(/-/g, ''));
    const rng = seed => { let x = seed >>> 0; return () => { x = (Math.imul(x ^ x >>> 15, x | 1) + 0x6D2B79F5) >>> 0; return ((x ^ x >>> 7) >>> 0) / 4294967296; }; };
    const pool = home.pool || [], N = 18;
    let pinned = [];
    if (pool.length >= N) {
      const r = rng(dayKey), order = pool.map(c => ({ c, k: r() })).sort((a, b) => a.k - b.k).map(x => x.c), kinds = new Set(), perStore = {};
      for (const c of order) if (pinned.length < N && !kinds.has(c.t) && (perStore[c.store] || 0) < 2) { pinned.push(c); kinds.add(c.t); perStore[c.store] = (perStore[c.store] || 0) + 1; }
      for (const cap of [2, 3, 4]) for (const c of order) if (pinned.length < N && !pinned.includes(c) && (perStore[c.store] || 0) < cap) { pinned.push(c); perStore[c.store] = (perStore[c.store] || 0) + 1; }
    } else {
      const front = deals.filter(d => d.g !== 'Rugs' && d.p >= 1000 && d.p <= 2000 && d.o > d.p && (d.o - d.p) / d.o >= 0.5 && !/\b(sets?|office|desk|gaming|study)\b/i.test(d.name) && !/\b(as[ -]is|clearance|open[ -]box|display[ -]?(item|piece|model|unit))\b/i.test(d.name));
      const fg = [...new Set(front.map(d => d.g))], queue = fg.map(g => front.filter(d => d.g === g));
      for (let k = 0; pinned.length < Math.min(N, front.length) && k < 200; k++) { const q = queue[k % queue.length]; if (q && q.length) pinned.push(q.shift()); }
    }
    // editorial rhythm on the front 18 (owner approved mockup, 28 Oct): the 5th and the 14th deal open as feature tiles. A feature needs four cards after it
    // (on desktop it spans two columns and two rows with those four beside it); the second one sits on the right. couchpotato.css does the layout.
    function features(grid) {
      const cs = [...grid.children];
      [4, 13].forEach((i, k) => {
        const c = cs[i]; if (!c || cs.length < i + 5) return;
        c.classList.add('is-feature'); if (k) c.classList.add('r');
        const im = c.querySelector('.pc-media img'); if (!im) return;
        const wide = () => { if (im.naturalWidth && im.naturalWidth / im.naturalHeight > 1.2) c.classList.add('is-wide'); };
        if (im.complete) wide(); else im.addEventListener('load', wide, { once: true });
      });
    }
    let all = false, cur = '';
    const card = d => FF.pcCard({ id: d.id, name: d.name, store: d.store, img: FF.fixImg(d.i), price: d.p, orig: d.o, l3: d.cat });
    function draw() {
      const grid = $('dealGrid'), chips = $('dealChips'), btn = $('dealsAll');
      grid.classList.toggle('cp-pinned', !all);
      chips.hidden = !all || groups.length < 2;
      chips.innerHTML = [['', 'All']].concat(groups.map(g => [g, g]))
        .map(([g, t]) => `<button type="button" class="t2-chip${g === cur ? ' on' : ''}" data-g="${esc(g)}" aria-pressed="${g === cur}">${esc(t)}</button>`).join('');
      grid.innerHTML = (all ? deals.filter(d => !cur || d.g === cur) : pinned).map(card).join('');
      if (!all) features(grid);
      btn.hidden = deals.length <= pinned.length;
      btn.textContent = all ? 'Show fewer' : 'All deals';
    }
    $('dealChips').addEventListener('click', e => { const c = e.target.closest('.t2-chip'); if (c) { cur = c.dataset.g; draw(); } });
    $('dealsAll').addEventListener('click', () => { all = !all; cur = ''; draw(); if (!all) $('deals').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    draw();
    $('empty').hidden = deals.length > 0;
  }).catch(err => { console.error(err); $('empty').hidden = false; });
})();
