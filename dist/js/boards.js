// Mood boards (owner, 2026-10-06): the index page (moodboards.html) and one board (board.html?b=<key>).
// Data is built nightly by agents/ff_agents/boards.py into data/boards/: index.json and <key>.json. No database needed.
(function () {
  'use strict';
  const { esc, enc, money, $ } = FF;
  const PAGE = 24;
  const params = new URLSearchParams(location.search);
  const tile = b => `<a class="t2-tile mb-tile" href="board.html?b=${enc(b.key)}">
    <img src="${esc(b.image)}" alt="${esc(b.name)} room" loading="lazy" onerror="this.remove()">
    <span class="t2-tl"><b>${esc(b.name)}<small>${esc(b.line)}</small></b><span>Explore →</span></span></a>`;
  FF.moodTile = tile;
  FF.loadMeta().catch(() => {});

  // ---------------------------------------------------------------- index page
  if ($('mbIndex')) {
    FF.fetchJSON('data/boards/index.json').then(d => { $('mbIndex').innerHTML = d.boards.map(tile).join(''); })
      .catch(() => { $('mbIndex').innerHTML = '<p>The mood boards could not be loaded. Please refresh the page.</p>'; });
  }
  if (!$('mbHero')) return;

  // ---------------------------------------------------------------- one board
  const RENAMED = { wooden: 'earthy' };                 // old links keep working (the Wooden board became Earthy, 2026-10-07)
  const asked = /^[a-z0-9_-]+$/.test(params.get('b') || '') ? params.get('b') : 'japandi';
  const key = RENAMED[asked] || asked;
  const SORTS = ['price-low', 'price-high', 'discount'];
  const state = { cat: params.get('cat') || '', price: params.get('price') || '', store: params.get('store') || '', sale: params.get('sale') === '1',
                  sort: SORTS.includes(params.get('sort')) ? params.get('sort') : 'match', shown: PAGE };
  const els = { hero: $('mbHero'), look: $('mbLook'), chips: $('mbChips'), price: $('mbPrice'), store: $('mbStore'), sale: $('mbSale'), sort: $('mbSort'),
                count: $('mbCount'), grid: $('mbGrid'), more: $('mbMore'), empty: $('mbEmpty') };
  let board = null;
  const off = c => (c.orig > c.price ? Math.round((c.orig - c.price) / c.orig * 100) : 0);
  const card = c => FF.pcCard(Object.assign({}, c, { img: FF.fixImg(c.img) }));

  // a dot on the picture; its card opens below when the dot is in the upper half and towards the middle near the left / right edge
  const dot = a => `<div class="mb-dot${a.y < 50 ? ' below' : ''}${a.x > 72 ? ' left' : a.x < 28 ? ' right' : ''}" style="left:${a.x}%;top:${a.y}%">
    <button type="button" aria-label="${esc(a.name)} from ${esc(a.store)}, ${money(a.price)}"><i></i></button>
    <div class="mb-pop"><img referrerpolicy="no-referrer" loading="lazy" src="${esc(FF.fixImg(a.img))}" alt="">
      <strong>${esc(FF.cleanName(a.name))}</strong><span>${esc(a.store)} · ${esc(a.l3)}</span>
      <span class="mb-pp">${money(a.price)}${off(a) ? ` <b>-${off(a)}%</b> <s>${money(a.orig)}</s>` : ''}</span>
      <span class="mb-links"><a href="product.html?id=${enc(a.id)}">Details</a>${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener nofollow sponsored">Shop at ${esc(a.store)} ↗</a>` : ''}</span></div></div>`;

  function hero() {
    const shown = board.anchors.filter(a => a.inStock);
    const stores = new Set(shown.map(a => a.store)).size;
    els.hero.innerHTML = `<div class="mb-scene" style="aspect-ratio:${board.w}/${board.h}">
        <img class="mb-photo" src="${esc(board.image)}" alt="${esc(board.name)} living room with ${shown.length} real products">${shown.map(dot).join('')}</div>
      <div class="mb-copy"><p class="mb-eyebrow">Mood board</p><h1>${esc(board.name)}</h1><p class="mb-line">${esc(board.line)}</p>
        ${board.about ? `<p class="mb-about">${esc(board.about)}</p>` : ''}
        <p class="mb-total">The whole look: <strong>${money(board.total)}</strong> · ${shown.length} pieces from ${stores} store${stores === 1 ? '' : 's'}</p>
        <p class="mb-note">Hover or tap the dots for tonight's price. Room image is an illustration; products shown as sold.</p>
        <a class="t2-pill" href="#mbFeed">Shop this style ↓</a></div>`;
    els.look.innerHTML = shown.map(card).join('');
    $('mbFeedTitle').textContent = `More ${board.name} pieces`;
    document.title = `${board.name} mood board | Furnish Finder UAE`;
  }

  // ---- the feed: category first (chips), then price / store / on sale, then the order
  const main = () => board.groups.filter(g => !g.extra), extra = () => board.groups.filter(g => g.extra);
  function pool() {                                   // products of the chosen category, or a balanced mix of the pictured categories
    const g = state.cat && board.groups.find(x => x.key === state.cat);
    if (g) return g.items.slice();
    const out = [], gs = main(), n = Math.max(0, ...gs.map(x => x.items.length));
    for (let i = 0; i < n; i++) for (const x of gs) if (x.items[i]) out.push(x.items[i]);
    return out;
  }
  function inPrice(c) {
    if (!state.price) return true;
    const [lo, hi] = state.price.split('-');
    return c.price >= Number(lo) && (hi === '' || c.price < Number(hi) + 1);
  }
  function current() {
    const base = pool().filter(c => inPrice(c) && (!state.sale || off(c) > 0));
    const stores = new Map();
    base.forEach(c => stores.set(c.store, (stores.get(c.store) || 0) + 1));
    let rows = state.store ? base.filter(c => c.store === state.store) : base;
    if (state.sort === 'price-low') rows = rows.slice().sort((a, b) => a.price - b.price);
    else if (state.sort === 'price-high') rows = rows.slice().sort((a, b) => b.price - a.price);
    else if (state.sort === 'discount') rows = rows.slice().sort((a, b) => off(b) - off(a));
    return { rows, stores };
  }
  function chips() {
    const chip = (k, t, n) => `<button type="button" class="t2-chip${k === state.cat ? ' on' : ''}" data-cat="${esc(k)}" aria-pressed="${k === state.cat}">${esc(t)}${n ? ` <i>${n}</i>` : ''}</button>`;
    els.chips.innerHTML = chip('', 'All', 0) + main().map(g => chip(g.key, g.name, g.items.length)).join('')
      + (extra().length ? '<span class="mb-chip-sep">Also in this style</span>' + extra().map(g => chip(g.key, g.name, g.items.length)).join('') : '');
  }
  function syncURL() {
    const p = new URLSearchParams({ b: key });
    if (state.cat) p.set('cat', state.cat);
    if (state.price) p.set('price', state.price);
    if (state.store) p.set('store', state.store);
    if (state.sale) p.set('sale', '1');
    if (state.sort !== 'match') p.set('sort', state.sort);
    history.replaceState(null, '', location.pathname + '?' + p + location.hash);
  }
  function render() {
    if (state.cat && !board.groups.some(g => g.key === state.cat)) state.cat = '';
    const { rows, stores } = current();
    chips();
    const list = [...stores.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (state.store && !stores.has(state.store)) list.push([state.store, 0]);
    els.store.innerHTML = '<option value="">All stores</option>' + list.map(([s, n]) => `<option value="${esc(s)}">${esc(s)} (${n})</option>`).join('');
    els.store.value = state.store; els.price.value = state.price; els.sale.checked = state.sale; els.sort.value = state.sort;
    const g = state.cat && board.groups.find(x => x.key === state.cat);
    els.count.textContent = `${rows.length} ${rows.length === 1 ? 'product' : 'products'}${g ? ' in ' + g.name.toLowerCase() : ', a mix of every category in the picture'}`;
    els.grid.innerHTML = rows.slice(0, state.shown).map(card).join('');
    els.more.hidden = state.shown >= rows.length;
    els.empty.hidden = rows.length > 0; els.grid.hidden = rows.length === 0;
    syncURL();
  }
  const go = () => { state.shown = PAGE; render(); };
  els.chips.addEventListener('click', e => { const c = e.target.closest('[data-cat]'); if (c) { state.cat = c.dataset.cat; state.store = ''; go(); } });
  els.price.addEventListener('change', () => { state.price = els.price.value; go(); });
  els.store.addEventListener('change', () => { state.store = els.store.value; go(); });
  els.sale.addEventListener('change', () => { state.sale = els.sale.checked; go(); });
  els.sort.addEventListener('change', () => { state.sort = els.sort.value; go(); });
  els.more.addEventListener('click', () => { state.shown += PAGE; render(); });
  $('mbReset').addEventListener('click', () => { Object.assign(state, { price: '', store: '', sale: false }); go(); });
  // dots: hover works by itself; on touch a tap opens one card and closes the others
  document.addEventListener('click', e => {
    const b = e.target.closest('.mb-dot > button');
    document.querySelectorAll('.mb-dot.open').forEach(d => { if (!b || d !== b.parentElement) d.classList.remove('open'); });
    if (b) b.parentElement.classList.toggle('open');
  });

  Promise.all([FF.fetchJSON(`data/boards/${key}.json`), FF.fetchJSON('data/boards/index.json').catch(() => ({ boards: [] }))]).then(([b, idx]) => {
    board = b;
    hero(); render();
    const others = idx.boards.filter(x => x.key !== key);
    $('mbOthers').innerHTML = others.map(tile).join('');
    $('mbOtherSec').hidden = !others.length;
  }).catch(err => {
    console.error(err);
    els.hero.innerHTML = '<p class="mb-loading">This mood board could not be loaded. <a href="moodboards.html">See all mood boards</a></p>';
  });
})();
