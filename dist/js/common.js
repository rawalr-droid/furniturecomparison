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
  // Mood-board scenes ship as WebP next to the JPEG (about half the bytes; Render bandwidth, 28 Oct). The board JSON still names the .jpg, so
  // board_*.jpg is mapped to board_*.webp, and if that file is missing (a scene added later) the .jpg is used. The Japandi picture stays a JPEG:
  // the nightly can redraw it in place (design_hook.py), which would leave a WebP copy out of date.
  FF.sceneSrc = u => (/^scenes\/board_[^?]+\.jpg$/.test(u) ? u.replace(/\.jpg$/, '.webp') : u);
  FF.sceneErr = (img, jpg, drop) => { if (/\.webp/.test(img.src) && jpg) img.src = jpg; else if (drop) img.remove(); };

  FF.rowFrom = a => {
    const [id, name, s, c, price, orig, img0, room, opts, at] = a;
    // a[10] = the nightly "Featured" number (photo look + capped discount + variety, agents/ff_agents/featured.py); rows without it sort last
    const img = FF.fixImg(img0);
    const cat = FF.catL[c];
    const x = at || {};
    return {
      id, name, s, c, price, orig, img, opts, store: FF.stores[s], room: room >= 0 ? FF.meta.rooms[room] : '',
      size: x.z || '', colour: x.k || '', colours: x.c || 0, moreColours: x.m || 0, from: at ? !!x.f : opts > 1, q: x.q, out: a[11] === 1,
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
    let disc = o.disc || (o.orig > o.price ? (o.orig - o.price) / o.orig : 0);
    if (!(o.price > 0) || disc > 0.805) disc = 0;                      // QC 2026-10-17: never show a discount above 80% (wrong was-price) or on a zero price
    const out = o.out === true || o.out === 1 || o.inStock === false;        // the store had none at the last check (owner, 2026-10-11: say so on the card)
    return `<li class="pc-card${disc ? ' on-sale' : ''}${out ? ' is-out' : ''}" data-product-id="${FF.esc(o.id)}">
      <div class="pc-media"${bg}>
        ${out ? '<span class="pc-out">Out of stock</span>' : ''}
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
      const msgs = ['One search across UAE home stores', `${total.toLocaleString()}+ products from UAE home stores`, 'Buy direct from the retailer'];
      let i = 0; util.textContent = msgs[0];
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) setInterval(() => { i = (i + 1) % msgs.length; util.textContent = msgs[i]; }, 6000);
    }).catch(() => {});
    if (promo) FF.fetchJSON('data/home.json').then(h => {       // the claim follows the real deals: rounded down to the nearest 5, never above 80
      const max = Math.max(0, ...(h.deals || []).map(d => d.o > d.p ? Math.floor((d.o - d.p) / d.o * 100) : 0));
      const claim = Math.min(80, Math.floor(max / 5) * 5);          // what the real deals reach, rounded down to 5 and never above 80 (owner, 23 Oct)
      promo.textContent = claim >= 10 ? `Biggest price drops, up to ${claim}% off ›` : "Latest deals ›";
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
      if (!box) { box = document.createElement('div'); box.id = 'cpAcctBox'; box.className = 'cp-acct-box'; acts.appendChild(box); }
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
  let loginReturn = false;                                      // true only on the page load that follows the Google sign-in redirect
  function acctSet(user, ev) {
    const was = FF.account.user;
    FF.account.user = user || null;
    acctDraw();
    // GA "login" = a real sign-in only: the page we land on after the Google redirect, once per browser session. A plain page load of an
    // already signed-in visitor used to count too (88 events from 2 people, 19-25 Oct).
    if (user && loginReturn && ev === 'SIGNED_IN') {
      let sent = false; try { sent = sessionStorage.getItem('cp-login-sent') === user.id; } catch (_) {}
      loginReturn = false;
      if (!sent) { FF.track('login', { method: 'Google' }); try { sessionStorage.setItem('cp-login-sent', user.id); } catch (_) {} }
    }
    if (user && (!was || was.id !== user.id)) wlSync().catch(e => console.warn(e));
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
    loginReturn = back || /[#&]access_token=/.test(location.hash);
    if (back || has) sb().then(c => c.auth.onAuthStateChange((ev, session) => setTimeout(() => acctSet(session && session.user, ev), 0))).catch(e => console.warn(e));
  }

  // The address search engines should file a page under: always https://www.couchpotato.ae (the old onrender.com address serves the
  // same pages), with only the parameters that change what the page shows: category / room / search, product, mood board.
  // The listing page calls it again whenever it changes its own address. agents/ff_agents/sitemap.py writes the same form.
  const SITE = 'https://www.couchpotato.ae';
  FF.canonical = () => {
    const src = new URLSearchParams(location.search), page = location.pathname.split('/').pop() || 'index.html', p = new URLSearchParams();
    ({ 'browse.html': ['q', 'c', 'room', 'deals'], 'product.html': ['id'], 'board.html': ['b'] }[page] || []).forEach(k => { if (src.get(k)) p.set(k, src.get(k)); });
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
  const GA_ID = 'G-T20F7EM8VL';
  const CKEY = 'cp-cookies';                                    // 'yes' | 'no', kept in this browser
  let gaOn = false;
  function gtag() { window.dataLayer.push(arguments); }
  FF.track = (name, params) => { if (gaOn) gtag('event', name, params || {}); };
  // GA4 tracking upgrade (owner approved 27 Oct). A product page's title is only set once the name has loaded, so the automatic page_view
  // (sent right after the config call) could record "Product | couchpotato.ae". On product.html alone the config sends no page_view; one is sent
  // by hand after product.js has set the title (FF.pageReady), or after 6 s if the product never loads. Exactly one per load (pvSent).
  // On browse.html?q= the search term is kept out of page_location so Google's own site-search event does not count the same search a
  // second time; FF.trackSearch (below) sends view_search_results with the number of results instead.
  const gaIsProduct = /(^|\/)product\.html$/.test(location.pathname);
  const gaIsSearch = /(^|\/)browse\.html$/.test(location.pathname);
  function gaHere() {
    const h = new URL(location.href); h.pathname = h.pathname.replace(/\/index\.html$/, '/');
    ['code', 'state', 'error', 'error_code', 'error_description'].forEach(k => h.searchParams.delete(k));   // never the sign-in return code
    if (gaIsSearch) h.searchParams.delete('q');
    return h;
  }
  let pvReady = false, pvSent = false;
  function gaPV() {
    if (!gaIsProduct || pvSent || !pvReady || !gaOn) return;
    pvSent = true; gtag('event', 'page_view', { page_title: document.title, page_location: gaHere().href });
  }
  FF.pageReady = () => { pvReady = true; gaPV(); };
  FF.priceBand = p => { p = Number(p); return !(p > 0) ? '' : p < 500 ? 'under_500' : p < 1000 ? '500_1000' : p < 2500 ? '1000_2500' : p < 5000 ? '2500_5000' : 'over_5000'; };
  FF.trackSearch = (term, n) => {                                // one search: view_search_results {search_term, results_count}, plus search_no_results when empty
    term = String(term || '').trim().toLowerCase(); if (!term || !FF.track) return; n = Number(n) || 0;
    FF.track('view_search_results', { search_term: term, results_count: String(n), transport_type: 'beacon' });
    if (!n) FF.track('search_no_results', { search_term: term, transport_type: 'beacon' });
  };
  function gaStart() {
    if (gaOn || !GA_ID || /^(localhost|127\.|\[::1\])/.test(location.hostname)) return;     // never count our own test pages
    gaOn = true; window['ga-disable-' + GA_ID] = false; window.dataLayer = window.dataLayer || [];
    if (!document.getElementById('cpGa')) {
      const s = document.createElement('script'); s.id = 'cpGa'; s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
      document.head.appendChild(s);
      gtag('js', new Date()); gtag('config', GA_ID, gaIsProduct ? { page_location: gaHere().href, send_page_view: false } : { page_location: gaHere().href });
      if (gaIsProduct) setTimeout(FF.pageReady, 6000);
    }
    gaPV();
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
    if (c !== 'no') gaStart();                                  // owner 16 Oct: no notice; counting is on unless the visitor opts out via "Cookie settings"
  }
  // GA4 click events (owner approved 26 Oct). One delegated listener so every page type works, the 212 static /c/ and /room/ pages included.
  // FF.track only sends after the cookie choice allows it (and never on localhost). Names and params: signin_click {location},
  // select_item {item_id, list}, moodboard_open {name}, room_open {name}; filter_apply {filter, filter_value} is sent from browse.js.
  // All values are strings, lowercase except item_id, which keeps the product id exactly as store_click sends it (6,092 ids contain capitals; lowercasing would break the join). Search needs nothing: GA's own site-search measurement already records view_search_results with search_term from ?q=.
  const evPath = location.pathname, evPage = evPath.split('/').pop() || 'index.html';
  const evList = el => {
    if (el.closest('#simGrid, .similar-cards')) return 'similar';
    if (evPage === 'wishlist.html') return 'wishlist';
    if (evPath === '/' || evPage === 'index.html' && !/^\/(c|room)\//.test(evPath)) return el.closest('#dealGrid') ? 'home_top_deals' : 'home_other';
    if (evPage === 'board.html' || evPage === 'moodboards.html') return 'moodboard';
    if (/^\/(c|room)\//.test(evPath)) return 'category';
    if (evPage === 'browse.html') { const p = new URLSearchParams(location.search); return p.get('q') ? 'search' : (p.get('c') || p.get('room')) ? 'category' : 'browse'; }
    return 'browse';
  };
  const FROM = 'cp-from';                                        // the last card opened (list + position), read by the product page; 30 minutes, no personal data
  const stashFrom = (id, list, pos) => { try { localStorage.setItem(FROM, JSON.stringify({ id: String(id), list, pos, t: Date.now() })); } catch (_) {} };
  FF.cameFrom = id => { try { const o = JSON.parse(localStorage.getItem(FROM)); return o && o.id === String(id) && Date.now() - o.t < 1800000 ? o : null; } catch (_) { return null; } };
  FF.listName = () => evList(document.body);
  const stashCard = e => {
    const c = e.target.closest('.pc-card[data-product-id]'); if (!c || e.target.closest('[data-wish]')) return;
    stashFrom(c.dataset.productId, evList(c), [...c.parentElement.children].filter(x => x.classList.contains('pc-card')).indexOf(c) + 1);
  };
  document.addEventListener('click', stashCard); document.addEventListener('auxclick', stashCard);
  document.addEventListener('click', e => {
    const t = e.target;
    const si = t.closest('[data-signin]');
    if (si) FF.track('signin_click', { location: si.closest('.nn-header') ? 'header' : (evPage === 'wishlist.html' ? 'wishlist' : 'other') });
    const nm = t.closest('a.pc-name'), card = nm && nm.closest('.pc-card[data-product-id]');
    if (card) { FF.track('select_item', { item_id: String(card.dataset.productId), list: evList(card) }); return; }
    const mb = t.closest('.mb-links a[href*="product.html?id="]');                 // a mood board's "Details" link
    if (mb) { try { const mid = new URL(mb.href).searchParams.get('id'); FF.track('select_item', { item_id: mid, list: 'moodboard' }); stashFrom(mid, 'moodboard', 0); } catch (_) {} return; }
    const bd = t.closest('a[href*="board.html?b="]');
    if (bd) { try { FF.track('moodboard_open', { name: new URL(bd.href).searchParams.get('b').toLowerCase() }); } catch (_) {} return; }
    const rm = t.closest('a.cp-room');
    if (rm) FF.track('room_open', { name: FF.slug((rm.querySelector('.cp-rl b') || rm).textContent.trim()) });
  });
  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-store]'); if (!a || !gaOn) return;
    let host = ''; try { host = new URL(a.href).hostname; } catch (_) {}
    const pid = a.dataset.pid || '', p = { store: a.dataset.store, item_id: pid, link_domain: host };
    const it = FF.gaItem && FF.gaItem.id === pid ? FF.gaItem : null;                       // set by product.js for the product on screen
    const band = it ? it.band : FF.priceBand(a.dataset.price);
    if (it && it.category) p.category = it.category;
    if (band) p.price_band = band;
    if (evPage === 'product.html') { const f = FF.cameFrom(pid); if (f) { p.list = f.list; if (f.pos) p.position = String(f.pos); } }
    else if (evPage === 'board.html' || evPage === 'moodboards.html') p.list = 'moodboard';
    FF.track('store_click', p);
  });

  document.addEventListener('DOMContentLoaded', () => {
    const nav = FF.$('categoryNav');
    if (nav) Promise.all([FF.loadMeta(), FF.loadRooms()]).then(() => {
      FF.renderNav(nav);
      // on a phone the header's own links are hidden, so the menu panel carries them
      nav.insertAdjacentHTML('afterbegin', '<div class="cp-menu-links"><a href="/#rooms">Rooms</a><a href="moodboards.html">Moods</a><a href="browse.html?deals=1">Top deals</a><a href="wishlist.html">Wishlist</a></div>');
    });
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

/* ==========================================================================================================================================
   Category-mapped search (owner, 26 Oct 2026). As the visitor types, a dropdown suggests CATEGORY pages (taxonomy v2: L1/L2/L3, plus
   "Shop by room" pages); Enter without picking goes to the best-mapped category page; only terms that do not map (brand names, "grey 3 seater")
   fall back to the old free-text product search. Uses only the category tree that already loads (FF.meta.tree); no product data, no AI.
   GA: a mapped jump loses ?q=, so it sends view_search_results {search_term} itself; picking a suggestion also sends
   search_suggestion_click {search_term, category} (category = the page's slug path). Rollback: restore js/common.js and couchpotato.css.
   ========================================================================================================================================== */
(function () {
  'use strict';
  const FF = window.FF; if (!FF) return;
  const STOP = new Set(['a', 'an', 'the', 'for', 'of', 'in', 'and', 'with', 'to', 'my', 'i', 'want', 'need', 'buy', 'some', 'cheap', 'best']);
  const IRREG = { shelves: 'shelf', knives: 'knife', tvs: 'tv', glasses: 'glass', couches: 'couch', mattresses: 'mattress', wardrobes: 'wardrobe', lenses: 'lens' };
  const sing = w => IRREG[w] || (w.length > 3 && /ies$/.test(w) ? w.slice(0, -3) + 'y' : /(ss|us|is)$/.test(w) ? w : /(ches|shes|xes|sses|zes)$/.test(w) ? w.slice(0, -2) : w.length > 3 && /s$/.test(w) ? w.slice(0, -1) : w);
  const words = q => String(q || '').toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w)).map(sing);
  // alias spec: "alias | alias = target, target" ; targets are category slug tails (deepest match wins) or "room:Name"; the FIRST target is where Enter goes.
  const SPEC = `
chair|seat|seating = armchairs-accent-chairs, dining-chairs, office-chairs, outdoor-chairs-benches
armchair|accent chair|lounge chair|wingback|arm chair|tub chair = armchairs-accent-chairs
recliner|massage chair|reclining chair|recliner sofa = recliners-massage-chairs
dining chair|kitchen chair = dining-chairs
office chair|desk chair|computer chair|ergonomic chair|executive chair|task chair = office-chairs
gaming chair|gamer chair = gaming-chairs
stool|footstool|foot stool = stools, ottomans-poufs-footstools, bar-stools
bar stool|counter stool|barstool = bar-stools
sofa|couch|settee|loveseat|love seat|lounge|three seater|3 seater|2 seater|two seater|sofaa = sofas, corner-l-shape-sofas, modular-sofas, sofa-sets, sofa-beds
corner sofa|l shape sofa|l shaped sofa|l shape|sectional|corner couch|u shape sofa = corner-l-shape-sofas
modular sofa|modular|sectional modular = modular-sofas
sofa set|couch set|living room set|sofa set 3 2 1 = sofa-sets
sofa bed|sofabed|futon|sleeper sofa|couch bed|convertible sofa = sofa-beds
chaise|chaise lounge|chaise longue|daybed|day bed = chaise-longues-daybeds
ottoman|pouf|pouffe|footrest|foot rest|puff = ottomans-poufs-footstools
bean bag|beanbag = bean-bags
bench|entryway bench|bed bench = benches, outdoor-chairs-benches
table|tabel = dining-tables, coffee-tables, side-end-tables, console-tables, desks, outdoor-tables
coffee table|center table|centre table|tea table|cocktail table|middle table = coffee-tables
side table|end table|accent table|sofa side table|lamp table|corner table = side-end-tables
console table|console|entryway table|hall table|hallway table|sofa table = console-tables
nesting table|nest of tables|nested table = nesting-tables
other table|small table = other-tables
tv unit|tv stand|tv cabinet|tv table|tv console|media unit|media console|entertainment unit|television stand|tv|tv bench = tv-media-units
cabinet|cupboard|display cabinet|display unit|showcase|curio|cabnet|crockery unit = cabinets-display-units
bookcase|bookshelf|book shelf|bookshelves|shelf|shelving|shelving unit|wall shelf|rack shelf|etagere = bookcases-shelves
shoe rack|shoe cabinet|shoe storage|shoe organizer|shoe organiser|shoe stand|shoe shelf = shoe-racks-storage
divider|room divider|screen|partition|folding screen = room-dividers-screens
coat stand|coat rack|hall tree|hat stand|coat hanger stand|umbrella stand = coat-stands-hall-trees
bed|king bed|queen bed|single bed|double bed|beds|bedd|bunk bed|twin bed = beds, bed-frames-headboards, kids-beds
bed frame|bedframe|headboard|head board|bedstead|divan|platform bed|storage bed = bed-frames-headboards
bedroom set|bedroom furniture set|bedroom suite|bed set furniture = bedroom-sets
wardrobe|wardrope|almirah|almira|armoire|closet|walk in closet|sliding wardrobe = wardrobes, kids-storage-wardrobes, clothes-wardrobe-organisers
bedside table|nightstand|night stand|bedside|bedside cabinet|night table|bedside drawer = bedside-tables
dresser|dressing table|vanity table|makeup table|make up table|vanity = dressers-dressing-tables, vanity-units
chest of drawer|drawer|tallboy|chest|drawers|chest drawer = chests-of-drawers, trunks-chests
mattress|mattres|matress|memory foam|orthopedic mattress|spring mattress = mattresses/mattresses
mattress topper|mattress protector|topper|mattress pad = mattress-toppers-protectors
bar table|bistro table|pub table|high table|bar counter|breakfast bar = bar-bistro-tables
dining table|dinner table|kitchen table|dinning table|dining tabel = dining-tables
dining set|dining table set|dining room set|6 seater dining|4 seater dining|dinette = dining-sets
sideboard|buffet|credenza|server|dining cabinet = sideboards-buffets
bar unit|bar cabinet|serving trolley|bar cart|drinks trolley|wine cabinet|wine rack = bar-units-serving-trolleys
desk|study table|computer table|writing desk|work desk|office desk|workstation|laptop table|pc table = desks
office storage|filing cabinet|file cabinet|office cabinet|office shelf = office-storage
outdoor chair|patio chair|garden chair|balcony chair|outdoor bench|garden bench = outdoor-chairs-benches
lounger|sunbed|sun lounger|sun bed|swing|hammock|gazebo|pergola|parasol|umbrella|canopy|shade|cabana = loungers-swings-shade
outdoor sofa|rattan sofa|patio sofa|garden sofa|outdoor lounge|outdoor sofa set|outdoor couch|rattan set = outdoor-sofas-lounge-sets
outdoor table|patio table|garden table|outdoor coffee table = outdoor-tables
outdoor dining|balcony set|patio set|garden set|bistro set|outdoor dining set|balcony furniture|garden furniture|patio furniture|outdoor furniture = outdoor-dining-balcony-sets, outdoor-sofas-lounge-sets, outdoor-chairs-benches, outdoor-tables
kids bed|children bed|toddler bed|child bed|loft bed|kids bunk bed|kid bed|boys bed|girls bed = kids-beds
kids desk|kids table|kids study table|kids chair|play table|children desk|kid desk = kids-desks-chairs-tables
kids wardrobe|kids storage|toy storage|toy box|toy chest|kids cabinet|children wardrobe = kids-storage-wardrobes
cot|crib|nursery|baby bed|baby cot|changing table|bassinet|moses basket|baby furniture|nursery furniture = cots-nursery-furniture
kids|kid|child|children|baby|toddler|boys|girls|kids room|childrens room|kids furniture = room:Kids Room, kids-beds, kids-desks-chairs-tables, kids-storage-wardrobes
vase|flower vase|vases|decor vase = vases
sculpture|figurine|statue|ornament|decor piece|showpiece|show piece = figurines-sculptures
decorative tray|tray|decor tray|ottoman tray|bowl|decorative bowl = decorative-trays-bowls
decorative box|decor box|trinket box|jewelry box|jewellery box = decorative-boxes
bookend|book end|decor book|coffee table book = decorative-books-bookends
candle holder|lantern|candlestick|candle stand|tealight holder|votive = candle-holders-lanterns
painting|canvas|wall art|artwork|art|picture|canvas art|oil painting|wall painting = paintings-canvas-art
wall hanging|macrame|wall sculpture|wall decor|wall decoration|wall ornament = wall-hangings-sculptures
wallpaper|wall panel|wall paper|3d panel|pvc panel = wall-panels-wallpaper
poster|print|map|framed print|art print|wall print = prints-posters-maps
mirror|wall mirror|round mirror|decorative mirror|mirors = wall-mirrors, floor-mirrors, table-mirrors, led-bathroom-mirrors
floor mirror|full length mirror|standing mirror|leaning mirror|dressing mirror = floor-mirrors
table mirror|vanity mirror|makeup mirror|desk mirror|tabletop mirror = table-mirrors
led mirror|bathroom mirror|smart mirror|backlit mirror|illuminated mirror = led-bathroom-mirrors
clock|wall clock|large clock|decorative clock = wall-clocks, table-clocks
table clock|desk clock|mantel clock|alarm clock = table-clocks
photo frame|picture frame|frame|photo album|collage frame = photo-frames
artificial plant|fake plant|artificial tree|faux plant|plant|tree|indoor tree|faux tree|palm|artifical plant|fake tree = artificial-plants-trees, live-plants, planters-pots
artificial flower|fake flower|flower|flowers|faux flower|bouquet|artifical flower = artificial-flowers, dried-flowers
live plant|real plant|indoor plant|houseplant|succulent|cactus|real flower = live-plants
dried flower|pampas|pampas grass|dried grass|preserved flower = dried-flowers
planter|plant pot|flower pot|plant stand|plant holder|pot cover|plantr = planters-pots
candle|scented candle|pillar candle|tealight|candels = candles
room spray|air freshener|fragrance|perfume|room fragrance|reed diffuser spray = room-sprays-fragrance
diffuser|oud burner|burner|aroma diffuser|incense burner|mabkhara|bakhoor burner|aroma = diffusers-burners
incense|bakhoor|bukhoor|oud|agarbatti|dhoop = incense-bakhoor
christmas|xmas|christmas tree|seasonal|festive|halloween|easter|new year = christmas-seasonal
ramadan|eid|ramadhan|iftar|ramadan decor|eid decor|fanous|ramadan lantern = ramadan-eid
lamp|lamps|lighting lamp = lighting/lamps, table-lamps, floor-lamps
table lamp|desk lamp|bedside lamp|study lamp|reading lamp|night lamp|accent lamp = table-lamps
floor lamp|standing lamp|arc lamp|tripod lamp|torchiere|floor light|standing light = floor-lamps
light|lighting|lights|lite|light fixture = lighting
ceiling light|ceiling lamp|flush mount|ceiling fixture|ceiling fan light|led ceiling light = ceiling-lights/ceiling-lights, pendant-lights, chandeliers
pendant|pendant light|hanging light|hanging lamp|pendant lamp|drop light = pendant-lights
chandelier|chandlier|crystal chandelier|candelabra|chandeliers = chandeliers
spotlight|downlight|spot light|recessed light|track light|down light = spotlights-downlights
wall light|wall lamp|sconce|wall sconce|wall mounted light|bracket light = wall-lights/wall-lights
bulb|light bulb|led bulb|lightbulb|lamp bulb|bulbs = bulbs-light-accessories
led strip|string light|fairy light|strip light|rope light|neon light|led light strip|string lights = led-strips-string-lights
outdoor light|garden light|solar light|outdoor lamp|landscape light|patio light|flood light = outdoor-lights
rug|carpet|rugs|carpets|ruge|area carpet|floor rug|floor carpet = rugs-carpets/rugs, area-rugs, kids-rugs, outdoor-rugs, runners
area rug|living room rug|large rug|shag rug|wool rug|persian rug|rug 5x8 = area-rugs
kids rug|children rug|nursery rug|play mat rug|kids carpet = kids-rugs
outdoor rug|patio rug|garden rug|balcony rug|waterproof rug|outdoor carpet = outdoor-rugs
runner|hallway rug|hallway runner|rug runner|corridor rug|stair runner|kitchen runner = runners
door mat|doormat|welcome mat|entrance mat|floor mat|entry mat = door-mats
prayer mat|prayer rug|sajada|musalla|janamaz|prayer carpet = prayer-mats
cushion|throw pillow|scatter cushion|sofa cushion|pillow cushion|cushons|decorative pillow|accent pillow = filled-cushions
cushion cover|pillow cover|pillow slip|throw pillow cover|cushion case = cushion-covers
seat pad|chair pad|furniture cover|sofa cover|chair cover|slipcover|seat cushion|chair cushion = seat-pads-furniture-covers
throw|blanket|throws|blankets|sofa throw|fleece|cozy blanket|plaid = throws-blankets
curtain|drape|curtians|drapes|window curtain|blackout curtain|sheer curtain|sheer|curtin = curtains
blind|shade|roller blind|window blind|venetian blind|roman blind|window shade|zebra blind|blinds = blinds-shades
curtain rod|curtain pole|curtain rail|curtain ring|curtain hook|curtain accessory|curtain tieback|rod = curtain-rods-accessories
sheet|bed sheet|bedsheet|pillowcase|pillow case|fitted sheet|flat sheet|bed linen|linen|sheets = sheets-pillowcases, duvet-covers, bedding-sets
duvet cover|quilt cover|comforter cover|doona cover|duvet set = duvet-covers
bedding set|bed set|comforter set|bedding|bed in a bag|bedding sets|bed linen set = bedding-sets
bedspread|quilt|bed cover|coverlet|bed throw|bedcover|bed spread|quilted bedspread = bedspreads-quilts
duvet|comforter|doona|down duvet|winter duvet|feather duvet|quilted comforter = duvets-comforters
pillow|sleeping pillow|bed pillow|memory foam pillow|neck pillow|pilow|pillows = pillows
towel|bath towel|hand towel|face towel|beach towel|towels|towl|towell = towels
bath mat|bathmat|bathroom mat|bath rug|shower mat|bathroom rug|toilet mat = bath-mats
bathrobe|robe|dressing gown|bath robe|bathroom robe|spa robe = bathrobes
soap dispenser|bath set|toothbrush holder|bathroom set|soap dish|bathroom accessories|tumbler holder|bathroom accessory = soap-dispensers-bath-sets
shower curtain|shower accessory|shower caddy|bath curtain|shower rail = shower-curtains-accessories
towel holder|towel rack|towel rail|towel ring|towel bar|towel hook|toilet roll holder = towel-holders-racks
vanity unit|bathroom vanity|sink cabinet|basin cabinet|wash basin cabinet|vanity cabinet = vanity-units
bathroom cabinet|bathroom storage|bathroom shelf|bathroom unit|medicine cabinet|bathroom organiser|bathroom rack = bathroom-cabinets-storage
laundry basket|hamper|laundry bag|laundry bin|clothes hamper|dirty clothes basket|laundry = laundry-baskets-hampers, ironing-drying
ironing board|iron board|drying rack|clothes airer|clothes dryer|clothes horse|ironing|washing line|clothes drying = ironing-drying
glass|glassware|tumbler|wine glass|water glass|drinking glass|juice glass|glasses|whisky glass|champagne glass = glassware
tea|coffee|tea set|coffee set|teapot|coffee cup|tea cup|dallah|arabic coffee|kettle|turkish coffee|tea pot|cafetiere = tea-coffee
mug|cup|mugs|coffee mug|tea mug|travel mug|espresso cup = mugs-cups
flask|bottle|water bottle|thermos|vacuum flask|insulated bottle|sports bottle|hot flask = flasks-bottles
plate|bowl|dish|dinnerware|tableware|plates|dinner plate|soup bowl|salad bowl|side plate|crockery = plates-bowls, dinner-sets
dinner set|dinnerware set|dish set|dinner service|crockery set|tableware set|porcelain set|plate set = dinner-sets
serving dish|platter|serving tray|serving bowl|serving platter|cake stand|serving board|snack tray|serveware = serving-dishes-platters
placemat|coaster|table mat|place mat|table coaster|table placemat|dining mat|heat mat = placemats-coasters
napkin|napkin ring|serviette|napkin holder|table napkin|cloth napkin|paper napkin = napkins-napkin-rings
tablecloth|table cloth|table runner|table linen|table cover|dining cloth|oilcloth|table skirt = tablecloths-runners
cutlery|flatware|spoon|fork|knife set|silverware|cutlery set|spoon set|serving spoon|knife fork = cutlery-sets-flatware
kitchen mat|utility mat|anti fatigue mat|kitchen rug|floor mat kitchen|sink mat = kitchen-utility-mats
utensil|gadget|spatula|ladle|kitchen tool|peeler|whisk|tongs|kitchen utensil|can opener|grater|kitchen gadget = utensils-gadgets
knife|chopping board|cutting board|chopper|kitchen knife|chef knife|knife block|knife set kitchen|butcher block = knives-cutting-boards
food storage|container|lunch box|tupperware|jar|food container|storage container|airtight|lunchbox|spice jar|canister = food-storage-containers
dish rack|drainer|kitchen rack|dish drainer|plate rack|kitchen holder|sink organiser|spice rack|kitchen organiser|dish drying = racks-drainers-holders
pot|pan|frying pan|saucepan|cooking pot|wok|cookware|pots|pans|casserole|stock pot|non stick|frypan|pressure cooker = pots-pans, cookware-sets
bakeware|baking tray|cake tin|baking|baking pan|muffin tray|cake mould|baking sheet|bake|cake pan|baking dish = bakeware
cookware set|pot set|pan set|pots and pans set|cooking set|non stick set|cookware sets = cookware-sets
kitchen towel|oven glove|apron|tea towel|pot holder|oven mitt|dish cloth|kitchen cloth|kitchen linen|dishcloth = kitchen-textiles
storage box|basket|storage basket|organizer|organiser|bin box|storage bin|woven basket|wicker basket|box|storage|baskets|boxes|home organizer = boxes-baskets
trunk|storage chest|blanket box|toy chest storage|storage trunk|chest box|ottoman storage|storage ottoman|wooden trunk|treasure chest = trunks-chests
hanger|coat hanger|clothes hanger|hangers|wooden hanger|velvet hanger|suit hanger|trouser hanger = hangers
wardrobe organiser|closet organizer|closet organiser|clothes organiser|wardrobe storage|drawer organiser|shelf organiser|hanging organiser|clothes storage = clothes-wardrobe-organisers
bin|trash can|dustbin|waste bin|garbage|rubbish bin|trash bin|dust bin|pedal bin|bins|kitchen bin|sensor bin|garbage can = waste-bins/waste-bins
hook|wall hook|rack|wall rack|hooks|coat hook|key holder|hat rack|wall hanger|towel hooks = wall-hooks-racks
trolley|cart|utility cart|kitchen trolley|serving cart|rolling cart|storage cart|hand trolley|tea trolley|cart trolley = trolleys-carts
garden|garden ornament|fountain|garden statue|water feature|garden decor|garden decoration|outdoor ornament|gnome|garden sculpture = garden-ornaments-fountains
artificial grass|turf|lawn|fake grass|synthetic grass|grass mat|artificial turf|grass carpet|green carpet|artificial lawn = artificial-grass
fence|fencing|hedge|privacy screen|garden fence|artificial hedge|bamboo fence|balcony screen|privacy fence|boxwood = artificial-fencing-hedges
bbq|barbecue|grill|fire pit|outdoor kitchen|charcoal grill|gas grill|fire bowl|smoker|bar b q|firepit = bbq-fire-pits-outdoor-cooking
living room|lounge room|livingroom|sitting room|majlis|lounge area|drawing room|hall = room:Living Room
bedroom|bed room|master bedroom|guest room|sleeping room|bedrom = room:Bedroom
dining room|diningroom|dining area|dinning room|dining hall|eating area = room:Dining Room
home office|study|office|study room|work from home|office room|workspace|home study = room:Home Office
entryway|hallway|entrance|foyer|entry|hall way|corridor|lobby|porch|mudroom = room:Entryway
bathroom|bath room|washroom|restroom|toilet|powder room|shower room|wc|bathrom = room:Bathroom
kitchen|kitchenware|kitchen area|kitchenette|kitchan|cooking|pantry|kitchen room|galley = room:Kitchen
outdoor|patio|balcony|terrace|outside|veranda|rooftop|backyard|courtyard|yard|alfresco = room:Outdoor
`;
  let ready = null, nodes = [], aliasList = [];            // aliasList: [{k: 'sofa bed', w: ['sofa','bed'], t: [node...]}]
  const roomSlug = r => r.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  function build() {
    if (ready) return ready;
    return ready = FF.loadMeta().then(m => {
      const tree = (m && m.tree) || [];
      const add = (n, level, parents) => {
        const node = { type: 'cat', n: n.n, s: n.s, c: n.c || 0, level, path: parents.map(p => p.n), w: words(n.n), url: '/c/' + n.s + '/' };
        nodes.push(node);
        (n.ch || []).forEach(ch => add(ch, level + 1, parents.concat([n])));
      };
      tree.forEach(l1 => add(l1, 0, []));
      (m.rooms || []).forEach(r => nodes.push({ type: 'room', n: r, s: 'room:' + r, c: ((FF.rooms && FF.rooms.rooms && FF.rooms.rooms[r] && FF.rooms.rooms[r].n) || 0), level: 1, path: ['Shop by room'], w: words(r), url: '/room/' + roomSlug(r) + '/' }));
      const find = tail => {
        if (tail.indexOf('room:') === 0) return nodes.find(x => x.type === 'room' && x.s === tail);
        const hit = nodes.filter(x => x.type === 'cat' && (x.s === tail || x.s.endsWith('/' + tail)));
        return hit.sort((a, b) => b.level - a.level)[0] || null;      // the deepest page wins when a name repeats (L2 and its L3)
      };
      SPEC.split('\n').forEach(line => {
        const i = line.indexOf('='); if (i < 0) return;
        const targets = line.slice(i + 1).split(',').map(s => find(s.trim())).filter(Boolean); if (!targets.length) return;
        line.slice(0, i).split('|').forEach(a => { const w = words(a); if (w.length) aliasList.push({ k: w.join(' '), w, t: targets }); });
      });
      return true;
    }).catch(() => (ready = null));
  }
  const lev = (a, b, max) => {                                // small edit distance, early exit
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i]; let best = i;
      for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); if (cur[j] < best) best = cur[j]; }
      if (best > max) return max + 1; prev = cur;
    }
    return prev[b.length];
  };
  // -> { items: [{node, score, full}], full: bool }  "full" = the typed words are all accounted for by the top match (safe to jump on Enter)
  function match(q) {
    const qw = words(q); if (!qw.length) return { items: [], full: false };
    const key = qw.join(' '), out = new Map();
    const put = (node, score, full, order) => { const o = out.get(node); if (!o || score > o.score) out.set(node, { node, score, full, order: order || 0 }); };
    let exact = false;
    aliasList.forEach(a => {
      if (a.k === key) { exact = true; a.t.forEach((t, i) => put(t, 1000 - i, true, i)); }
      else if (a.k.indexOf(key) === 0 && key.length >= 2) a.t.forEach((t, i) => put(t, 700 - i, false, i));                  // typing: "sof" -> sofa
      else if (qw.length > 1 && (' ' + key + ' ').indexOf(' ' + a.k + ' ') >= 0) a.t.forEach((t, i) => put(t, 400 - i, false, i));       // "grey sofa": part of the phrase maps, not all of it
    });
    nodes.forEach(n => {                                       // the category names themselves: every typed word is the start of a name word
      const nw = n.w.concat(n.path.length ? words(n.path[n.path.length - 1]) : []);
      if (qw.every(w => nw.some(x => x.indexOf(w) === 0))) {
        const nameHit = qw.every(w => n.w.some(x => x.indexOf(w) === 0));
        const same = n.w.join(' ') === key;
        put(n, (same ? 950 : nameHit ? 600 : 300) + (3 - Math.min(3, n.level)) * 5, same, 99);
      }
    });
    if (!exact && !out.size) {                                  // misspellings: 1 edit for short words, 2 for long
      const max = key.length >= 7 ? 2 : 1;
      aliasList.forEach(a => { if (lev(a.k, key, max) <= max) a.t.forEach((t, i) => put(t, 500 - i, true, i)); });
    }
    const items = [...out.values()].sort((a, b) => b.score - a.score || a.order - b.order || b.node.c - a.node.c).slice(0, 6);
    const top = items[0];
    return { items, full: !!(top && top.full && top.score >= 500) };
  }
  // ---- UI
  const rowsFor = q => { const r = match(q); return { items: r.items, full: r.full }; };
  const fmt = n => Number(n || 0).toLocaleString('en-AE');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let box = null, cur = null, active = -1, rows = [], lastQ = '';
  function ensureBox() {
    if (box) return box;
    box = document.createElement('div'); box.className = 'cp-sug'; box.id = 'cpSug'; box.setAttribute('role', 'listbox'); box.hidden = true;
    box.addEventListener('mousedown', e => e.preventDefault());                            // keep the focus in the input while tapping a row
    box.addEventListener('click', e => { const r = e.target.closest('[data-i]'); if (r) choose(Number(r.dataset.i)); });
    document.body.appendChild(box); return box;
  }
  function place() {
    if (!box || box.hidden || !cur) return;
    const r = cur.input.closest('form, .rsearch, .nn-search') ? cur.input.closest('form, .rsearch, .nn-search').getBoundingClientRect() : cur.input.getBoundingClientRect();
    box.style.left = Math.max(8, r.left + window.scrollX) + 'px'; box.style.top = (r.bottom + window.scrollY + 4) + 'px'; box.style.width = Math.min(Math.max(r.width, 300), window.innerWidth - 16) + 'px';
  }
  function close() { if (box) box.hidden = true; active = -1; if (cur) cur.input.setAttribute('aria-expanded', 'false'); }
  function render(q) {
    const b = ensureBox(); lastQ = q;
    const m = rowsFor(q); rows = m.items.map(i => ({ kind: 'cat', node: i.node })); 
    if (q.trim()) rows.push({ kind: 'free', q: q.trim() });
    if (!q.trim() || !rows.length || (rows.length === 1 && rows[0].kind === 'free' && !m.items.length && q.trim().length < 2)) { close(); return; }
    b.innerHTML = rows.map((r, i) => r.kind === 'cat'
      ? `<div class="cp-sug-r" role="option" data-i="${i}" id="cpSug${i}"><span class="cp-sug-t"><b>${esc(r.node.n)}</b><small>${esc(r.node.path.join(' › ') || 'All categories')}</small></span><span class="cp-sug-c">${r.node.c ? fmt(r.node.c) : ''}</span></div>`
      : `<div class="cp-sug-r cp-sug-free" role="option" data-i="${i}" id="cpSug${i}"><span class="cp-sug-t"><b>Search all products for “${esc(r.q)}”</b><small>Not what you meant? Look through every product name</small></span></div>`).join('');
    b.hidden = false; active = -1; cur.input.setAttribute('aria-expanded', 'true'); place();
  }
  function hl(i) {
    active = i; [...box.children].forEach((c, k) => { c.classList.toggle('on', k === i); c.setAttribute('aria-selected', String(k === i)); });
    if (cur) { if (i >= 0) cur.input.setAttribute('aria-activedescendant', 'cpSug' + i); else cur.input.removeAttribute('aria-activedescendant'); }
  }
  const lc = s => String(s || '').trim().toLowerCase();
  function go(url) { window.location.assign(url); }
  function choose(i) {
    const r = rows[i]; if (!r || !cur) return;
    const typed = cur.input.value;
    if (r.kind === 'free') { close(); freeSearch(typed); return; }
    FF.trackSearch(typed, r.node.c);
    FF.track && FF.track('search_suggestion_click', { search_term: lc(typed), category: lc(r.node.s), transport_type: 'beacon' });
    close(); go(r.node.url);
  }
  function freeSearch(q) {                                    // the old behaviour: browse.html?q=… (GA counts it from the address)
    const f = cur.input.closest('form');
    if (/browse\.html$/.test(location.pathname) && window.FF_FREE_SEARCH) return window.FF_FREE_SEARCH(q);
    go('browse.html?q=' + encodeURIComponent(q.trim()));
  }
  function onSubmit(e, input) {
    input.value = input.value.trim(); const q = input.value; if (!q) return;                    // "Chair " is searched (and counted) as "chair"
    cur = cur && cur.input === input ? cur : { input };
    if (active >= 0 && rows[active]) { e.preventDefault(); e.stopImmediatePropagation(); choose(active); return; }
    if (!ready || !aliasList.length) return;                  // data not ready: let the normal free-text search run
    const m = match(q);
    if (m.full && m.items[0]) {                               // every typed word maps: jump to the best category page
      e.preventDefault(); e.stopImmediatePropagation();
      const node = m.items[0].node;
      FF.trackSearch(q, node.c);
      close(); go(node.url);
    }                                                          // else: nothing maps cleanly -> the normal free-text search continues
  }
  function attach(input) {
    if (!input || input.dataset.cpSug) return; input.dataset.cpSug = '1';
    input.setAttribute('autocomplete', 'off'); input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false'); input.setAttribute('aria-controls', 'cpSug');
    const f = input.closest('form');
    if (f) f.addEventListener('submit', e => onSubmit(e, input), true);
    input.addEventListener('focus', () => { cur = { input }; build(); });
    input.addEventListener('input', () => { cur = { input }; build().then(() => { if (cur && cur.input === input) render(input.value); }); });
    input.addEventListener('keydown', e => {
      if (!box || box.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); hl((active + 1) % rows.length); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); hl(active <= 0 ? rows.length - 1 : active - 1); }
      else if (e.key === 'Escape') { close(); }
    });
    input.addEventListener('blur', () => setTimeout(close, 120));
  }
  document.addEventListener('click', e => { if (box && !box.hidden && !e.target.closest('#cpSug') && !e.target.closest('.nn-search, .rsearch')) close(); });
  window.addEventListener('resize', place); window.addEventListener('scroll', place, { passive: true });
  document.addEventListener('DOMContentLoaded', () => { document.querySelectorAll('.nn-search input[name="q"], .rsearch input[name="q"]').forEach(attach); });
  FF.searchMap = { match: q => build().then(() => match(q)), build, stats: () => ({ aliases: aliasList.length, nodes: nodes.length, mapped: new Set(aliasList.flatMap(a => a.t.map(t => t.s))).size, mappedPaths: [...new Set(aliasList.flatMap(a => a.t.map(t => t.s)))] }) };                    // for tests
})();
