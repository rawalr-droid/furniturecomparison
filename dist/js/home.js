// Homepage (couchpotato.ae look, brand book 2026-10-09): Japandi hero with price dots, Shop by room, the mood panel, Top deals.
// Everything shown is live data: data/meta.json (counts), data/boards/* (the hero room and the moods), data/rooms.json (room counts),
// data/home.json (deals). Nothing here is hard-coded except the room photos (js/home-tiles.js) and the hero's shortcut pills.
(function () {
  'use strict';
  const { esc, enc, $, money } = FF;
  const num = n => Number(n).toLocaleString('en-AE');
  const off = d => (d.orig > d.price ? Math.round((d.orig - d.price) / d.orig * 100) : 0);

  // ------------------------------------------------------------------ intro: eyebrow, store strip, live price comparison
  let storeCount = 0;
  FF.loadMeta().then(m => {
    const live = m.stores.filter(s => s.c > 0);                       // only stores that have products on the site
    storeCount = live.length;
    $('introEy').textContent = `${storeCount} UAE home stores, one place`;
    const names = live.slice().sort((a, b) => b.c - a.c).map(s => `<span>${esc(s.n)}</span>`).join('');
    $('storeMq').innerHTML = names + names;                           // twice, so the strip loops without a gap
    moodCopy();
  }).catch(() => {});

  // Each chip compares one kind of piece: the lowest price at each store, from the published category files (real products, in stock).
  const CMP = [
    { t: 'Sofa', title: '3-seater sofa', shard: 'furniture--sofas-seating', yes: /\b(3|three)[ -]?seat(er|s)?\b/i, no: /cover|throw|cushion|pillow|slipcover|leg|bed\b/i },
    { t: 'Dining table', title: 'dining table', shard: 'furniture--dining-room', yes: /dining table/i, no: /chair|bench|set of|with \d? ?chairs|cover|runner|mat\b/i },
    { t: 'Rug', title: 'rug', shard: 'rugs-carpets--rugs', yes: /\brug\b/i, no: /pad|gripper|underlay|cleaner/i },
    { t: 'Bed frame', title: 'bed', shard: 'furniture--bedroom', yes: /\bbed( frame)?\b/i, no: /bedside|side ?table|linen|sheet|bench|mattress|cover|cushion|pillow|set\b|runner|lamp/i }
  ];
  const cmpEl = $('cmp'), chipEl = $('introChips');
  const cache = {};
  chipEl.innerHTML = CMP.map((c, i) => `<button type="button" data-i="${i}" aria-pressed="false">${esc(c.t)}</button>`).join('');
  function rowsFor(c) {
    return cache[c.shard] || (cache[c.shard] = FF.loadMeta().then(() => FF.loadShard(c.shard)).then(raw => {
      const all = raw.filter(r => r.price > 0 && !r.out && r.img && c.yes.test(r.name) && !c.no.test(r.name));
      const sorted = all.map(r => r.price).sort((a, b) => a - b), floor = (sorted[Math.floor(sorted.length / 2)] || 0) * 0.3;   // drop accessories priced far below the typical piece
      const best = new Map();
      all.filter(r => r.price >= floor).forEach(r => { const o = best.get(r.s); if (!o || r.price < o.price) best.set(r.s, r); });
      return [...best.values()].sort((a, b) => a.price - b.price).slice(0, 5);
    }));
  }
  let token = 0;
  function showCmp(i) {
    const c = CMP[i], mine = ++token;
    [...chipEl.children].forEach((b, k) => b.setAttribute('aria-pressed', k === i));
    rowsFor(c).then(rows => {
      if (mine !== token) return;
      if (rows.length < 2) { cmpEl.innerHTML = ''; return; }
      const min = rows[0].price, max = rows[rows.length - 1].price;
      cmpEl.innerHTML = `<div class="cp-ch"><b>Lowest price at each store: ${esc(c.title)}</b><span>${rows.length} stores · ${money(min)} to ${money(max)}</span></div>` + rows.map((r, k) => {
        const w = Math.round(30 + 70 * (r.price - min) / (max - min || 1));
        return `<a class="cp-cr${k ? '' : ' best'}" href="product.html?id=${enc(r.id)}" style="animation-delay:${k * 70}ms">
          <span class="cp-cph"><img referrerpolicy="no-referrer" loading="lazy" src="${esc(r.img)}" alt="" onerror="this.remove()"></span>
          <span class="cp-cm"><span class="cp-cn">${esc(r.name)}</span><span class="cp-cs">${esc(r.store)}${k ? '' : ' <i>Lowest</i>'}</span><span class="cp-cb"><u style="width:${w}%"></u></span></span>
          <span class="cp-cp">${money(r.price)}${k && r.price - min >= 1 ? `<small>+${money(r.price - min)}</small>` : ''}</span></a>`;
      }).join('') + '<p class="cp-cf">Prices come from each store\'s website and can change.</p>';
    }).catch(() => { if (mine === token) cmpEl.innerHTML = ''; });
  }
  chipEl.addEventListener('click', e => { const b = e.target.closest('button'); if (b) showCmp(Number(b.dataset.i)); });
  showCmp(0);

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
