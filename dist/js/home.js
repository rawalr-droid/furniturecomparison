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

    const hero = deals[0];
    if (hero) {
      $('heroProduct').innerHTML = `<img src="${esc(FF.fixImg(hero.i))}" alt="${esc(hero.name)}" onerror="FF.imgErr(this)"><span class="hero-badge">${Math.round((hero.o - hero.p) / hero.o * 100)}%<small>OFF</small></span>`;
    }

    $('dealCount').textContent = deals.length;
    $('dealGrid').innerHTML = deals.map(d => {
      const pct = Math.round((d.o - d.p) / d.o * 100);
      return `<article class="deal-card">
        <a class="deal-image" href="${href(d.id)}" target="_blank" rel="noopener">
          <img src="${esc(FF.fixImg(d.i))}" alt="${esc(d.name)}" loading="lazy" onerror="FF.imgErr(this)">
          <span class="discount">${pct}% <small>off</small></span>
        </a>
        <div class="deal-body">
          <div class="deal-meta"><span>${esc(d.cat)}</span><span>${esc(d.store)}</span></div>
          <h3><a href="${href(d.id)}" target="_blank" rel="noopener">${esc(d.name)}</a></h3>
          <p class="prices"><strong>${money(d.p)}</strong><span>${money(d.o)}</span></p>
          <div class="saving"><span>You save</span><b>${money(d.o - d.p)}</b></div>
          <a class="view-deal" href="${href(d.id)}" target="_blank" rel="noopener">View product <span>→</span></a>
        </div>
      </article>`;
    }).join('');
    $('empty').hidden = deals.length > 0;

    const rounded = Math.floor(home.total / 1000) * 1000;
    $('announce').textContent = `One search. ${rounded.toLocaleString()}+ products across ${home.stores} UAE home and furniture stores.`;
  }).catch(err => {
    console.error(err);
    $('empty').hidden = false;
  });
})();
