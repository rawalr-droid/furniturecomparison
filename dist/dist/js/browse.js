(function () {
  'use strict';
  const { esc, enc, money, $ } = FF;
  const PAGE = 24;
  const params = new URLSearchParams(location.search);
  const state = {
    q: params.get('q') || '', cat: params.get('c') || '', room: params.get('room') || '', store: params.get('store') || '',
    min: '', max: '', sale: params.get('deals') === '1', sort: ['price-low', 'price-high', 'discount', 'saving', 'name'].includes(params.get('sort')) ? params.get('sort') : 'featured', shown: PAGE, compare: []
  };
  const els = {
    grid: $('productGrid'), count: $('resultCount'), label: $('resultLabel'), status: $('loadStatus'), search: $('searchInput'),
    cat: $('categoryFilter'), sub: $('subcategoryFilter'), type: $('typeFilter'), room: $('roomFilter'), store: $('storeFilter'),
    min: $('minPrice'), max: $('maxPrice'), sale: $('saleOnly'), sort: $('sortSelect'), load: $('loadMore'), empty: $('emptyState'),
    active: $('activeFilters'), compareCount: $('compareCount'), compareTrigger: $('compareTrigger'), compareDialog: $('compareDialog')
  };
  let token = 0;
  let cache = { key: '', rows: [] };

  // ------------------------------------------------------------------ filters UI
  function opt(value, label) { return `<option value="${esc(value)}">${esc(label)}</option>`; }
  function buildFilters() {
    const m = FF.meta;
    els.cat.innerHTML = opt('', 'All categories') + m.tree.map(n => opt(n.s, `${n.n} (${n.c.toLocaleString()})`)).join('');
    els.room.innerHTML = opt('', 'All rooms') + m.rooms.map(r => opt(r, r)).join('');
    els.store.innerHTML = opt('', 'All stores') + m.stores.map(s => opt(s.n, `${s.n} (${s.c.toLocaleString()})`)).join('');
  }
  function syncControls() {
    const n = FF.node(state.cat);
    if (state.cat && !n.l1) state.cat = '';
    els.cat.value = n.l1 ? n.l1.s : '';
    els.sub.innerHTML = opt('', 'All sub-categories') + (n.l1 ? n.l1.ch.map(c => opt(c.s, `${c.n} (${c.c.toLocaleString()})`)).join('') : '');
    els.sub.disabled = !n.l1; els.sub.value = n.l2 ? n.l2.s : '';
    els.type.innerHTML = opt('', 'All types') + (n.l2 ? n.l2.ch.map(c => opt(c.s, `${c.n} (${c.c.toLocaleString()})`)).join('') : '');
    els.type.disabled = !n.l2; els.type.value = n.l3 ? n.l3.s : '';
    els.room.value = state.room; els.store.value = state.store; els.sale.checked = state.sale; els.sort.value = state.sort;
    els.min.value = state.min; els.max.value = state.max; els.search.value = state.q;
  }

  // ------------------------------------------------------------------ which shards do we need?
  const needsAll = () => !!(state.q.trim() || state.sale || state.store || state.room || state.min || state.max || state.sort !== 'featured');
  function neededKeys() {
    const n = FF.node(state.cat);
    if (n.l2) return [n.l2.f];
    if (n.l1) return n.l1.ch.map(x => x.f);
    if (needsAll()) return FF.shards.map(s => s.key);
    return FF.shards.filter(s => s.l1 === 'Furniture').map(s => s.key);      // default view: furniture first, the rest loads in the background
  }

  // ------------------------------------------------------------------ search + filter + sort
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
    const key = JSON.stringify([state.cat, state.q, state.room, state.store, state.min, state.max, state.sale, state.sort, loaded.length]);
    if (cache.key === key) return cache.rows;
    const ts = FF.terms(state.q), phrase = ts.join(' ');
    const min = state.min === '' ? null : Number(state.min), max = state.max === '' ? null : Number(state.max);
    const rows = [];
    for (const k of loaded) {
      for (const r of FF.shardRows[k]) {
        if (n.l3 && r.c !== n.l3.i) continue;
        if (state.room && r.room !== state.room) continue;
        if (state.store && r.store !== state.store) continue;
        if (min !== null && r.price < min) continue;
        if (max !== null && r.price > max) continue;
        if (state.sale && !(r.disc > 0)) continue;
        if (ts.length) { const sc = score(r, ts, phrase); if (sc < 0) continue; r._s = sc; } else r._s = 0;
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
    cache = { key, rows };
    return rows;
  }

  // ------------------------------------------------------------------ rendering
  function card(r) {
    const selected = state.compare.includes(r.id);
    const href = 'product.html?id=' + enc(r.id);
    const price = r.opts > 1 ? 'From ' + money(r.price) : money(r.price);
    return `<article class="product-card">
      <a class="product-media" href="${href}" target="_blank" rel="noopener">${FF.img(r.img, r.name, 'product-image')}${r.opts > 1 ? `<span class="variant-count">${r.opts} options</span>` : ''}</a>
      <div class="product-body">
        <div class="product-kicker"><span>${esc(r.store)}</span>${r.disc ? `<span class="sale-badge">${Math.round(r.disc * 100)}% off</span>` : ''}</div>
        <h3><a href="${href}" target="_blank" rel="noopener">${esc(r.name)}</a></h3>
        <div class="card-type">${esc(r.l3)}</div>
        <div class="price">${price}${r.orig > r.price ? `<span class="was-price">${money(r.orig)}</span>` : ''}</div>
        <div class="card-actions"><a class="view-button" href="${href}" target="_blank" rel="noopener">View details ↗</a><button class="${selected ? 'selected' : ''}" data-compare="${esc(r.id)}">${selected ? 'Added' : 'Compare'}</button></div>
      </div>
    </article>`;
  }

  function pills() {
    const n = FF.node(state.cat), deepest = n.l3 || n.l2 || n.l1;
    const list = [['q', state.q && `“${state.q}”`], ['cat', deepest && deepest.n], ['room', state.room], ['store', state.store],
      ['price', (state.min || state.max) && `AED ${state.min || 0}–${state.max || '∞'}`], ['sale', state.sale && 'On sale']].filter(([, v]) => v);
    els.active.innerHTML = list.map(([k, v]) => `<button class="filter-pill" data-clear="${k}">${esc(v)} ×</button>`).join('');
  }

  function syncURL() {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.cat) p.set('c', state.cat);
    if (state.room) p.set('room', state.room);
    if (state.store) p.set('store', state.store);
    if (state.sale) p.set('deals', '1');
    if (state.sort !== 'featured') p.set('sort', state.sort);
    history.replaceState(null, '', location.pathname + (p.toString() ? '?' + p : ''));
  }

  function render() {
    const rows = currentRows();
    const visible = rows.slice(0, state.shown);
    els.grid.innerHTML = visible.map(card).join('');
    const n = FF.node(state.cat), deepest = n.l3 || n.l2 || n.l1;
    els.count.textContent = `${rows.length.toLocaleString()} products`;
    els.label.textContent = state.q ? `Results for “${state.q}”` : deepest ? [n.l1, n.l2, n.l3].filter(Boolean).map(x => x.n).join(' › ') : state.sale ? 'Everything on sale' : 'Browse the catalogue';
    els.load.hidden = visible.length >= rows.length || !rows.length;
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
  function readControls() {
    state.room = els.room.value; state.store = els.store.value; state.min = els.min.value; state.max = els.max.value;
    state.sale = els.sale.checked; state.sort = els.sort.value; state.shown = PAGE;
    refresh();
  }
  els.cat.addEventListener('change', () => { state.cat = els.cat.value; state.shown = PAGE; syncControls(); refresh(); });
  els.sub.addEventListener('change', () => { state.cat = els.sub.value || els.cat.value; state.shown = PAGE; syncControls(); refresh(); });
  els.type.addEventListener('change', () => { state.cat = els.type.value || els.sub.value; state.shown = PAGE; syncControls(); refresh(); });
  [els.room, els.store, els.sale, els.sort].forEach(x => x.addEventListener('change', readControls));
  [els.min, els.max].forEach(x => x.addEventListener('input', () => { clearTimeout(x.timer); x.timer = setTimeout(readControls, 300); }));

  function goSearch(q) { state.q = q.trim(); state.shown = PAGE; els.search.value = state.q; refresh().then(() => $('browse').scrollIntoView({ behavior: 'smooth' })); }
  $('searchForm').addEventListener('submit', e => { e.preventDefault(); goSearch(els.search.value); });
  document.querySelectorAll('[data-query]').forEach(b => b.addEventListener('click', () => goSearch(b.dataset.query)));
  document.querySelectorAll('[data-c]').forEach(b => b.addEventListener('click', () => {
    state.q = ''; state.cat = b.dataset.c; state.shown = PAGE; syncControls(); refresh().then(() => $('browse').scrollIntoView({ behavior: 'smooth' }));
  }));
  function reset() {
    Object.assign(state, { q: '', cat: '', room: '', store: '', min: '', max: '', sale: false, sort: 'featured', shown: PAGE });
    syncControls(); refresh();
  }
  $('clearFilters').addEventListener('click', reset); $('emptyReset').addEventListener('click', reset);
  $('filterToggle').addEventListener('click', () => $('filters').classList.toggle('open'));
  els.load.addEventListener('click', () => { state.shown += PAGE; render(); });

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
      ${row('Product', p => `<strong>${esc(p.name)}</strong><br><small>${esc(p.store)}</small>`)}
      ${row('Price', p => `<strong>${p.opts > 1 ? 'From ' : ''}${money(p.price)}</strong>${p.disc ? `<br><small>${Math.round(p.disc * 100)}% off</small>` : ''}`)}
      ${row('Type', p => esc(p.l3))}${row('Room', p => esc(p.room))}
      ${row('Material', (p, d) => esc(d.m))}${row('Colour', (p, d) => esc(d.k))}${row('Dimensions', (p, d) => esc(d.z))}
      ${row('', p => `<a href="product.html?id=${enc(p.id)}" target="_blank" rel="noopener">View details</a>`)}</tbody></table>`;
    els.compareDialog.showModal();
  }
  els.compareTrigger.addEventListener('click', openCompare);

  document.addEventListener('click', e => {
    const comp = e.target.closest('[data-compare]'); if (comp) toggleCompare(comp.dataset.compare);
    const clear = e.target.closest('[data-clear]');
    if (clear) {
      const k = clear.dataset.clear;
      if (k === 'q') state.q = ''; else if (k === 'cat') state.cat = ''; else if (k === 'sale') state.sale = false;
      else if (k === 'price') { state.min = ''; state.max = ''; } else state[k] = '';
      state.shown = PAGE; syncControls(); refresh();
    }
    const closer = e.target.closest('[data-close]'); if (closer) $(closer.dataset.close + 'Dialog').close();
  });
  els.compareDialog.addEventListener('click', e => { if (e.target === els.compareDialog) els.compareDialog.close(); });

  // ------------------------------------------------------------------ start
  FF.loadMeta().then(() => {
    buildFilters(); syncControls();
    return refresh();
  }).then(loadRest).catch(err => {
    console.error(err);
    els.count.textContent = 'The catalogue could not be loaded';
    els.status.textContent = 'Please refresh the page. If this keeps happening, try again in a few minutes.';
  });
})();
