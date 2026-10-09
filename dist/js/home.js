// Homepage (couchpotato.ae look, brand book 2026-10-09): Japandi hero with price dots, Shop by room, the mood panel, Top deals.
// Everything shown is live data: data/meta.json (counts), data/boards/* (the hero room and the moods), data/rooms.json (room counts),
// data/home.json (deals). Nothing here is hard-coded except the room photos (js/home-tiles.js) and the hero's shortcut pills.
(function () {
  'use strict';
  const { esc, enc, $, money } = FF;
  const num = n => Number(n).toLocaleString('en-AE');
  const off = d => (d.orig > d.price ? Math.round((d.orig - d.price) / d.orig * 100) : 0);

  // ------------------------------------------------------------------ hero: ribbon, shortcut pills
  const PILLS = [['Sofas', 'furniture/sofas-seating/sofas', 'Living Room'], ['Beds', 'furniture/bedroom/beds', 'Bedroom'],
    ['Dining tables', 'furniture/dining-room/dining-tables', 'Dining Room'], ['Coffee tables', 'furniture/living-room/coffee-tables', 'Living Room'],
    ['Armchairs', 'furniture/sofas-seating/armchairs-accent-chairs', 'Living Room'], ['Wardrobes', 'furniture/bedroom/wardrobes', 'Bedroom']];
  let storeCount = 0;
  FF.loadMeta().then(m => {
    storeCount = m.stores.filter(s => s.c > 0).length;                // only stores that have products on the site
    $('heroRibbon').textContent = `Prices checked every night · ${num(m.total)} products · ${storeCount} UAE stores`;
    $('heroPills').innerHTML = '<a href="browse.html">All</a>' + PILLS.filter(p => FF.node(p[1]).l3)
      .map(([t, c, room]) => `<a href="browse.html?c=${enc(c)}&amp;room=${enc(room)}">${esc(t)}</a>`).join('');
    moodCopy();
  }).catch(() => {});

  // ------------------------------------------------------------------ hero: the Japandi room's real products as numbered dots
  // The photo fills the hero (object-fit: cover), so a dot's place is worked out from the photo's own size and the crop.
  const heroImg = $('heroImg'), dotsEl = $('heroDots');
  function placeDots() {
    const W = heroImg.clientWidth, H = heroImg.clientHeight, w = heroImg.naturalWidth, h = heroImg.naturalHeight;
    if (!W || !w) return;
    const s = Math.max(W / w, H / h), pos = getComputedStyle(heroImg).objectPosition.split(' ').map(v => parseFloat(v) / 100);
    const x0 = (W - w * s) * (isNaN(pos[0]) ? .5 : pos[0]), y0 = (H - h * s) * (isNaN(pos[1]) ? .5 : pos[1]);
    const box = heroImg.getBoundingClientRect();                      // the headline, line and button: a dot never sits on top of them
    const words = [...document.querySelectorAll('#hero .cp-hero-in > *')].map(e => e.getBoundingClientRect()).filter(r => r.width);
    dotsEl.querySelectorAll('.cp-dot').forEach(d => {
      const x = x0 + d.dataset.x / 100 * w * s, y = y0 + d.dataset.y / 100 * h * s;
      d.style.left = x + 'px'; d.style.top = y + 'px';
      d.hidden = x < 16 || x > W - 16 || y < 56 || y > H - 70        // off the visible part of the photo, or under the ribbon / pills
        || words.some(r => x + box.left > r.left - 18 && x + box.left < r.right + 18 && y + box.top > r.top - 18 && y + box.top < r.bottom + 18);
      d.classList.toggle('left', x > W * .7); d.classList.toggle('below', y < H * .5);
    });
  }
  FF.fetchJSON('data/boards/japandi.json').then(b => {
    const shown = (b.anchors || []).filter(a => a.inStock);
    dotsEl.innerHTML = shown.map((a, i) => `<div class="cp-dot" data-x="${a.x}" data-y="${a.y}">
      <button type="button" aria-label="${esc(a.name)} from ${esc(a.store)}, ${money(a.price)}">${i + 1}</button>
      <div class="cp-pop"><img referrerpolicy="no-referrer" loading="lazy" src="${esc(FF.fixImg(a.img))}" alt="" onerror="this.remove()">
        <strong>${esc(FF.cleanName(a.name))}</strong><span>${esc(a.store)} · ${esc(a.l3)}</span>
        <span class="cp-pp">${money(a.price)}${off(a) ? ` <s>${money(a.orig)}</s>` : ''}</span>
        <span class="cp-pl2"><a href="product.html?id=${enc(a.id)}">Details</a>${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener nofollow sponsored">View at ${esc(a.store)} ↗</a>` : ''}</span></div></div>`).join('');
    const tot = $('heroTotal');
    tot.innerHTML = `${esc(b.name)} living room · <b>${money(b.total)}</b> · ${shown.length} pieces`; tot.hidden = false;
    if (heroImg.complete) placeDots(); else heroImg.addEventListener('load', placeDots);
    window.addEventListener('resize', placeDots);
  }).catch(() => {});
  document.addEventListener('click', e => {                           // a tap opens one dot's card and closes the others
    const b = e.target.closest('.cp-dot > button');
    document.querySelectorAll('.cp-dot.open').forEach(d => { if (!b || d !== b.parentElement) d.classList.remove('open'); });
    if (b) b.parentElement.classList.toggle('open');
  });

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
    $('moodCopy').textContent = `We've pulled together ${moods.length} of the most-loved home styles from ${storeCount} UAE stores. Pick the one that feels like you. Every piece is real and priced tonight.`;
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
    $('moods').hidden = false;
    setMood(Math.max(0, moods.findIndex(m => m.key === 'earthy')));
    moodCopy();
  }).catch(() => {});

  // ------------------------------------------------------------------ Top deals: 8 pinned prints, then all of them with the group chips
  FF.fetchJSON('data/home.json').then(home => {
    const deals = home.deals || [];
    const groups = [...new Set(deals.map(d => d.g).filter(Boolean))];
    // the 8 on the board: the best of each group in turn, so it is never eight sofas
    const queue = groups.map(g => deals.filter(d => d.g === g)), pinned = [];
    for (let k = 0; pinned.length < Math.min(8, deals.length) && k < 60; k++) { const q = queue[k % queue.length]; if (q && q.length) pinned.push(q.shift()); }
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
      btn.textContent = all ? 'Show fewer' : `See all ${deals.length} deals`;
    }
    $('dealChips').addEventListener('click', e => { const c = e.target.closest('.t2-chip'); if (c) { cur = c.dataset.g; draw(); } });
    $('dealsAll').addEventListener('click', () => { all = !all; cur = ''; draw(); if (!all) $('deals').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    draw();
    $('empty').hidden = deals.length > 0;
  }).catch(err => { console.error(err); $('empty').hidden = false; });
})();
