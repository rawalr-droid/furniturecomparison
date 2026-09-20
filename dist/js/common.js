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

  FF.rowFrom = a => {
    const [id, name, s, c, price, orig, img0, room, opts] = a;
    const img = FF.fixImg(img0);
    const cat = FF.catL[c];
    return {
      id, name, s, c, price, orig, img, opts, store: FF.stores[s], room: room >= 0 ? FF.meta.rooms[room] : '',
      disc: orig > price ? (orig - price) / orig : 0, f: (orig > price ? (orig - price) / orig : 0) * 2 + (img ? 1 : 0), l1: cat.l1, l2: cat.l2, l3: cat.l3,
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
})();
