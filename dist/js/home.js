(function () {
  'use strict';
  const { esc, enc, money, $ } = FF;
  const pct = d => (d.o > d.p ? Math.round((d.o - d.p) / d.o * 100) : 0);

  // Carousel arrows (desktop): scroll the deals row by about one screen of cards
  document.querySelectorAll('.nn-carousel-btn').forEach(b => b.addEventListener('click', () => {
    const grid = b.parentElement.querySelector('.pc-grid');
    if (grid) grid.scrollBy({ left: Number(b.dataset.scroll) * grid.clientWidth * 0.9, behavior: 'smooth' });
  }));

  FF.loadMeta().then(m => {
    $('l1Pills').innerHTML = m.tree.map(l1 => `<a class="nn-pill" href="browse.html?c=${enc(l1.s)}">${esc(l1.n)}</a>`).join('');
    const n = m.stores.filter(s => s.c > 0).length;
    if (n) $('heroSub').textContent = `Search, compare and buy from ${n} UAE home stores, all in one place.`;
  }).catch(() => {});

  FF.fetchJSON('data/home.json').then(home => {
    const deals = home.deals;
    const href = id => 'product.html?id=' + enc(id);

    $('categoryStrip').innerHTML = home.tiles.map(t => `<a class="category-card" href="browse.html?c=${enc(t.slug)}">
      <span class="category-image">${t.i ? `<img src="${esc(FF.fixImg(t.i))}" alt="" loading="lazy" onerror="FF.imgErr(this)">` : ''}</span>
      <strong>${esc(t.label)}</strong>
    </a>`).join('');

    const hero = home.hero || deals[0];            // hero rule: design/tools/pick_hero.py, refreshed nightly (falls back to the top deal)
    if (hero) {
      const off = pct(hero);
      $('heroProduct').href = href(hero.id);
      $('heroProduct').innerHTML = `<img src="${esc(FF.fixImg(hero.i))}" alt="${esc(hero.name)}" onerror="FF.imgErr(this)">
        ${off ? `<span class="nn-hero-badge">-${off}%</span>` : ''}
        <span class="nn-hero-card"><small>${esc(hero.store)}</small><strong>${esc(hero.name)}</strong>
          <span><b class="${off ? 'sale' : ''}">${money(hero.p)}</b>${hero.o > hero.p ? ` <s>${money(hero.o)}</s>` : ''}</span></span>`;
    }

    $('dealCount').textContent = deals.length;
    $('dealGrid').innerHTML = deals.map(d => FF.pcCard({ id: d.id, name: d.name, store: d.store, img: FF.fixImg(d.i), price: d.p, orig: d.o })).join('');
    $('empty').hidden = deals.length > 0;
  }).catch(err => {
    console.error(err);
    $('empty').hidden = false;
  });
})();
