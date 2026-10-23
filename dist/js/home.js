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

  // ------------------------------------------------------------------ Top deals: 8 pinned prints, then all of them with the group chips
  FF.fetchJSON('data/home.json').then(home => {
    const deals = home.deals || [];
    const groups = [...new Set(deals.map(d => d.g).filter(Boolean))];
    // the 8 on the board: the best of each group in turn, so it is never eight sofas
    // owner rule (23 Oct): the 8 on the front are living room / dining room / bedroom furniture (no rugs, office pieces, sets, As Is / clearance / display items), AED 1,000-2,000, at least 50% off
    const front = deals.filter(d => d.g !== 'Rugs' && d.p >= 1000 && d.p <= 2000 && d.o > d.p && (d.o - d.p) / d.o >= 0.5 && !/\b(sets?|office|desk|gaming|study)\b/i.test(d.name) && !/\b(as[ -]is|clearance|open[ -]box|display[ -]?(item|piece|model|unit))\b/i.test(d.name));
    const fg = [...new Set(front.map(d => d.g))], queue = fg.map(g => front.filter(d => d.g === g)), pinned = [];
    for (let k = 0; pinned.length < Math.min(8, front.length) && k < 80; k++) { const q = queue[k % queue.length]; if (q && q.length) pinned.push(q.shift()); }
    let all = false, cur = '';
    const card = d => FF.pcCard({ id: d.id, name: d.name, store: d.store, img: FF.fixImg(d.i), price: d.p, orig: d.o, l3: d.cat });
    function draw() {
      const grid = $('dealGrid'), chips = $('dealChips'), btn = $('dealsAll');
      grid.classList.toggle('cp-pinned', !all);
      chips.hidden = !all || groups.length < 2;
      chips.innerHTML = [['', 'All']].concat(groups.map(g => [g, g]))
        .map(([g, t]) => `<button type="button" class="t2-chip${g === cur ? ' on' : ''}" data-g="${esc(g)}" aria-pressed="${g === cur}">${esc(t)}</button>`).join('');
      grid.innerHTML = (all ? deals.filter(d => !cur || d.g === cur) : pinned).map(card).join('');
      btn.hidden = deals.length <= pinned.length;
      btn.textContent = all ? 'Show fewer' : 'All deals';
    }
    $('dealChips').addEventListener('click', e => { const c = e.target.closest('.t2-chip'); if (c) { cur = c.dataset.g; draw(); } });
    $('dealsAll').addEventListener('click', () => { all = !all; cur = ''; draw(); if (!all) $('deals').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    draw();
    $('empty').hidden = deals.length > 0;
  }).catch(err => { console.error(err); $('empty').hidden = false; });
})();
