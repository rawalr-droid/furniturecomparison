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
  // Database (Supabase), stage B: js/db-config.js sets window.FF_DB { url, key, enabled }. The page asks the database for what it
  // shows; if the database is slow or unreachable the same page view carries on from the published files (data/*.json.gz).
  // Add ?db=0 to any page to force the published files.
  FF.db = {
    on: !!(window.FF_DB && window.FF_DB.enabled && window.FF_DB.url && window.FF_DB.key) && !/[?&]db=0(&|$)/.test(location.search),
    rpc(fn, body, ms = 6000, tries = 2) {           // one automatic retry (a slow or dropped connection), then the caller falls back
      const c = window.FF_DB, ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
      return fetch(`${c.url}/rest/v1/rpc/${fn}`, {
        method: 'POST', signal: ctl.signal, body: JSON.stringify(body || {}),
        headers: { apikey: c.key, Authorization: 'Bearer ' + c.key, 'Content-Type': 'application/json' }
      }).then(r => { if (!r.ok) throw new Error('database answered ' + r.status); return r.json(); })
        .finally(() => clearTimeout(t))
        .catch(e => { if (tries > 1) return FF.db.rpc(fn, body, ms + 3000, tries - 1); throw e; });
    },
    fail(err) { if (FF.db.on) console.warn('database unavailable, using the published files instead', err); FF.db.on = false; }
  };

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
    // a[10] = the nightly "Featured" number (photo look + capped discount + variety, agents/ff_agents/featured.py); rows without it sort last
    const img = FF.fixImg(img0);
    const cat = FF.catL[c];
    const x = at || {};
    return {
      id, name, s, c, price, orig, img, opts, store: FF.stores[s], room: room >= 0 ? FF.meta.rooms[room] : '',
      size: x.z || '', colour: x.k || '', colours: x.c || 0, moreColours: x.m || 0, from: at ? !!x.f : opts > 1, q: x.q,
      save: orig > price ? orig - price : 0, disc: orig > price ? (orig - price) / orig : 0, f: a[10] != null ? a[10] : (orig > price ? (orig - price) / orig : 0) * 2 + (img ? 1 : 0) - 1e7, l1: cat.l1, l2: cat.l2, l3: cat.l3,
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
    ? `<img referrerpolicy="no-referrer" class="${cls}" src="${FF.esc(src)}" alt="${FF.esc(alt)}" loading="lazy" onerror="FF.imgErr(this)">`
    : '<div class="image-fallback">Image unavailable</div>';
  // Card photos that do not fill the square (wide room photos, tall ones) get a soft blurred copy of themselves behind them instead of
  // white bars (owner, 2026-10-07). Square photos and plain studio shots stay exactly as they were.
  FF.imgFit = img => {
    const w = img.naturalWidth, h = img.naturalHeight;
    if (w && h && img.parentElement) img.parentElement.classList.toggle('has-bars', Math.abs(w / h - 1) > 0.06);
  };
  FF.imgErr = img => {
    // Pan Home photos have two addresses: the plain media path and the store's resized one. Now and then its image server answers one of
    // them with an empty page (seen 2026-10-07 on photos 2-6 of one table), so try the other address once before giving up.
    if (!img.dataset.retry) {
      const src = img.src;
      const other = /\/cdn-cgi\/image\/[^/]*\//.test(src) ? src.replace(/\/cdn-cgi\/image\/[^/]*\//, '/')
        : /^https:\/\/cdn2\.panhomestores\.com\/media\//.test(src) ? src.replace('/media/', '/cdn-cgi/image/quality=70,height=,width=/media/') : '';
      if (other) { img.dataset.retry = 1; img.src = other; return; }
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
  // Product card, Theme v2 "Option C" (spec 8): the photo as the store shows it with the discount badge and the heart on it; a dark
  // ribbon (store left, product type right); then name and price on the Plum panel. Size / colour sit at the right of the price row:
  // size · colour (colour cards) · "N colours" · "+N" (more colours than cards shown).
  FF.cleanName = n => { n = String(n || '').trim();                                         // ALL-CAPS store names read better in title case
    return /[A-Z]/.test(n) && n === n.toUpperCase() ? n.toLowerCase().replace(/(^|[\s\-\/(])([a-z])/g, (m, a, c) => a + c.toUpperCase()) : n; };
  FF.pcCard = o => {
    FF._snap.set(o.id, { name: o.name, store: o.store, img: o.img, price: o.price, orig: o.orig, size: o.size || '', colours: o.colours || 0,
                         from: !!o.from, room: o.room || '' });
    const fav = FF.wishlist().has(o.id), href = 'product.html?id=' + FF.enc(o.id) + (o.q != null ? '&o=' + o.q : '');     // o = the card's own option
    const parts = [o.size, o.colour, !o.colour && o.colours > 1 ? `${o.colours} colours` : ''].filter(Boolean).map(FF.esc);
    const more = o.moreColours ? `+${o.moreColours}${parts.length ? '' : ' more colours'}` : '';
    const tags = parts.length || more ? `<span class="pc-tags"><span class="pc-tags-text">${parts.join(' · ')}</span>${more ? `<span class="pc-more">${more}</span>` : ''}</span>` : '';
    const name = FF.esc(FF.cleanName(o.name));
    const img = o.img ? `<img referrerpolicy="no-referrer" src="${FF.esc(o.img)}" alt="${name}" loading="lazy" onload="FF.imgFit(this)" onerror="FF.imgErr(this)">` : '<div class="image-fallback">Image unavailable</div>';
    // the photo's address for the blurred backdrop (theme2.css .pc-media.has-bars), safe inside url('...') in a style attribute
    const bg = o.img ? ` style="--pc-bg:url('${FF.esc(String(o.img).replace(/[\\'()\s]/g, c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')))}')"` : '';
    const disc = o.disc || (o.orig > o.price ? (o.orig - o.price) / o.orig : 0);
    return `<li class="pc-card${disc ? ' on-sale' : ''}" data-product-id="${FF.esc(o.id)}">
      <div class="pc-media"${bg}>
        ${disc ? `<span class="pc-badge">-${Math.round(disc * 100)}%</span>` : ''}
        <button class="pc-wishlist" type="button" data-wish="${FF.esc(o.id)}" aria-pressed="${fav}" aria-label="${fav ? 'Saved to your wishlist' : 'Save to a room'}">${HEART}</button>
        ${img}
      </div>
      <div class="pc-meta pc-ribbon"><span class="pc-brand">${FF.esc(o.store || '')}</span>${o.l3 ? `<span class="pc-cat">${FF.esc(o.l3)}</span>` : ''}</div>
      <div class="pc-body">
        <a class="pc-name" href="${href}" target="_blank" rel="noopener" title="${name}">${name}</a>
        <div class="pc-row3">
          <p class="pc-price">${o.from ? '<span class="pc-price-from">From</span>' : ''}<span class="pc-price-now">${FF.money(o.price)}</span>${o.orig > o.price ? `<span class="pc-price-was"><span class="visually-hidden">Was </span>${FF.money(o.orig)}</span>` : ''}</p>
          ${tags}
        </div>
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

  // Header + footer (PRD v1.2 §5.3, §5.13): rotating honest messages, promo bar from tonight's capped deals, footer category links
  FF.headerInit = () => {
    const util = FF.$('announce'), promo = FF.$('promoBar'), shop = FF.$('footerShop');
    FF.loadMeta().then(m => {
      const stores = m.stores.filter(s => s.c > 0).length, total = Math.floor(m.total / 1000) * 1000;
      if (shop) shop.innerHTML = m.tree.map(l1 => `<a href="browse.html?c=${FF.enc(l1.s)}">${FF.esc(l1.n)}</a>`).join('');
      if (!util || util.dataset.static) return;
      const msgs = [`One search across ${stores} UAE home stores`, `${total.toLocaleString()}+ products, prices refreshed nightly`, 'Buy direct from the retailer'];
      let i = 0; util.textContent = msgs[0];
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) setInterval(() => { i = (i + 1) % msgs.length; util.textContent = msgs[i]; }, 6000);
    }).catch(() => {});
    if (promo) FF.fetchJSON('data/home.json').then(h => {       // deals already skip discounts above 80% (inflated was-prices)
      const max = Math.max(0, ...(h.deals || []).map(d => d.o > d.p ? Math.round((d.o - d.p) / d.o * 100) : 0));
      promo.textContent = max ? `Tonight's biggest drops, up to ${max}% off ›` : "Tonight's deals ›";
    }).catch(() => {});
  };

  document.addEventListener('DOMContentLoaded', () => {
    const nav = FF.$('categoryNav');
    if (nav) FF.loadMeta().then(() => FF.renderNav(nav));
    FF.headerInit();
  });
})();
