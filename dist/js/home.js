(function () {
  'use strict';
  const { esc, enc, $ } = FF;

  // Shop by category: one sideways row; the list is fixed in js/home-tiles.js
  const row = $('catRow');
  row.innerHTML = (window.FF_HOME_TILES || []).map(t => `<a class="t2-tile" href="browse.html?c=${enc(t.c)}">
    <img referrerpolicy="no-referrer" loading="lazy" src="${esc(FF.fixImg(t.i))}" alt="" onerror="this.remove()">
    <span class="t2-tl"><b>${esc(t.n)}</b><span>Shop →</span></span></a>`).join('');
  document.querySelectorAll('[data-row]').forEach(b => b.addEventListener('click', () => {
    const r = b.parentElement.querySelector('.t2-tiles');             // each arrow scrolls the row it sits next to
    r.scrollBy({ left: Number(b.dataset.row) * r.clientWidth * 0.8, behavior: 'smooth' });
  }));

  // Shop by mood: the five mood boards (data/boards/index.json, rebuilt every night)
  FF.fetchJSON('data/boards/index.json').then(d => {
    $('moodRow').innerHTML = d.boards.map(m => `<a class="t2-tile mb-tile" href="board.html?b=${enc(m.key)}">
      <img src="${esc(m.image)}" alt="${esc(m.name)} room" loading="lazy" onerror="this.remove()">
      <span class="t2-tl"><b>${esc(m.name)}<small>${esc(m.line)}</small></b><span>Explore →</span></span></a>`).join('');
  }).catch(() => { const sec = $('moods'); if (sec) sec.hidden = true; });

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
