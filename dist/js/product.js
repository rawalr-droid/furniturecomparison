(function () {
  'use strict';
  const { esc, enc, money, $ } = FF;
  const root = $('productDialogContent');
  const id = new URLSearchParams(location.search).get('id');

  function notFound() {
    root.innerHTML = '<section class="detail-copy"><h1>Product not found</h1><p>This product may no longer be in the catalogue.</p><a href="browse.html">Browse furniture</a></section>';
  }
  const fact = (label, value) => value ? `<div class="fact"><span>${label}</span>${esc(value)}</div>` : '';

  function similarity(base, p) {
    let s = 0;
    if (p.c === base.c) s += 8;
    if (p.s !== base.s) s += 10;
    s += (Math.min(base.price, p.price) / Math.max(base.price, p.price)) * 3;
    const words = new Set(base.nameL.split(/\W+/));
    p.nameL.split(/\W+/).forEach(w => { if (w.length > 3 && words.has(w)) s += 1; });
    return s;
  }

  async function show() {
    if (!id) return notFound();
    const meta = await FF.loadMeta();
    const d = await FF.loadDetail(id);
    if (!d) return notFound();

    const cat = FF.catL[d.c], store = FF.stores[d.s], room = d.r >= 0 ? meta.rooms[d.r] : '';
    const l1 = meta.tree.find(n => n.n === cat.l1), l2 = l1.ch.find(n => n.n === cat.l2), l3 = l2.ch.find(n => n.n === cat.l3);
    const images = [...new Set([d.i, ...(d.g || [])].filter(Boolean).map(FF.fixImg))];
    const variants = d.v || [];
    let current = variants.length ? Math.max(0, variants.findIndex(v => v.p === d.p)) : -1;
    let imgIndex = 0;

    const view = () => {
      const v = current >= 0 ? variants[current] : null;
      const price = v && v.p ? v.p : d.p;
      const orig = v && v.p ? (v.o || 0) : d.o;
      return { v, price, orig };
    };

    function paint() {
      const { v, price, orig } = view();
      const main = v && v.i && imgIndex === -1 ? v.i : images[imgIndex] || '';
      const thumbs = images.map((src, i) => `<button class="variant-thumb image-thumb ${i === imgIndex ? 'active' : ''}" data-image-index="${i}" type="button" aria-label="View image ${i + 1} of ${images.length}"><img src="${esc(src)}" alt="" loading="lazy" onerror="FF.imgErr(this)"><span>${i + 1}</span></button>`).join('');
      const chips = variants.map((x, i) => `<button class="variant-chip ${i === current ? 'active' : ''}" data-variant-index="${i}" type="button">${esc(x.t)}${x.p ? `<small>${money(x.p)}</small>` : ''}</button>`).join('');
      root.innerHTML = `<div class="product-detail">
        <div class="detail-gallery">
          ${main ? `<img id="detailMainImage" class="detail-image" src="${esc(main)}" alt="${esc(d.n)}" onerror="FF.imgErr(this)">` : '<div class="image-fallback">Image unavailable</div>'}
          ${images.length > 1 ? `<button class="gallery-arrow gallery-prev" data-image-step="-1" aria-label="Previous image">‹</button><button class="gallery-arrow gallery-next" data-image-step="1" aria-label="Next image">›</button><div class="detail-thumbnails">${thumbs}</div>` : ''}
        </div>
        <div class="detail-copy">
          <div class="store">${esc(store)}</div>
          <nav class="crumbs" aria-label="Category"><a href="browse.html?c=${enc(l1.s)}">${esc(l1.n)}</a> › <a href="browse.html?c=${enc(l2.s)}">${esc(l2.n)}</a> › <a href="browse.html?c=${enc(l3.s)}">${esc(l3.n)}</a></nav>
          <h2>${esc(d.n)}</h2>
          ${variants.length ? `<p class="selected-variant"><span>Option</span>${esc(v.t)} <small>${current + 1} of ${variants.length}</small></p><div class="chip-row">${chips}</div>` : ''}
          <p class="detail-price">${money(price)}${orig > price ? ` <span class="was-price">${money(orig)}</span>` : ''}</p>
          <div class="facts">${fact('Category', cat.l3)}${fact('Room', room)}${fact('Material', d.m)}${fact('Colour', d.k)}${fact('Dimensions', d.z)}${fact('Brand', d.b)}${fact('Style', d.y)}${d.t === 0 ? fact('Availability', 'Out of stock at last check') : ''}</div>
          <p class="description">${esc(d.d || 'See the retailer website for full product information.')}</p>
          <a class="retailer-link" href="${esc(FF.retailerURL(d.u, v && v.x))}" target="_blank" rel="noopener sponsored">View ${variants.length ? 'this option' : 'product'} at ${esc(store)}</a>
        </div>
        <div class="similar-wrap" id="similarWrap"><h3>Similar pieces across stores</h3><p>Finding alternatives…</p></div>
      </div>`;
      if (similarHTML) $('similarWrap').innerHTML = similarHTML;
    }

    let similarHTML = '';
    document.title = d.n + ' | Furnish Finder UAE';
    paint();

    // similar items come from the listing file of the same sub-category
    try {
      const rows = await FF.loadShard(l2.f);
      const base = { c: d.c, s: d.s, price: d.p, nameL: d.n.toLowerCase() };
      const sim = rows.filter(r => r.id !== id && r.c === d.c && r.img).map(r => ({ r, s: similarity(base, r) })).sort((a, b) => b.s - a.s).slice(0, 12).map(x => x.r);
      similarHTML = `<h3>Similar pieces across stores</h3><p>${sim.length} matching products. Alternatives from other retailers are prioritised.</p>
        <div class="similar-grid">${sim.map(s => `<a class="similar-item" href="product.html?id=${enc(s.id)}" target="_blank" rel="noopener">${FF.img(s.img, s.name, 'similar-img')}<div><strong>${esc(s.name)}</strong><span>${money(s.price)} · ${esc(s.store)}</span></div></a>`).join('')}</div>`;
      if (!sim.length) similarHTML = '<h3>Similar pieces across stores</h3><p>No close matches found yet.</p>';
      $('similarWrap').innerHTML = similarHTML;
    } catch (e) { console.error(e); $('similarWrap').innerHTML = ''; }

    root.addEventListener('click', e => {
      const chip = e.target.closest('[data-variant-index]');
      if (chip) {
        current = Number(chip.dataset.variantIndex);
        const v = variants[current];
        if (v && v.i) { const vi = FF.fixImg(v.i); if (!images.includes(vi)) images.push(vi); imgIndex = images.indexOf(vi); }
        paint(); return;
      }
      const step = e.target.closest('[data-image-step]');
      if (step) { imgIndex = (imgIndex + Number(step.dataset.imageStep) + images.length) % images.length; paint(); return; }
      const thumb = e.target.closest('[data-image-index]');
      if (thumb) { imgIndex = Number(thumb.dataset.imageIndex); paint(); }
    });
  }

  show().catch(err => { console.error(err); root.innerHTML = '<section class="detail-copy"><h1>Something went wrong</h1><p>The product could not be loaded. Please refresh the page.</p><a href="browse.html">Browse furniture</a></section>'; });
})();
