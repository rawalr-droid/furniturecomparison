(function () {
  'use strict';
  const { esc, enc, money, $ } = FF;

  FF.fetchJSON('data/home.json').then(home => {
    const deals = home.deals;
    const href = id => 'product.html?id=' + enc(id);

    $('categoryStrip').innerHTML = home.tiles.map(t => `<a class="category-card" href="browse.html?c=${enc(t.slug)}">
      <span class="category-image">${t.i ? `<img src="${esc(FF.fixImg(t.i))}" alt="" loading="lazy" onerror="FF.imgErr(this)">` : ''}</span>
      <strong>${esc(t.label)}</strong>
    </a>`).join('');

    const hero = home.hero || deals[0];            // hero rule: design/tools/pick_hero.py, refreshed nightly (falls back to the top deal)
    if (hero) {
      $('heroProduct').href = href(hero.id);
      $('heroProduct').innerHTML = `<img src="${esc(FF.fixImg(hero.i))}" alt="${esc(hero.name)}" onerror="FF.imgErr(this)"><span class="hero-badge">${Math.round((hero.o - hero.p) / hero.o * 100)}%<small>OFF</small></span>`;
    }

    $('dealCount').textContent = deals.length;
    $('dealGrid').innerHTML = deals.map(d => FF.pcCard({ id: d.id, name: d.name, store: d.store, img: FF.fixImg(d.i), price: d.p, orig: d.o })).join('');
    $('empty').hidden = deals.length > 0;

    const rounded = Math.floor(home.total / 1000) * 1000;
    const announce = n => { $('announce').textContent = `One search. ${rounded.toLocaleString()}+ products across ${n} UAE home and furniture stores.`; };
    announce(home.stores);
    // home.stores counts every store in meta, including retired ones left at 0 products; count only stores with products
    FF.loadMeta().then(m => { const n = m.stores.filter(s => s.c > 0).length; if (n) announce(n); }).catch(() => {});
  }).catch(err => {
    console.error(err);
    $('empty').hidden = false;
  });
})();
