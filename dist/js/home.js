(function () {
  'use strict';
  const { esc, enc, $ } = FF;

  // Shop by category: one sideways row; the list is fixed in js/home-tiles.js
  const row = $('catRow');
  row.innerHTML = (window.FF_HOME_TILES || []).map(t => `<a class="t2-tile" href="browse.html?c=${enc(t.c)}">
    <img referrerpolicy="no-referrer" loading="lazy" src="${esc(FF.fixImg(t.i))}" alt="" onerror="this.remove()">
    <span class="t2-tl"><b>${esc(t.n)}</b><span>Shop →</span></span></a>`).join('');
  document.querySelectorAll('[data-row]').forEach(b => b.addEventListener('click', () =>
    row.scrollBy({ left: Number(b.dataset.row) * row.clientWidth * 0.8, behavior: 'smooth' })));

  // Room banner (built nightly, not edited here): a dot in the upper half opens its card below, so the card is never cut off
  document.querySelectorAll('.ffb-dot-tag').forEach(t => { if (parseFloat(t.style.top) < 50) t.classList.add('ffb-below'); });

  FF.loadMeta().catch(() => {});

  // Tonight's best deals: the nightly build picks them (data/home.json); the chips filter them here
  FF.fetchJSON('data/home.json').then(home => {
    const deals = home.deals || [];
    const groups = [...new Set(deals.map(d => d.g).filter(Boolean))];
    let cur = '';
    function draw() {
      $('dealChips').innerHTML = groups.length > 1 ? [['', `All (${deals.length})`]].concat(groups.map(g => [g, g]))
        .map(([g, t]) => `<button type="button" class="t2-chip${g === cur ? ' on' : ''}" data-g="${esc(g)}" aria-pressed="${g === cur}">${esc(t)}</button>`).join('') : '';
      $('dealGrid').innerHTML = deals.filter(d => !cur || d.g === cur)
        .map(d => FF.pcCard({ id: d.id, name: d.name, store: d.store, img: FF.fixImg(d.i), price: d.p, orig: d.o, l3: d.cat })).join('');
    }
    $('dealChips').addEventListener('click', e => { const c = e.target.closest('.t2-chip'); if (c) { cur = c.dataset.g; draw(); } });
    draw();
    $('empty').hidden = deals.length > 0;
  }).catch(err => {
    console.error(err);
    $('empty').hidden = false;
  });
})();
