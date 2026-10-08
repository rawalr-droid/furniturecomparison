(function () {
  'use strict';
  const { esc, enc, money, $ } = FF;
  const PAGE = 24;
  const SORTS = ['price-low', 'price-high', 'discount', 'saving', 'name'];
  const params = new URLSearchParams(location.search);
  const many = k => (params.get(k) || '').split(',').map(s => s.trim()).filter(Boolean);        // "store=a,b"; an old single value still works
  const state = {
    q: params.get('q') || '', cat: (window.FF_CAT_REDIRECTS || {})[params.get('c')] || params.get('c') || '',
    room: many('room'), store: many('store'), size: many('size'), price: many('price').filter(t => /^\d+-\d*$/.test(t)),
    disc: Math.max(0, Math.min(80, parseInt(params.get('disc'), 10) || 0)), sale: params.get('deals') === '1',
    sort: SORTS.includes(params.get('sort')) ? params.get('sort') : 'featured', shown: PAGE, compare: [],
    via: params.get('via') || ''          // the room page a shared category was opened from (curtains): only for the trail, it filters nothing
  };
  const els = {
    grid: $('productGrid'), count: $('resultCount'), label: $('resultLabel'), status: $('loadStatus'), search: $('searchInput'),
    sort: $('sortSelect'), load: $('loadMore'), empty: $('emptyState'), active: $('activeFilters'), drops: $('ffDrops'), list: $('ffList'),
    drawer: $('ffDrawer'), ov: $('ffOv'), show: $('ffShow'),
    compareCount: $('compareCount'), compareTrigger: $('compareTrigger'), compareDialog: $('compareDialog')
  };
  let token = 0;
  let cache = { key: '', rows: [], facets: null };
  let dbv = null;            // database mode: { items, total } of the current view (null = published-files mode)
  let facets = null;         // counts for the filter bar of the current scope (category + search + deals), same shape in both modes
  let facetKey = '', barSig = '';
  // Room pages (owner, 2026-10-08): with exactly one room ticked and no category chosen, the page shows that room's picture tiles
  // (data/rooms.json, built nightly by agents/ff_agents/rooms.py); a tile opens its category with the room still ticked.
  // A tile either keeps the room ticked (t.f: "Bedroom > Benches" = the bedroom benches) or, for a category that several rooms share
  // (curtains), opens the whole category and only remembers the room it came from (state.via).
  let ROOMS = null;
  const oneRoom = () => (state.room.length === 1 ? state.room[0] : '');
  const roomHome = () => (oneRoom() && !state.cat && !state.q.trim() ? oneRoom() : '');
  const cameFrom = () => (state.via && state.cat && !state.room.length && !state.q.trim() && FF.meta && FF.meta.rooms.includes(state.via) ? state.via : '');

  // ------------------------------------------------------------------ filter set-up (PRD 5.9): js/filters.json says which filters a category shows
  let CFG = {
    priceBands: [[0, 999], [1000, 2499], [2500, 4999], [5000, 9999], [10000, null]], discounts: [10, 25, 50],
    default: { bar: ['store', 'price', 'disc', 'room'], more: ['size'] }, search: { bar: ['cat', 'store', 'price', 'disc'], more: ['size', 'room'] }, categories: {}
  };
  const loadCfg = fetch('js/filters.json?v=' + encodeURIComponent(FF.v || '')).then(r => (r.ok ? r.json() : null))
    .then(c => { if (c && c.default && Array.isArray(c.priceBands)) CFG = Object.assign(CFG, c); }).catch(() => {});
  const NAMES = { store: 'Store', price: 'Price', disc: 'Discount range', room: 'Room', cat: 'Category', size: 'Size' };
  function catCfg() {
    const n = FF.node(state.cat), names = [n.l1, n.l2, n.l3].filter(Boolean).map(x => x.n);
    let c = null;
    for (let i = names.length; i > 0 && !c; i--) c = (CFG.categories || {})[names.slice(0, i).join(' > ')];
    const base = state.q.trim() ? CFG.search : c || CFG.default;
    return { bar: base.bar || [], more: base.more || [], sizeLabel: (c && c.sizeLabel) || 'Size', sizeTile: (c && c.sizeTile) || '{size}' };
  }
  const label = k => (k === 'size' ? catCfg().sizeLabel : NAMES[k]);
  const num = n => Number(n).toLocaleString('en-AE');
  const edges = () => CFG.priceBands.slice(1).map(b => b[0]);
  const bandToken = b => `${b[0]}-${b[1] == null ? '' : b[1]}`;                                  // "1000-2499", "10000-"
  const bandRange = t => { const [lo, hi] = t.split('-'); return [Number(lo) || 0, hi === '' ? null : Number(hi) + 1]; };   // [from, below]
  const bandLabel = t => { const [lo, hi] = t.split('-'); return hi === '' ? `AED ${num(lo)} and above` : Number(lo) === 0 ? `Under AED ${num(Number(hi) + 1)}` : `AED ${num(lo)} – ${num(hi)}`; };
  const discLabel = d => `${d}% off or more`;
  const pct = r => Math.round((r.disc || 0) * 100);                                               // the % shown on the card

  // sizes in a sensible order: beds small to large, seats by number (sets last), rugs by area
  const BED = ['Single', 'Double', 'Queen', 'King', 'Super King'];
  function sizeRank(z) {
    const b = BED.indexOf(z); if (b >= 0) return b;
    const set = /\+/.test(z), n = (z.match(/\d+(\.\d+)?/g) || []).map(Number);
    if (/seater|set/i.test(z)) return 100 + (set ? 1000 + n.reduce((a, x) => a + x, 0) : n[0] || 0);
    return 10000 + (n.length > 1 ? n[0] * n[1] : (n[0] || 0) * (n[0] || 0));
  }
  const bySize = (a, b) => sizeRank(a[0]) - sizeRank(b[0]) || a[0].localeCompare(b[0]);

  // what is ticked for a filter, and the tick boxes it offers (value, text, count)
  const sel = k => (k === 'disc' ? (state.disc ? [String(state.disc)] : []) : k === 'cat' ? [] : state[k]);
  function options(k) {
    const f = facets;
    if (!f) return [];
    let o = [];
    if (k === 'store' || k === 'room') o = (f[k] || []).map(([v, n]) => ({ v, t: v, n }));
    else if (k === 'size') o = (f.size || []).slice().sort(bySize).map(([v, n]) => ({ v, t: v, n }));
    else if (k === 'price') o = CFG.priceBands.map((b, i) => ({ v: bandToken(b), t: bandLabel(bandToken(b)), n: (f.price || {})[i] || 0 })).filter(x => x.n > 0);
    else if (k === 'disc') o = CFG.discounts.map(d => ({ v: String(d), t: discLabel(d), n: (f.disc || {})[d] || 0 })).filter(x => x.n > 0);
    else if (k === 'cat') {
      const n = FF.node(state.cat), kids = n.l3 ? [] : n.l2 ? n.l2.ch : n.l1 ? n.l1.ch : FF.meta.tree, cnt = new Map(f.cat || []);
      o = kids.filter(c => cnt.get(c.n) > 0).map(c => ({ v: c.s, t: c.n, n: cnt.get(c.n) })).sort((a, b) => b.n - a.n);
    }
    sel(k).filter(v => !o.some(x => x.v === v)).forEach(v => o.push({ v, t: k === 'price' ? bandLabel(v) : k === 'disc' ? discLabel(v) : v, n: 0 }));   // a ticked value always stays visible
    return o;
  }
  // a filter shows only when this page has data for it: at least 2 choices, and (size, room) at least half the products filled in
  function usable(k) {
    const f = facets;
    if (!f || !NAMES[k]) return false;
    if (sel(k).length) return true;
    const o = options(k);
    if (k === 'disc') return o.length >= 1;
    if (o.length < 2) return false;
    if (k === 'size') return f.sized >= f.n * 0.5;
    if (k === 'room') return f.roomed >= f.n * 0.5;
    return true;
  }

  // ------------------------------------------------------------------ which shards do we need? (published-files mode)
  const needsAll = () => !!(state.q.trim() || state.sale || state.store.length || state.room.length || state.price.length || state.disc || state.sort !== 'featured');
  function neededKeys() {
    const n = FF.node(state.cat);
    if (n.l2) return [n.l2.f];
    if (n.l1) return n.l1.ch.map(x => x.f);
    if (needsAll()) return FF.shards.map(s => s.key);
    return FF.shards.filter(s => s.l1 === 'Furniture').map(s => s.key);      // default view: furniture first, the rest loads in the background
  }

  // ------------------------------------------------------------------ search + filter + sort (published-files mode)
  function score(r, ts, phrase) {
    let s = 0;
    for (const t of ts) {
      const nameWord = (' ' + r.nameL).includes(' ' + t), nameSub = r.nameL.includes(t);
      const catWord = (' ' + r.catL).includes(' ' + t), catSub = r.catL.includes(t), storeHit = r.storeL.includes(t);
      if (!nameSub && !catSub && !storeHit) return -1;
      s += (nameWord ? 4 : nameSub ? 2 : 0) + (catWord ? 3 : catSub ? 1 : 0) + (storeHit ? 1 : 0);
    }
    const l3n = FF.catL[r.c].l3n;
    if (l3n === phrase || l3n.endsWith(' ' + phrase)) s += 6;
    else if (ts.length > 1 && r.catL.includes(phrase)) s += 4;
    return s;
  }

  const saved = r => (r.orig > r.price ? r.orig - r.price : 0);   // AED off, worked out here so this file never depends on common.js being current

  function currentRows() {
    const n = FF.node(state.cat);
    const shardKeys = n.l2 ? [n.l2.f] : n.l1 ? n.l1.ch.map(x => x.f) : FF.shards.map(s => s.key);
    const loaded = shardKeys.filter(k => FF.shardRows[k]);
    const key = JSON.stringify([state.cat, state.q, state.room, state.store, state.size, state.price, state.disc, state.sale, state.sort, loaded.length]);
    if (cache.key === key) return cache.rows;
    const ts = FF.terms(state.q), phrase = ts.join(' ');
    const ranges = state.price.map(bandRange), ed = edges();
    const fc = { n: 0, sized: 0, roomed: 0, store: new Map(), size: new Map(), room: new Map(), cat: new Map(), price: {}, disc: {}, tiles: {}, sizeimg: {} };
    const inc = (m, v) => m.set(v, (m.get(v) || 0) + 1);
    const rows = [];
    for (const k of loaded) {
      for (const r of FF.shardRows[k]) {
        if (n.l3 && r.c !== n.l3.i) continue;
        if (state.sale && !(r.disc > 0)) continue;
        if (ts.length) { const sc = score(r, ts, phrase); if (sc < 0) continue; r._s = sc; } else r._s = 0;
        // the row is in this page's scope: count it for the filter bar before the tick boxes narrow the list
        const p = pct(r), kid = !n.l1 ? r.l1 : !n.l2 ? r.l2 : !n.l3 ? r.l3 : '';
        fc.n++; inc(fc.store, r.store);
        if (r.size) { fc.sized++; inc(fc.size, r.size); if (!fc.sizeimg[r.size] && r.img) fc.sizeimg[r.size] = r.img; }
        if (r.room) { fc.roomed++; inc(fc.room, r.room); }
        if (kid) { inc(fc.cat, kid); if (!fc.tiles[kid] && r.img && !r.id.includes('~')) fc.tiles[kid] = r.img; }
        let b = 0; while (b < ed.length && r.price >= ed[b]) b++;
        fc.price[b] = (fc.price[b] || 0) + 1;
        if (p <= 80) for (const d of CFG.discounts) if (p >= d) fc.disc[d] = (fc.disc[d] || 0) + 1;
        if (state.room.length && !state.room.includes(r.room)) continue;
        if (state.store.length && !state.store.includes(r.store)) continue;
        if (state.size.length && !state.size.includes(r.size)) continue;
        if (ranges.length && !ranges.some(([lo, hi]) => r.price >= lo && (hi === null || r.price < hi))) continue;
        if (state.disc && !(p >= state.disc && p <= 80)) continue;
        rows.push(r);
      }
    }
    const by = {
      'price-low': (a, b) => a.price - b.price,
      'price-high': (a, b) => b.price - a.price,
      discount: (a, b) => b.disc - a.disc || saved(b) - saved(a),
      saving: (a, b) => saved(b) - saved(a) || b.disc - a.disc,
      name: (a, b) => a.nameL.localeCompare(b.nameL),
      featured: ts.length ? (a, b) => b._s - a._s || a.pri - b.pri || b.f - a.f : (a, b) => a.pri - b.pri || b.f - a.f
    };
    rows.sort(by[state.sort] || by.featured);
    const arr = m => [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
    cache = { key, rows, facets: Object.assign(fc, { store: arr(fc.store), size: arr(fc.size), room: arr(fc.room), cat: arr(fc.cat) }) };
    return rows;
  }

  // ------------------------------------------------------------------ rendering
  const card = r => FF.pcCard(r);                 // shared product card (common.js); rows carry r.room (suggested wishlist room)

  // Picture tiles under the heading (like Home Centre): a top-level category shows its groups, a group shows its product types;
  // a page with no further types shows its sizes instead ("King beds"), and a size tile ticks that size in the filter.
  function subcats() {
    const el = $('subcatStrip');
    if (!el) return;
    const n = FF.node(state.cat), f = facets || {};
    const kids = (n.l3 || state.q ? [] : n.l2 ? n.l2.ch : n.l1 ? n.l1.ch : []).filter(c => c.c > 0);
    const room = roomHome(), roomTiles = (room && ROOMS && ROOMS[room] && ROOMS[room].tiles) || [];
    let html = '';
    if (roomTiles.length >= 2) {
      html = roomTiles.map(t => `<a class="nn-subcat" href="browse.html?c=${enc(t.c)}&amp;${t.f ? 'room' : 'via'}=${enc(room)}" data-subcat="${esc(t.c)}"${t.f ? '' : ` data-via="${esc(room)}"`}>
        <span class="nn-subcat-img">${t.i ? `<img referrerpolicy="no-referrer" src="${esc(FF.fixImg(t.i))}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>
        <span class="nn-subcat-name">${esc(t.n)}</span></a>`).join('');
    } else if (kids.length >= 2) {
      html = kids.map(c => {
        const img = (f.tiles || {})[c.n] ? FF.fixImg(f.tiles[c.n]) : '';
        return `<a class="nn-subcat" href="browse.html?c=${enc(c.s)}" data-subcat="${esc(c.s)}">
        <span class="nn-subcat-img">${img ? `<img referrerpolicy="no-referrer" src="${esc(img)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>
        <span class="nn-subcat-name">${esc(c.n)}</span></a>`;
      }).join('');
    } else if (n.l1 && !state.q && facets && usable('size')) {
      const tile = catCfg().sizeTile, pics = f.sizeimg || {};
      const top = (f.size || []).filter(([z]) => pics[z]).sort((a, b) => b[1] - a[1]).slice(0, 8).sort(bySize);
      if (top.length >= 2) html = top.map(([z]) => `<button type="button" class="nn-subcat nn-sizetile${state.size.includes(z) ? ' on' : ''}" data-sizetile="${esc(z)}" aria-pressed="${state.size.includes(z)}">
        <span class="nn-subcat-img"><img referrerpolicy="no-referrer" src="${esc(FF.fixImg(pics[z]))}" alt="" loading="lazy" onerror="this.remove()"></span>
        <span class="nn-subcat-name">${esc(tile.replace('{size}', z))}</span></button>`).join('');
    }
    if (!html) { el.hidden = true; el.innerHTML = ''; el.dataset.html = ''; return; }
    if (el.dataset.html !== html) {
      el.innerHTML = html; el.dataset.html = html;
      if (el.dataset.scope !== state.cat + '|' + room) { el.scrollLeft = 0; el.dataset.scope = state.cat + '|' + room; }   // not data-cat: clicks on [data-cat] are category links
    }
    el.hidden = false;
  }

  // the bar (first 4 filters with data) and the "More filters" side panel (all of them); rebuilt only when the choices change
  function optHTML(k, o) {
    const s = sel(k);
    return o.map(x => `<label class="ff-opt"><input type="${k === 'cat' ? 'radio' : 'checkbox'}" name="ff-${k}" data-fk="${k}" value="${esc(x.v)}"${s.includes(x.v) ? ' checked' : ''}><span>${esc(x.t)}</span><em>${x.n.toLocaleString()}</em></label>`).join('');
  }
  const finder = (k, o) => (o.length > 10 ? `<div class="ff-s"><input type="search" data-fs placeholder="Search ${esc(label(k).toLowerCase())}" aria-label="Search ${esc(label(k).toLowerCase())}"></div>` : '');
  function renderBar() {
    const cfg = catCfg();
    const data = [...new Set([...cfg.bar, ...cfg.more])].filter(usable).map(k => [k, options(k)]);
    const sig = JSON.stringify([data, cfg.sizeLabel]);
    if (sig !== barSig) {
      barSig = sig;
      const open = (document.querySelector('.ff-dd.open') || { dataset: {} }).dataset.k;
      const openAc = [...document.querySelectorAll('.ff-ac.open')].map(a => a.dataset.k);
      els.drops.innerHTML = data.slice(0, 4).map(([k, o]) => `<div class="ff-dd${k === open ? ' open' : ''}" data-k="${k}">
        <button type="button" class="ff-btn" aria-expanded="${k === open}"><span class="ff-t">${esc(label(k))}<i class="ff-n" hidden></i></span><span class="ff-caret" aria-hidden="true"></span></button>
        <div class="ff-panel">${finder(k, o)}<div class="ff-opts">${optHTML(k, o)}</div>
        <div class="ff-pf"><button type="button" data-fclear="${k}">Clear</button><button type="button" class="ff-go" data-fclose>Apply</button></div></div></div>`).join('')
        + (data.length ? `<button type="button" class="ff-btn ff-more" id="ffMore"><span class="ff-t"><span class="ff-more-l">More filters</span><span class="ff-more-s">Filters</span><i class="ff-n" hidden></i></span><span class="ff-plus" aria-hidden="true">+</span></button>` : '');
      els.list.innerHTML = data.map(([k, o]) => `<div class="ff-ac${openAc.includes(k) ? ' open' : ''}" data-k="${k}">
        <button type="button" class="ff-ac-btn" aria-expanded="${openAc.includes(k)}"><span class="ff-t">${esc(label(k))}<i class="ff-n" hidden></i></span><span class="ff-pl" aria-hidden="true">${openAc.includes(k) ? '–' : '+'}</span></button>
        <div class="ff-body">${finder(k, o)}<div class="ff-opts">${optHTML(k, o)}</div></div></div>`).join('');
    }
    syncChecks();
  }
  // tick boxes, count bubbles and chips follow the state (the same filter appears in the bar and in the side panel)
  function syncChecks() {
    document.querySelectorAll('input[data-fk]').forEach(i => { i.checked = sel(i.dataset.fk).includes(i.value); });
    const bubble = (el, n) => { const b = el && el.querySelector('.ff-n'); if (b) { b.textContent = n || ''; b.hidden = !n; } };
    document.querySelectorAll('.ff-dd, .ff-ac').forEach(d => bubble(d, sel(d.dataset.k).length));
    const inBar = [...document.querySelectorAll('.ff-dd')].map(d => d.dataset.k), all = ['store', 'size', 'room', 'price', 'disc'];
    const phone = window.matchMedia('(max-width: 767px)').matches;                               // on a phone the one button stands for every filter
    bubble($('ffMore'), all.filter(k => phone || !inBar.includes(k)).reduce((a, k) => a + sel(k).length, 0));
  }

  function pills() {
    const list = [];
    if (state.q) list.push(['q', '', `“${state.q}”`]);
    state.store.forEach(v => list.push(['store', v, v]));
    state.size.forEach(v => list.push(['size', v, v]));
    state.room.forEach(v => list.push(['room', v, v]));
    state.price.forEach(v => list.push(['price', v, bandLabel(v)]));
    if (state.disc) list.push(['disc', '', discLabel(state.disc)]);
    if (state.sale) list.push(['sale', '', 'On sale']);
    els.active.innerHTML = list.map(([k, v, t]) => `<span class="ff-chip">${esc(t)}<button type="button" data-clear="${k}" data-v="${esc(v)}" aria-label="Remove ${esc(t)}">×</button></span>`).join('')
      + (list.some(([k]) => k !== 'q') ? '<button type="button" class="ff-clear" data-clearall>Clear all</button>' : '');
  }

  function syncURL() {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.cat) p.set('c', state.cat);
    if (cameFrom()) p.set('via', state.via);
    ['room', 'store', 'size', 'price'].forEach(k => { if (state[k].length) p.set(k, state[k].join(',')); });
    if (state.disc) p.set('disc', state.disc);
    if (state.sale) p.set('deals', '1');
    if (state.sort !== 'featured') p.set('sort', state.sort);
    const qs = p.toString().replace(/%2C/gi, ',');
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  }
  function syncControls() {
    if (state.cat && !FF.node(state.cat).l1) state.cat = '';
    els.sort.value = state.sort; els.search.value = state.q;
  }

  // ---- database mode: one question for the cards of the page, and one per scope for the filter bar (counts, pictures)
  function scopeArgs() {
    const n = FF.node(state.cat);
    return { p_l1: n.l1 ? n.l1.n : null, p_l2: n.l2 ? n.l2.n : null, p_l3: n.l3 ? n.l3.n : null, p_q: state.q.trim() || null, p_sale: !!state.sale };
  }
  function dbArgs() {
    const arr = a => (a.length ? a : null);
    return Object.assign(scopeArgs(), { p_room: arr(state.room), p_store: arr(state.store), p_size: arr(state.size),
      p_price: state.price.length ? state.price.map(bandRange) : null, p_disc: state.disc || null, p_sort: state.sort });
  }
  async function dbLoad(more) {
    const r = await FF.db.rpc('browse_v2', Object.assign(dbArgs(), { p_limit: PAGE, p_offset: more && dbv ? dbv.items.length : 0 }));
    const items = (r.items || []).map(x => Object.assign(x, { img: FF.fixImg(x.img) }));
    dbv = { items: more && dbv ? dbv.items.concat(items) : items, total: r.total || 0 };
  }
  function dbFacets() {
    const args = Object.assign(scopeArgs(), { p_edges: edges(), p_discs: CFG.discounts });
    const key = JSON.stringify(args);
    if (key === facetKey) return;
    facetKey = key;
    FF.db.rpc('browse_facets', args).then(f => { if (key !== facetKey || !FF.db.on) return; facets = f; renderBar(); subcats(); })
      .catch(e => { if (key === facetKey) facetKey = ''; console.warn('filter counts could not be loaded', e); });
  }

  function render() {
    const rows = dbv ? dbv.items : currentRows();
    if (!dbv) facets = cache.facets;
    const visible = dbv ? rows : rows.slice(0, state.shown);
    const total = dbv ? dbv.total : rows.length;
    els.grid.innerHTML = visible.map(card).join('');
    const crumbs = [FF.node(state.cat).l1, FF.node(state.cat).l2, FF.node(state.cat).l3].filter(Boolean);
    const trail = crumbs.map((x, i) => (i === crumbs.length - 1 && !state.q ? `<span>${esc(x.n)}</span>` : `<a href="browse.html?c=${enc(x.s)}" data-cat="${esc(x.s)}">${esc(x.n)}</a>`)).join(' › ');
    els.count.textContent = `${total.toLocaleString()} products`;
    const room = oneRoom() || cameFrom();          // inside a room the trail starts at the room, not at "All products"
    const start = !room ? '<a href="browse.html" data-cat="">All products</a>'
      : `<a href="browse.html?room=${enc(room)}" ${oneRoom() ? 'data-cat=""' : `data-roomback="${esc(room)}"`}>${esc(room)}</a>`;
    els.label.innerHTML = state.q ? `Results for “${esc(state.q)}”${trail ? ' in ' + trail : ''}` : crumbs.length ? `${start} › ${trail}`
      : room ? `<a href="index.html#rooms">Shop by room</a> › <span>${esc(room)}</span>` : state.sale ? 'Everything on sale' : 'All products';
    document.title = `${state.q ? `“${state.q}”` : crumbs.length ? crumbs[crumbs.length - 1].n + (room ? ', ' + room : '') : room || 'Browse'} | Furnish Finder UAE`;
    renderBar();
    subcats();
    els.show.textContent = `Show ${total.toLocaleString()} ${total === 1 ? 'result' : 'results'}`;
    els.load.hidden = visible.length >= total || !rows.length;
    els.empty.hidden = !!rows.length; els.grid.hidden = !rows.length;
    pills();
  }

  function setStatus(keys) {
    const done = keys.filter(k => FF.shardRows[k]).length;
    els.status.textContent = done < keys.length ? `Loading products… ${done} of ${keys.length} sections` : '';
    return done;
  }

  async function refresh() {
    const my = ++token;
    syncURL();
    if (FF.db.on) {
      try {
        if (!dbv) els.count.textContent = 'Loading furniture…';
        dbFacets();
        await dbLoad(false);
        if (my !== token) return;
        els.status.textContent = '';
        return render();
      } catch (e) { FF.db.fail(e); dbv = null; facets = null; facetKey = ''; cache = { key: '', rows: [], facets: null }; if (my !== token) return; loadRest(); }
    }
    const keys = neededKeys();
    const pending = keys.filter(k => !FF.shardRows[k]);
    if (pending.length) {
      els.count.textContent = 'Loading furniture…'; setStatus(keys);
      try {
        await Promise.all(pending.map(k => FF.loadShard(k).then(() => { if (my === token) setStatus(keys); })));
      } catch (e) {
        els.status.textContent = 'Some products could not be loaded. Please refresh the page.'; console.error(e);
      }
    }
    if (my !== token) return;
    els.status.textContent = '';
    render();
  }

  // once the first view is on screen, quietly load everything else so search and filters cover the whole catalogue
  async function loadRest() {
    if (FF.db.on) return;                          // the database answers for the whole catalogue; nothing to preload
    const rest = FF.shards.map(s => s.key).filter(k => !FF.shardRows[k]);
    const total = FF.shards.length;
    for (let i = 0; i < rest.length; i += 4) {
      await Promise.all(rest.slice(i, i + 4).map(k => FF.loadShard(k).catch(console.error)));
      els.status.textContent = `Loading full catalogue… ${total - rest.length + Math.min(i + 4, rest.length)} of ${total} sections`;
    }
    els.status.textContent = '';
    if (!els.grid.hidden || !els.empty.hidden) render();
  }

  // ------------------------------------------------------------------ events
  const go = () => { state.shown = PAGE; syncControls(); syncChecks(); pills(); return refresh(); };
  function setCat(c) { state.cat = c; state.size = []; return go(); }
  function tick(k, v, on) {
    if (k === 'cat') return setCat(v);
    if (k === 'disc') state.disc = on ? Number(v) : 0;                 // "25% off or more" already includes 50%: one choice at a time
    else state[k] = state[k].filter(x => x !== v).concat(on ? [v] : []);
    go();
  }
  function clearOne(k, v) {
    if (k === 'q') state.q = ''; else if (k === 'sale') state.sale = false; else if (k === 'disc') state.disc = 0;
    else state[k] = v ? state[k].filter(x => x !== v) : [];
    go();
  }
  const closeDrops = () => document.querySelectorAll('.ff-dd.open').forEach(d => { d.classList.remove('open'); d.querySelector('.ff-btn').setAttribute('aria-expanded', 'false'); });
  function drawer(open) {
    els.drawer.classList.toggle('on', open); els.ov.classList.toggle('on', open); els.drawer.setAttribute('aria-hidden', String(!open));
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) closeDrops();
  }
  els.sort.addEventListener('change', () => { state.sort = els.sort.value; go(); });
  document.addEventListener('change', e => { const i = e.target; if (i.dataset && i.dataset.fk) tick(i.dataset.fk, i.value, i.checked); });
  document.addEventListener('input', e => {
    if (!e.target.matches || !e.target.matches('[data-fs]')) return;
    const q = e.target.value.trim().toLowerCase();
    e.target.closest('.ff-panel, .ff-body').querySelectorAll('.ff-opt').forEach(o => { o.hidden = !!q && !o.textContent.toLowerCase().includes(q); });
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDrops(); drawer(false); } });

  function goSearch(q) { state.q = q.trim(); if (state.q) { state.cat = ''; state.size = []; } /* the header search looks across everything */ go().then(() => $('browse').scrollIntoView({ behavior: 'smooth', block: 'start' })); }
  $('searchForm').addEventListener('submit', e => { e.preventDefault(); goSearch(els.search.value); });
  document.querySelectorAll('[data-query]').forEach(b => b.addEventListener('click', () => goSearch(b.dataset.query)));
  document.querySelectorAll('[data-c]').forEach(b => b.addEventListener('click', () => {
    state.q = ''; setCat(b.dataset.c).then(() => $('browse').scrollIntoView({ behavior: 'smooth' }));
  }));
  function reset() {
    Object.assign(state, { q: '', cat: '', room: [], store: [], size: [], price: [], disc: 0, sale: false, sort: 'featured', via: '' });
    go();
  }
  $('emptyReset').addEventListener('click', reset);
  els.load.addEventListener('click', () => {
    if (!dbv) { state.shown += PAGE; return render(); }
    const my = token; els.load.disabled = true;
    dbLoad(true).then(() => { if (my === token) render(); }).catch(e => { FF.db.fail(e); dbv = null; facets = null; facetKey = ''; refresh(); }).finally(() => { els.load.disabled = false; });
  });

  // ------------------------------------------------------------------ compare
  function toggleCompare(id) {
    if (state.compare.includes(id)) state.compare = state.compare.filter(x => x !== id);
    else if (state.compare.length < 3) state.compare.push(id);
    else return FF.toast('You can compare up to 3 items');
    els.compareCount.textContent = state.compare.length; els.compareTrigger.disabled = state.compare.length < 2; render();
  }
  async function openCompare() {
    const items = state.compare.map(id => FF.byId.get(id)).filter(Boolean);
    if (items.length < 2) return;
    const details = await Promise.all(items.map(i => FF.loadDetail(i.id).catch(() => null)));
    const row = (label, fn) => `<tr><td>${label}</td>${items.map((p, i) => `<td>${fn(p, details[i] || {}) || '—'}</td>`).join('')}</tr>`;
    $('compareContent').innerHTML = `<table class="compare-table"><tbody>
      ${row('', p => FF.img(p.img, p.name, 'product-image'))}
      ${row('Product', p => `<strong>${esc(p.name)}</strong><br><small>${esc([p.store, p.size, p.colour].filter(Boolean).join(' · '))}</small>`)}
      ${row('Price', p => `<strong>${p.from ? 'From ' : ''}${money(p.price)}</strong>${p.disc ? `<br><small>${Math.round(p.disc * 100)}% off</small>` : ''}`)}
      ${row('Type', p => esc(p.l3))}${row('Room', p => esc(p.room))}
      ${row('Material', (p, d) => esc(d.m))}${row('Colour', (p, d) => esc(d.k))}${row('Dimensions', (p, d) => esc(d.z))}
      ${row('', p => `<a href="product.html?id=${enc(p.id)}" target="_blank" rel="noopener">View details</a>`)}</tbody></table>`;
    els.compareDialog.showModal();
  }
  els.compareTrigger.addEventListener('click', openCompare);

  document.addEventListener('click', e => {
    const t = e.target;
    const comp = t.closest('[data-compare]'); if (comp) toggleCompare(comp.dataset.compare);
    const closer = t.closest('[data-close]'); if (closer) $(closer.dataset.close + 'Dialog').close();
    const plain = !(e.metaKey || e.ctrlKey || e.shiftKey);

    const dd = t.closest('.ff-dd > .ff-btn');
    if (dd) { const d = dd.parentElement, was = d.classList.contains('open'); closeDrops(); if (!was) { d.classList.add('open'); dd.setAttribute('aria-expanded', 'true'); } return; }
    if (t.closest('[data-fclose]')) return closeDrops();
    const fc = t.closest('[data-fclear]'); if (fc) { closeDrops(); return clearOne(fc.dataset.fclear, ''); }
    if (t.closest('#ffMore')) return drawer(true);
    if (t.closest('#ffClose') || t === els.ov || t.closest('#ffShow')) return drawer(false);
    const ac = t.closest('.ff-ac-btn');
    if (ac) { const a = ac.parentElement, on = a.classList.toggle('open'); ac.setAttribute('aria-expanded', String(on)); ac.querySelector('.ff-pl').textContent = on ? '–' : '+'; return; }
    const chip = t.closest('[data-clear]'); if (chip) return clearOne(chip.dataset.clear, chip.dataset.v);
    if (t.closest('[data-clearall]')) { Object.assign(state, { room: [], store: [], size: [], price: [], disc: 0, sale: false }); return go(); }
    const st = t.closest('[data-sizetile]'); if (st) return tick('size', st.dataset.sizetile, !state.size.includes(st.dataset.sizetile));
    const back = t.closest('[data-roomback]'); if (back && plain) { e.preventDefault(); state.room = [back.dataset.roomback]; state.via = ''; return setCat(''); }
    const sub = t.closest('[data-subcat]');
    if (sub && plain) { e.preventDefault(); if (sub.dataset.via) { state.via = sub.dataset.via; state.room = []; } return setCat(sub.dataset.subcat); }
    const crumb = t.closest('[data-cat]'); if (crumb && plain) { e.preventDefault(); return setCat(crumb.dataset.cat); }
    if (!t.closest('.ff-dd')) closeDrops();
  });
  els.compareDialog.addEventListener('click', e => { if (e.target === els.compareDialog) els.compareDialog.close(); });

  // ------------------------------------------------------------------ start
  Promise.all([FF.loadMeta(), loadCfg]).then(() => {
    syncControls();
    FF.fetchJSON('data/rooms.json').then(d => { ROOMS = (d && d.rooms) || {}; subcats(); }).catch(() => { ROOMS = {}; });
    return refresh();
  }).then(loadRest).catch(err => {
    console.error(err);
    els.count.textContent = 'The catalogue could not be loaded';
    els.status.textContent = 'Please refresh the page. If this keeps happening, try again in a few minutes.';
  });
})();
