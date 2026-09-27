/* Furnish Finder UAE - shared data layer.
   Data lives in dist/data:  meta.json (taxonomy), l/<category>.json (listing rows), d/<n>.json (product details). */
(function () {
  'use strict';
  const script = document.currentScript;
  const FF = window.FF = { v: (script && script.dataset.v) || '', meta: null, stores: [], catL: [], shards: [], shardRows: {}, byId: new Map() };

  const fmt = new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 });
  FF.money = v => fmt.format(v || 0);
  FF.esc = (v = '') => String(v).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[c]));
  FF.enc = encodeURIComponent;
  // Pan Home image links carry a resize option with empty width/height (cdn-cgi/image/quality=70,height=,width=/); the plain media path is the same file
  FF.fixImg = u => u ? u.replace(/\/cdn-cgi\/image\/[^/]*\//, '/') : u;
  FF.$ = id => document.getElementById(id);

  // Big data files are stored gzip-compressed (.json.gz) to keep the repo small; small ones are plain JSON.
  FF.fetchJSON = async url => {
    const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'v=' + FF.v);
    if (!r.ok) throw new Error('Could not load ' + url + ' (' + r.status + ')');
    if (!/\.gz$/.test(url)) return r.json();
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {                     // still gzipped: decompress in the browser
      if (typeof DecompressionStream === 'undefined') throw new Error('This browser is too old to open the catalogue');
      return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
    }
    return JSON.parse(new TextDecoder().decode(bytes));               // the host already decompressed it
  };

  // FNV-1a 32-bit over UTF-8 bytes; must match build_site.py
  FF.fnv = str => {
    let h = 0x811c9dc5;
    for (const b of new TextEncoder().encode(str)) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  };

  const singular = t => {
    if (t.length < 4) return t;
    if (t.endsWith('ies')) return t.slice(0, -3) + 'y';
    if (/(ches|shes|xes|sses)$/.test(t)) return t.slice(0, -2);
    if (t.endsWith('s') && !t.endsWith('ss') && !t.endsWith('us')) return t.slice(0, -1);
    return t;
  };
  FF.singular = singular;
  FF.terms = q => String(q || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(singular);

  function prepare(m) {
    FF.meta = m;
    FF.stores = m.stores.map(s => s.n);
    FF.l1Order = new Map(m.tree.map((n, i) => [n.n, i]));
    FF.catL = m.cats.map(c => ({
      l1: c[0], l2: c[1], l3: c[2],
      text: c.join(' ').toLowerCase(),
      l3n: c[2].toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(singular).join(' ')
    }));
    FF.shards = [];
    m.tree.forEach(l1 => l1.ch.forEach(l2 => FF.shards.push({ key: l2.f, l1: l1.n, l2: l2.n, slug: l2.s })));
    return m;
  }
  FF.loadMeta = () => FF._meta || (FF._meta = FF.fetchJSON('data/meta.json').then(prepare));

  // slug path ("furniture/sofas-sectionals/sofas") -> {l1, l2, l3} tree nodes
  FF.node = slugPath => {
    const out = { l1: null, l2: null, l3: null };
    if (!slugPath || !FF.meta) return out;
    const [a, b, c] = slugPath.split('/');
    out.l1 = FF.meta.tree.find(n => n.s === a) || null;
    if (out.l1 && b) out.l2 = out.l1.ch.find(n => n.s === a + '/' + b) || null;
    if (out.l2 && c) out.l3 = out.l2.ch.find(n => n.s === a + '/' + b + '/' + c) || null;
    return out;
  };

  // Size/colour cards: a product sold in several sizes/colours has extra rows "<product id>~<size>~<colour>" that share its detail
  // record; the optional 10th field says which size (z) and colour (k) the card shows, how many colours exist (c), how many more
  // colours than the cards shown (m), whether other options change the price ("from", f) and which option to open (q).
  FF.baseId = id => String(id).split('~')[0];
  FF.slug = v => String(v || '').toLowerCase().replace(/[^a-z0-9+]+/g, '-').replace(/^-+|-+$/g, '') || 'x';

  FF.rowFrom = a => {
    const [id, name, s, c, price, orig, img0, room, opts, at] = a;
    const img = FF.fixImg(img0);
    const cat = FF.catL[c];
    const x = at || {};
    return {
      id, name, s, c, price, orig, img, opts, store: FF.stores[s], room: room >= 0 ? FF.meta.rooms[room] : '',
      size: x.z || '', colour: x.k || '', colours: x.c || 0, moreColours: x.m || 0, from: at ? !!x.f : opts > 1, q: x.q,
      save: orig > price ? orig - price : 0, disc: orig > price ? (orig - price) / orig : 0, f: (orig > price ? (orig - price) / orig : 0) * 2 + (img ? 1 : 0), l1: cat.l1, l2: cat.l2, l3: cat.l3,
      nameL: name.toLowerCase(), catL: cat.text, storeL: FF.stores[s].toLowerCase(), pri: FF.l1Order.get(cat.l1)
    };
  };

  const shardPromises = {};
  FF.loadShard = key => shardPromises[key] || (shardPromises[key] = FF.fetchJSON('data/l/' + key + '.json.gz').then(rows => {
    const objs = rows.map(FF.rowFrom);
    for (const o of objs) FF.byId.set(o.id, o);
    FF.shardRows[key] = objs;
    return objs;
  }));

  const chunkPromises = {};
  FF.loadDetail = id => {
    id = FF.baseId(id);
    const n = FF.fnv(id) % FF.meta.chunks;
    const file = String(n).padStart(3, '0');
    const p = chunkPromises[file] || (chunkPromises[file] = FF.fetchJSON('data/d/' + file + '.json.gz'));
    return p.then(chunk => chunk[id] || null);
  };

  FF.img = (src, alt, cls) => src
    ? `<img class="${cls}" src="${FF.esc(src)}" alt="${FF.esc(alt)}" loading="lazy" onerror="FF.imgErr(this)">`
    : '<div class="image-fallback">Image unavailable</div>';
  FF.imgErr = img => {
    // Pan Home image links carry an empty resize option; try the plain media path once before giving up
    if (!img.dataset.retry && /\/cdn-cgi\/image\/[^/]*\//.test(img.src)) {
      img.dataset.retry = 1;
      img.src = img.src.replace(/\/cdn-cgi\/image\/[^/]*\//, '/');
      return;
    }
    const d = document.createElement('div');
    d.className = 'image-fallback';
    d.textContent = 'Image unavailable';
    img.replaceWith(d);
  };

  // Product card (design handoff 2026-09-28), shared by browse/search, homepage deals and similar items.
  // o: {id, name, store, img, price, orig, disc, from, size, colours}. Store sits in the "brand" slot.
  const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg>';
  const DOTS = '<svg width="22" height="12" viewBox="0 0 22 12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="#E8E5DE" stroke="#fff"/><circle cx="11" cy="6" r="5" fill="#B5B0A8" stroke="#fff"/><circle cx="16" cy="6" r="5" fill="#77736D" stroke="#fff"/></svg>';
  // Wishlist by room (saved in this browser; accounts later). {v:1, rooms: {"Bedroom": [{id, name, store, img, price, orig, size, colours, from, t}]}}
  FF.ROOMS = ['Living Room', 'Bedroom', 'Dining Room', 'Kitchen', 'Bathroom'];
  const WKEY = 'ff-wishlist-rooms';
  FF.wish = {
    load() {
      let w = null;
      try { w = JSON.parse(localStorage.getItem(WKEY) || 'null'); } catch (_) {}
      if (!w || !w.rooms) {
        w = { v: 1, rooms: {} };
        try {                                          // hearts saved before rooms existed go to Living Room
          const old = JSON.parse(localStorage.getItem('ff-wishlist') || '[]');
          if (old.length) w.rooms['Living Room'] = old.map(id => ({ id, t: Date.now() }));
        } catch (_) {}
      }
      for (const r of FF.ROOMS) w.rooms[r] = w.rooms[r] || [];
      return w;
    },
    save(w) { try { localStorage.setItem(WKEY, JSON.stringify(w)); } catch (_) {} document.dispatchEvent(new CustomEvent('ff-wish')); },
    roomsOf(id) { const w = FF.wish.load(); return FF.ROOMS.filter(r => w.rooms[r].some(x => x.id === id)); },
    toggle(id, room, snap) {
      const w = FF.wish.load(), list = w.rooms[room], i = list.findIndex(x => x.id === id);
      if (i >= 0) list.splice(i, 1); else list.unshift({ ...(snap || {}), id, t: Date.now() });
      FF.wish.save(w);
      return i < 0;
    },
    count() { const w = FF.wish.load(); return new Set(FF.ROOMS.flatMap(r => w.rooms[r].map(x => x.id))).size; }
  };
  FF.wishlist = () => { const w = FF.wish.load(); return new Set(FF.ROOMS.flatMap(r => w.rooms[r].map(x => x.id))); };
  FF._snap = new Map();                               // card data by id, for the "save to room" pop-up
  FF.pcCard = o => {
    FF._snap.set(o.id, { name: o.name, store: o.store, img: o.img, price: o.price, orig: o.orig, size: o.size || '', colours: o.colours || 0,
                         from: !!o.from, room: o.room || '' });
    const fav = FF.wishlist().has(o.id), href = 'product.html?id=' + FF.enc(o.id);
    const right = [o.size ? FF.esc(o.size) : '', o.colours > 1 ? `${o.size ? '' : DOTS}${o.colours} colours` : ''   /* no dots next to a size: keeps room for the store name */].filter(Boolean).join(' · ');
    const img = o.img ? `<img src="${FF.esc(o.img)}" alt="${FF.esc(o.name)}" loading="lazy" onerror="FF.imgErr(this)">` : '<div class="image-fallback">Image unavailable</div>';
    const disc = o.disc || (o.orig > o.price ? (o.orig - o.price) / o.orig : 0);
    return `<li class="pc-card" data-product-id="${FF.esc(o.id)}">
      <div class="pc-media">
        ${disc ? `<span class="pc-badge">-${Math.round(disc * 100)}%</span>` : ''}
        <button class="pc-wishlist" type="button" data-wish="${FF.esc(o.id)}" aria-pressed="${fav}" aria-label="${fav ? 'Remove from wishlist' : 'Add to wishlist'}">${HEART}</button>
        ${img}
      </div>
      <div class="pc-body">
        <div class="pc-meta"><span class="pc-brand">${FF.esc(o.store || '')}</span>${right ? `<span class="pc-colours">${right}</span>` : ''}</div>
        <a class="pc-name" href="${href}" target="_blank" rel="noopener" title="${FF.esc(o.name)}">${FF.esc(o.name)}</a>
        <p class="pc-price">${o.from ? '<span class="pc-price-from">From</span>' : ''}<span class="pc-price-now">${FF.money(o.price)}</span>${o.orig > o.price ? `<span class="pc-price-was"><span class="visually-hidden">Was </span>${FF.money(o.orig)}</span>` : ''}</p>
      </div>
    </li>`;
  };
  // "Save to a room" pop-up, opened by any heart ([data-wish]); one shared element
  let pop = null, popFor = null;
  function closePop() { if (pop) { pop.hidden = true; popFor = null; } }
  function paintPop() {
    const id = popFor.dataset.wish, saved = FF.wish.roomsOf(id), sug = (FF._snap.get(id) || {}).room;
    pop.innerHTML = `<p class="wish-pop-title">Save to a room</p>
      <div class="wish-pop-rooms">${FF.ROOMS.map(r => `<button type="button" class="wish-room${saved.includes(r) ? ' on' : ''}" data-room="${FF.esc(r)}" aria-pressed="${saved.includes(r)}">
        <span class="wish-check" aria-hidden="true">${saved.includes(r) ? '✓' : '+'}</span>${FF.esc(r)}${r === sug && !saved.includes(r) ? '<small>suggested</small>' : ''}</button>`).join('')}</div>
      <a class="wish-pop-link" href="wishlist.html">View wishlist →</a>`;
  }
  function placePop(btn) {
    const r = btn.getBoundingClientRect(), w = Math.min(240, window.innerWidth - 24);
    pop.style.width = w + 'px';
    pop.style.left = Math.max(12, Math.min(window.scrollX + r.right - w, window.scrollX + window.innerWidth - w - 12)) + 'px';
    pop.style.top = (window.scrollY + r.bottom + 8) + 'px';
  }
  function syncHearts(id) {
    const on = FF.wish.roomsOf(id).length > 0;
    document.querySelectorAll(`[data-wish="${CSS.escape(id)}"]`).forEach(h => { h.setAttribute('aria-pressed', String(on)); h.setAttribute('aria-label', on ? 'Saved to your wishlist' : 'Save to wishlist'); });
    document.querySelectorAll('[data-wish-count]').forEach(el => { const n = FF.wish.count(); el.textContent = n ? n : ''; });
  }
  document.addEventListener('click', e => {
    const room = e.target.closest('.wish-room');
    if (room && popFor) {
      const id = popFor.dataset.wish;
      FF.wish.toggle(id, room.dataset.room, FF._snap.get(id));
      paintPop(); syncHearts(id); return;
    }
    const heart = e.target.closest('[data-wish]');
    if (heart) {
      e.preventDefault(); e.stopPropagation();
      if (popFor === heart) return closePop();
      if (!pop) { pop = document.createElement('div'); pop.className = 'wish-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Save to a room'); document.body.appendChild(pop); }
      popFor = heart; pop.hidden = false; paintPop(); placePop(heart);
      const first = pop.querySelector('.wish-room'); if (first) first.focus();
      return;
    }
    if (pop && !pop.hidden && !e.target.closest('.wish-pop')) closePop();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && pop && !pop.hidden) { const h = popFor; closePop(); if (h) h.focus(); } });
  window.addEventListener('resize', closePop);
  document.addEventListener('DOMContentLoaded', () => document.querySelectorAll('[data-wish-count]').forEach(el => { const n = FF.wish.count(); el.textContent = n ? n : ''; }));

  FF.toast = message => {
    const t = FF.$('toast');
    if (!t) return;
    t.textContent = message; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 1800);
  };

  FF.retailerURL = (url, variantId) => {
    const raw = String(url || '');
    if (!variantId || !/\/products\//i.test(raw)) return raw;
    try { const u = new URL(raw); u.searchParams.set('variant', variantId); return u.toString(); } catch (_) { return raw; }
  };

  // Header category nav: one item per Level-1 category, each with a Level-2 dropdown. Built from the live
  // taxonomy (meta.json), so it always matches whatever categories actually exist - nothing hardcoded here.
  FF.renderNav = el => {
    el.innerHTML = FF.meta.tree.map(l1 => `
      <div class="nav-item">
        <a class="nav-l1" href="browse.html?c=${FF.enc(l1.s)}">${FF.esc(l1.n)}</a>
        <div class="nav-dropdown">
          ${l1.ch.map(l2 => `<a href="browse.html?c=${FF.enc(l2.s)}">${FF.esc(l2.n)}</a>`).join('')}
        </div>
      </div>`).join('');
  };

  document.addEventListener('DOMContentLoaded', () => {
    const nav = FF.$('categoryNav');
    if (nav) FF.loadMeta().then(() => FF.renderNav(nav));
  });
})();
