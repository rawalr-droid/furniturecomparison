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
    $('storeList').innerHTML = live.slice().sort((a, b) => b.c - a.c).map(s => `<span>${esc(s.n)}</span>`).join('');
    moodCopy();
  }).catch(() => {});

  const HERO_ROOMS = ['japandi', 'scandinavian', 'boucle', 'earthy'];
  const SLOT = { sofa: ['Sofa', 'furniture--sofas-seating'], chair: ['Armchair', 'furniture--sofas-seating'], coffee_table: ['Coffee table', 'furniture--living-room'],
    side_table: ['Side table', 'furniture--living-room'], floor_lamp: ['Floor lamp', 'lighting--lamps'], rug: ['Rug', 'rugs-carpets--rugs'], plant: ['Plant', 'home-decor--plants-flowers'] };
  const rh = $('rh'), rp = $('rp'), rd = $('rd'), pn = $('pn'), sw2 = $('sw2');
  let scenes = [], cur = 0, sel = 0, token = 0;
  const simCache = {};
  const norm = r => ({ id: r.id, name: r.name || r.n, store: r.store || (FF.stores && FF.stores[r.s]) || '', price: r.price != null ? r.price : r.p, orig: r.orig != null ? r.orig : r.o, img: FF.fixImg(r.img || r.i), out: !!r.out });
  function similarFor(a) {
    return simCache[a.id] || (simCache[a.id] = (async () => {
      let rows = [];
      if (FF.db.on) { try { const r = await FF.db.rpc('product_detail', { p_id: a.id }, 4000, 1); rows = (r && r.similar || []).map(norm); } catch (e) { FF.db.fail(e); } }
      if (rows.length < 2) {
        await FF.loadMeta();
        const lists = await FF.fetchJSON('data/s/' + String(FF.fnv(a.id) % 256).padStart(3, '0') + '.json.gz');
        await FF.loadShard(SLOT[a.slot][1]);
        rows = (lists[a.id] || []).map(id => FF.byId.get(id)).filter(Boolean).map(norm);
      }
      const seen = new Set([a.store]), out = [];
      for (const r of rows) { if (!r.img || r.out || !(r.price > 0) || seen.has(r.store)) continue; seen.add(r.store); out.push(r); if (out.length === 4) break; }
      return out;
    })());
  }
  pn.addEventListener('click', e => { const b = e.target.closest('.pcs button'); if (b) { sel = Number(b.dataset.i); renderPanel(); placeDots(); } });
  const link = id => 'product.html?id=' + enc(id);
  function renderPanel() {
    const a = scenes[cur].anchors[sel], mine = ++token, label = SLOT[a.slot] ? SLOT[a.slot][0] : a.slot;
    const hp = a.orig > a.price ? Math.round((a.orig - a.price) / a.orig * 100) : 0;
    const chips = `<div class="pcs" role="group" aria-label="Pieces in this room">${scenes[cur].anchors.map((x, i) => `<button type="button" data-i="${i}" aria-pressed="${i === sel}">${i + 1} ${esc((SLOT[x.slot] || [x.slot])[0])}</button>`).join('')}</div>`;
    const head = `<div class="h"><small>The piece in this room</small><b>${esc(label)}</b></div>${chips}
      <div class="hero2"><img referrerpolicy="no-referrer" src="${esc(FF.fixImg(a.img))}" alt=""><div style="min-width:0"><div class="s">${esc(a.store)}</div><div class="n2">${esc(a.name)}</div>
        <div class="p2">${money(a.price)}${hp ? `<s>${money(a.orig)}</s>` : ''}</div><a class="vb" href="${link(a.id)}">View this piece</a></div></div>`;
    pn.innerHTML = head + '<div class="sh2"><b>Similar pieces at other stores</b><span>looking…</span></div>';
    similarFor(a).then(sim => {
      if (mine !== token) return;
      const rowsHtml = sim.map(c => { const d = c.price - a.price;
        const t = d < 0 ? `<i class="dn">${money(-d)} less</i>` : d > 0 ? `<i>+${money(d)}</i>` : '<i>Same price</i>';
        return `<a class="r" href="${link(c.id)}"><img loading="lazy" referrerpolicy="no-referrer" src="${esc(c.img)}" alt="" onerror="this.remove()"><span style="min-width:0"><span class="s">${esc(c.store)}</span><span class="n">${esc(c.name)}</span></span><span class="p">${money(c.price)}${t}</span></a>`; }).join('');
      pn.innerHTML = head + (sim.length ? `<div class="sh2"><b>Similar pieces at other stores</b><span>${sim.length} ${sim.length === 1 ? 'match' : 'matches'}</span></div>${rowsHtml}` : '<div class="sh2"><b>No close matches at other stores yet</b></div>') + '<div class="f">Prices come from each store\'s website and can change.</div>';
      placeDots();
    }).catch(() => { if (mine === token) pn.innerHTML = head + '<div class="f">Similar pieces are unavailable right now.</div>'; });
  }
  function placeDots() {
    const b = scenes[cur]; if (!b) return;
    const W = rh.clientWidth, H = rh.clientHeight, k = Math.max(W / b.w, H / b.h), ox = (W - b.w * k) / 2, oy = (H - b.h * k) / 2, hr = rh.getBoundingClientRect();
    const blocked = [document.querySelector('.rc'), pn].map(e => { const r = e.getBoundingClientRect(); return [r.left - hr.left - 20, r.top - hr.top - 20, r.right - hr.left + 20, r.bottom - hr.top + 20]; });
    rd.innerHTML = '';
    b.anchors.forEach((a, i) => {
      const x = ox + a.x / 100 * b.w * k, y = oy + a.y / 100 * b.h * k;
      if (x < 30 || x > W - 30 || y < 30 || y > H - 90 || blocked.some(r => x > r[0] && x < r[2] && y > r[1] && y < r[3])) return;
      const d = document.createElement('button'); d.type = 'button'; d.className = 'dt' + (i === sel ? ' sel' : ''); d.textContent = i + 1;
      d.style.left = x + 'px'; d.style.top = y + 'px'; d.setAttribute('aria-label', (SLOT[a.slot] || [a.slot])[0]);
      d.addEventListener('click', () => { sel = i; renderPanel(); placeDots(); }); rd.appendChild(d);
    });
  }
  function showScene() {
    [...rp.children].forEach((im, i) => im.classList.toggle('on', i === cur));
    [...sw2.children].forEach((bt, i) => { bt.classList.toggle('on', i === cur); bt.setAttribute('aria-pressed', i === cur); });
    renderPanel(); placeDots();
  }
  Promise.all(HERO_ROOMS.map(k => FF.fetchJSON('data/boards/' + k + '.json').catch(() => null))).then(list => {
    scenes = list.filter(b => b && b.anchors && b.anchors.length);
    if (!scenes.length) { rh.hidden = true; return; }
    scenes.forEach((b, i) => {
      const im = new Image(); im.alt = ''; im.src = b.image; im.addEventListener('load', placeDots); rp.appendChild(im);
      const bt = document.createElement('button'); bt.type = 'button'; bt.innerHTML = `<img src="${esc(b.image)}" alt="">${esc(b.name)}`;
      bt.addEventListener('click', () => { cur = i; sel = 0; showScene(); }); sw2.appendChild(bt);
    });
    showScene();
    window.addEventListener('resize', placeDots);
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
