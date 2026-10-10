/* couchpotato.ae (formerly Furnish Finder UAE) - shared data layer.
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
      if (i < 0) FF.track('add_to_wishlist', { item_id: id, room });
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
          <p class="pc-price">${o.from ? '<span class="pc-price-from">From</span>' : ''}<span class="pc-price-now">${FF.money(o.price)}</span>${o.orig > o.price ? `<span class="pc-price-was"><span class="visually-hidden">Was </span>${FF.money(o.orig)}</span>` : ''}${disc ? `<span class="pc-off">-${Math.round(disc * 100)}%</span>` : ''}</p>
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
  // Rooms (data/rooms.json, rebuilt nightly by agents/ff_agents/rooms.py). Owner, 2026-10-08: furniture is navigated room first,
  // product groups inside (Furniture > Living Room > Sofas), the way Pan Home does it; the catalogue's own furniture groups
  // ("Sofas & Seating" next to "Living Room") are no longer shown in the menu.
  FF.rooms = { rooms: {}, furniture: [], of: {} };
  FF.loadRooms = () => FF._rooms || (FF._rooms = FF.fetchJSON('data/rooms.json')
    .then(d => (FF.rooms = { rooms: d.rooms || {}, furniture: d.furniture || [], of: d.of || {} })).catch(() => FF.rooms));
  FF.furnRoomLink = room => 'browse.html?c=furniture&room=' + FF.enc(room);

  FF.renderNav = el => {
    const rooms = FF.rooms.furniture;
    el.innerHTML = FF.meta.tree.map(l1 => `
      <div class="nav-item">
        <a class="nav-l1" href="browse.html?c=${FF.enc(l1.s)}">${FF.esc(l1.n)}</a>
        <div class="nav-dropdown">
          ${l1.s === 'furniture' && rooms.length ? rooms.map(r => `<a href="${FF.furnRoomLink(r.n)}">${FF.esc(r.n)}</a>`).join('')
            : l1.ch.map(l2 => `<a href="browse.html?c=${FF.enc(l2.s)}">${FF.esc(l2.n)}</a>`).join('')}
        </div>
      </div>`).join('');
  };

  // Header + footer (PRD v1.2 §5.3, §5.13): rotating honest messages, promo bar from tonight's capped deals, footer category links
  FF.headerInit = () => {
    const util = FF.$('announce'), promo = FF.$('promoBar'), shop = FF.$('footerShop');
    FF.loadMeta().then(m => {
      const stores = m.stores.filter(s => s.c > 0).length, total = Math.floor(m.total / 1000) * 1000;
      if (shop) shop.innerHTML = m.tree.map(l1 => `<a href="/c/${FF.esc(l1.s)}/">${FF.esc(l1.n)}</a>`).join('');
      if (!util || util.dataset.static) return;
      const msgs = ['One search across UAE home stores', `${total.toLocaleString()}+ products, prices refreshed nightly`, 'Buy direct from the retailer'];
      let i = 0; util.textContent = msgs[0];
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) setInterval(() => { i = (i + 1) % msgs.length; util.textContent = msgs[i]; }, 6000);
    }).catch(() => {});
    if (promo) FF.fetchJSON('data/home.json').then(h => {       // deals already skip discounts above 80% (inflated was-prices)
      const max = Math.max(0, ...(h.deals || []).map(d => d.o > d.p ? Math.round((d.o - d.p) / d.o * 100) : 0));
      promo.textContent = max ? `Tonight's biggest drops, up to ${max}% off ›` : "Tonight's deals ›";
    }).catch(() => {});
  };

  // Accounts (owner, 2026-10-09): "Sign in with Google" through Supabase Auth, so a wishlist follows the shopper to every device.
  // We never see a password: Google confirms who it is, Supabase keeps the session (its official library, js/vendor/, loaded only
  // when someone signs in or is signed in). The account holds one thing, the wishlist, in the table "wishlists", where the database
  // itself lets a signed-in person read and write only their own row (agents/ff_agents/db_sync.py ACCOUNTS_SQL).
  // LOGIN: 'off' = nothing shown; 'preview' = shown only after opening a page with ?login=1 (for the owner's test); 'on' = everyone.
  const LOGIN = 'on';
  const SB_REF = ((window.FF_DB && window.FF_DB.url || '').match(/^https:\/\/([a-z0-9]+)\./) || [])[1] || '';
  const OKEY = 'cp-wl-owner';                                   // the account this browser's wishlist copy belongs to
  const G_LOGO = '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.96 10.71a5.4 5.4 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z"/></svg>';
  const loginShown = () => {
    if (LOGIN === 'off' || !SB_REF || !window.FF_DB.key) return false;
    try {
      if (/[?&]login=1(&|$)/.test(location.search)) sessionStorage.setItem('cp-login', '1');
      return LOGIN === 'on' || sessionStorage.getItem('cp-login') === '1' || !!localStorage.getItem(`sb-${SB_REF}-auth-token`);
    } catch (_) { return LOGIN === 'on'; }
  };
  let sbP = null;
  function sb() {                                               // Supabase's own client, fetched on first use
    return sbP || (sbP = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'js/vendor/supabase-2.117.3.js';
      s.onload = () => res(window.supabase.createClient(window.FF_DB.url, window.FF_DB.key,
        { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } }));
      s.onerror = () => { sbP = null; rej(new Error('the sign-in library did not load')); };
      document.head.appendChild(s);
    }));
  }
  // only what a wishlist is made of is taken from, or sent to, the account
  const cleanWish = d => {
    const out = { v: 1, rooms: {} };
    for (const r of FF.ROOMS) out.rooms[r] = (d && d.rooms && Array.isArray(d.rooms[r]) ? d.rooms[r] : []).filter(x => x && typeof x.id === 'string' && x.id.length < 300).slice(0, 300);
    return out;
  };
  let wlTimer = null, wlQuiet = false;
  async function wlPush() {
    const u = FF.account.user; if (!u) return;
    const c = await sb();
    const { error } = await c.from('wishlists').upsert({ user_id: u.id, data: cleanWish(FF.wish.load()), updated_at: new Date().toISOString() });
    if (error) console.warn('wishlist not saved to the account:', error.message);
  }
  async function wlSync() {
    const u = FF.account.user; if (!u) return;
    const c = await sb();
    const { data, error } = await c.from('wishlists').select('data').eq('user_id', u.id).maybeSingle();
    if (error) { console.warn('wishlist not read from the account:', error.message); return; }
    let owner = ''; try { owner = localStorage.getItem(OKEY) || ''; } catch (_) {}
    const local = cleanWish(FF.wish.load()), remote = data ? cleanWish(data.data) : null;
    let next;
    if (owner === u.id) next = remote || local;                 // this browser is already on the account: the account's copy wins
    else {                                                      // first sign-in here: what was saved before is added to the account
      next = cleanWish(remote);                                 // a copy: the account's list, plus what this browser had
      for (const r of FF.ROOMS) for (const it of local.rooms[r]) if (!next.rooms[r].some(x => x.id === it.id)) next.rooms[r].push(it);
    }
    try { localStorage.setItem(OKEY, u.id); } catch (_) {}
    if (JSON.stringify(next) !== JSON.stringify(local)) { wlQuiet = true; FF.wish.save(next); wlQuiet = false; }
    if (!remote || JSON.stringify(remote) !== JSON.stringify(next)) await wlPush();
  }
  document.addEventListener('ff-wish', () => { if (wlQuiet || !FF.account.user) return; clearTimeout(wlTimer); wlTimer = setTimeout(() => wlPush().catch(() => {}), 700); });

  function acctDraw() {
    const u = FF.account.user, first = u ? String((u.user_metadata && (u.user_metadata.full_name || u.user_metadata.name)) || u.email || '').split(/[ @]/)[0] : '';
    const acts = document.querySelector('.nn-actions');
    if (acts) {
      let box = FF.$('cpAcctBox');
      if (!box) { box = document.createElement('div'); box.id = 'cpAcctBox'; box.className = 'cp-acct-box'; acts.insertBefore(box, acts.firstChild); }
      box.innerHTML = u
        ? `<button type="button" class="cp-acct" id="cpAcctBtn" aria-expanded="false" aria-controls="cpAcctMenu"><span class="cp-acct-i" aria-hidden="true">${FF.esc(first.slice(0, 1).toUpperCase())}</span><span class="cp-acct-t">Hi, ${FF.esc(first)}</span></button>
           <div class="cp-acct-menu" id="cpAcctMenu" hidden><p>${FF.esc(u.email || '')}</p><a href="wishlist.html">My wishlist</a><button type="button" data-signout>Sign out</button></div>`
        : '<button type="button" class="cp-acct" data-signin aria-label="Sign in"><span class="cp-acct-t">Sign in</span><span class="cp-acct-i cp-acct-o" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.600 8 7"/></svg></span></button>';
    }
    const sum = FF.$('wishSummary');                            // the wishlist page: say where the list is kept
    if (sum) {
      let card = FF.$('cpAcctCard');
      if (!card) { card = document.createElement('div'); card.id = 'cpAcctCard'; card.className = 'cp-acct-card'; sum.insertAdjacentElement('afterend', card); }
      card.innerHTML = u
        ? `<p>Saved to your account <strong>${FF.esc(u.email || '')}</strong>. Sign in on any device to see it.</p><button type="button" class="cp-acct-out" data-signout>Sign out</button>`
        : `<p><strong>Keep your wishlist on your phone and your computer.</strong> Sign in and it follows you. From Google we only receive your name, email and profile picture. <a href="privacy.html">Privacy</a></p>
           <button type="button" class="cp-google" data-signin>${G_LOGO}<span>Sign in with Google</span></button>`;
      const where = document.querySelector('.wish-head .nn-eyebrow, .wish-eyebrow');
      if (where) where.textContent = u ? 'Saved to your account' : 'Saved in this browser';
    }
  }
  FF.account = {
    user: null,
    async signIn() {
      try {
        const c = await sb();
        const { error } = await c.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + '/wishlist.html' } });
        if (error) throw error;
      } catch (e) { console.warn(e); alert('Sorry, sign-in is not available right now. Please try again in a moment.'); }
    },
    async signOut() { try { const c = await sb(); await c.auth.signOut({ scope: 'local' }); } catch (e) { console.warn(e); } }
  };
  function acctSet(user, ev) {
    const was = FF.account.user;
    FF.account.user = user || null;
    acctDraw();
    if (user && (!was || was.id !== user.id)) { FF.track('login', { method: 'Google' }); wlSync().catch(e => console.warn(e)); }
    if (!user && ev === 'SIGNED_OUT') {                          // signed out: the list stays in the account, not on this device
      let owned = false; try { owned = !!localStorage.getItem(OKEY); localStorage.removeItem(OKEY); if (owned) localStorage.removeItem(WKEY); } catch (_) {}
      if (owned) { wlQuiet = true; document.dispatchEvent(new CustomEvent('ff-wish')); wlQuiet = false; }
    }
  }
  function acctInit() {
    if (!loginShown()) return;
    acctDraw();
    document.addEventListener('click', e => {
      if (e.target.closest('[data-signin]')) { FF.account.signIn(); return; }
      if (e.target.closest('[data-signout]')) { FF.account.signOut(); return; }
      const b = e.target.closest('#cpAcctBtn'), m = FF.$('cpAcctMenu');
      if (m) { const open = !!b && m.hidden; m.hidden = !open; const btn = FF.$('cpAcctBtn'); if (btn) btn.setAttribute('aria-expanded', String(open)); }
    });
    let back = false, has = false;
    try { back = /[?&](code|error_description)=/.test(location.search); has = !!localStorage.getItem(`sb-${SB_REF}-auth-token`); } catch (_) {}
    if (back || has) sb().then(c => c.auth.onAuthStateChange((ev, session) => setTimeout(() => acctSet(session && session.user, ev), 0))).catch(e => console.warn(e));
  }

  // The address search engines should file a page under: always https://www.couchpotato.ae (the old onrender.com address serves the
  // same pages), with only the parameters that change what the page shows: category / room / search, product, mood board.
  // The listing page calls it again whenever it changes its own address. agents/ff_agents/sitemap.py writes the same form.
  const SITE = 'https://www.couchpotato.ae';
  FF.canonical = () => {
    const src = new URLSearchParams(location.search), page = location.pathname.split('/').pop() || 'index.html', p = new URLSearchParams();
    ({ 'browse.html': ['q', 'c', 'room'], 'product.html': ['id'], 'board.html': ['b'] }[page] || []).forEach(k => { if (src.get(k)) p.set(k, src.get(k)); });
    const qs = p.toString().replace(/%2C/gi, ',');
    let href = SITE + '/' + (page === 'index.html' ? '' : page) + (qs ? '?' + qs : '');
    // categories and rooms have a readable page of their own (/c/<category>/, /room/<room>/, written nightly by static_pages.py)
    const slug = r => r.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (/^\/(c|room)\/[a-z0-9\/-]+$/.test(location.pathname)) href = SITE + location.pathname.replace(/\/?$/, '/');      // with or without the last slash
    else if (page === 'browse.html' && !src.get('q')) {
      const c0 = src.get('c') || '', c = (window.FF_CAT_REDIRECTS || {})[c0] || c0, room = src.get('room') || '';
      const okC = /^[a-z0-9-]+(\/[a-z0-9-]+){0,2}$/.test(c), okR = /^[A-Za-z ]+$/.test(room);
      if (okC && c === 'furniture' && okR) href = SITE + '/room/' + slug(room) + '/furniture/';
      else if (okC) href = SITE + '/c/' + c + '/';
      else if (!c && okR) href = SITE + '/room/' + slug(room) + '/';
    }
    let l = document.querySelector('link[rel="canonical"]');
    if (!l) { l = document.createElement('link'); l.rel = 'canonical'; document.head.appendChild(l); }
    l.href = href;
    let o = document.querySelector('meta[property="og:url"]');
    if (!o) { o = document.createElement('meta'); o.setAttribute('property', 'og:url'); document.head.appendChild(o); }
    o.content = href;
  };
  FF.canonical();

  // Google Analytics (GA4) behind a cookie notice. Nothing is loaded and no notice is shown while GA_ID is empty. With an ID, Google's
  // script loads only after the visitor presses Accept; Decline (or a browser that sends the "do not sell or share" signal) loads nothing.
  // Page views and searches (?q=) are counted by Google's own measurement; the two events sent from here are store_click (a click out
  // to a store, on links that carry data-store) and add_to_wishlist.
  const GA_ID = 'G-5SXZYP4BY2';
  const CKEY = 'cp-cookies';                                    // 'yes' | 'no', kept in this browser
  let gaOn = false;
  function gtag() { window.dataLayer.push(arguments); }
  FF.track = (name, params) => { if (gaOn) gtag('event', name, params || {}); };
  function gaStart() {
    if (gaOn || !GA_ID || /^(localhost|127\.|\[::1\])/.test(location.hostname)) return;     // never count our own test pages
    gaOn = true; window['ga-disable-' + GA_ID] = false; window.dataLayer = window.dataLayer || [];
    if (!document.getElementById('cpGa')) {
      const s = document.createElement('script'); s.id = 'cpGa'; s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
      document.head.appendChild(s);
      const here = new URL(location.href); ['code', 'state', 'error', 'error_code', 'error_description'].forEach(k => here.searchParams.delete(k));   // never the sign-in return code
      gtag('js', new Date()); gtag('config', GA_ID, { page_location: here.href });
    }
  }
  function gaStop() {                                           // changed their mind: stop sending and drop Google's cookies
    gaOn = false; if (!GA_ID) return;
    window['ga-disable-' + GA_ID] = true;
    document.cookie.split(';').map(c => c.split('=')[0].trim()).filter(n => /^_ga/.test(n)).forEach(n => {
      [location.hostname, '.' + location.hostname, '.' + location.hostname.split('.').slice(-2).join('.')].forEach(d => { document.cookie = `${n}=; Max-Age=0; path=/; domain=${d}`; });
      document.cookie = `${n}=; Max-Age=0; path=/`;
    });
  }
  const cookieChoice = () => { try { return localStorage.getItem(CKEY) || ''; } catch (_) { return ''; } };
  function cookieAsk() {
    let bar = FF.$('cpCookies');
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'cpCookies'; bar.className = 'cp-cookies'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Cookies');
      bar.innerHTML = '<p>We use Google Analytics cookies to see how the site is used, so we can make it better.</p>'
        + '<div><button type="button" data-ck="no">Decline</button><button type="button" class="cp-ck-yes" data-ck="yes">Accept</button></div>';
      bar.addEventListener('click', e => {
        const b = e.target.closest('[data-ck]'); if (!b) return;
        try { localStorage.setItem(CKEY, b.dataset.ck); } catch (_) {}
        if (b.dataset.ck === 'yes') gaStart(); else gaStop();
        bar.hidden = true;
      });
      document.body.appendChild(bar);
    }
    bar.hidden = false;
  }
  function cookieInit() {
    if (!GA_ID) return;
    const note = document.querySelector('.nn-footer-note');     // a way back to the choice, on every page
    if (note) { note.insertAdjacentHTML('beforeend', ' <button type="button" class="cp-ck-link" id="cpCookieLink">Cookie settings</button>'); FF.$('cpCookieLink').addEventListener('click', cookieAsk); }
    if (navigator.globalPrivacyControl) return;                 // the browser already said no on the visitor's behalf
    const c = cookieChoice();
    if (c === 'yes') gaStart(); else if (c !== 'no') cookieAsk();
  }
  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-store]'); if (!a || !gaOn) return;
    let host = ''; try { host = new URL(a.href).hostname; } catch (_) {}
    FF.track('store_click', { store: a.dataset.store, item_id: a.dataset.pid || '', link_domain: host });
  });

  document.addEventListener('DOMContentLoaded', () => {
    const nav = FF.$('categoryNav');
    if (nav) Promise.all([FF.loadMeta(), FF.loadRooms()]).then(() => FF.renderNav(nav));
    // "All categories" in the header: a panel with every department and what is inside it
    const catBtn = FF.$('cpCatBtn');
    if (catBtn) {
      const box = catBtn.parentElement, set = on => { box.classList.toggle('open', on); catBtn.setAttribute('aria-expanded', String(on)); };
      catBtn.addEventListener('click', e => { e.stopPropagation(); set(!box.classList.contains('open')); });
      document.addEventListener('click', e => { if (!box.contains(e.target)) set(false); });
      document.addEventListener('keydown', e => { if (e.key === 'Escape') set(false); });
    }
    FF.headerInit();
    cookieInit();
    acctInit();
  });
})();
