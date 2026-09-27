(function () {
  'use strict';
  const { esc, money, $ } = FF;
  let active = 'All rooms';

  // current price for a saved id: the product record, or the chosen size/colour option of a card ("<id>~king~beige")
  async function current(item) {
    const d = await FF.loadDetail(item.id).catch(() => null);
    if (!d) return { gone: true };
    let price = d.p, orig = d.o || 0;
    const want = item.id.split('~').slice(1);
    if (want.length) {
      const hits = (d.v || []).filter(v => v.p && want.every(w => w === FF.slug(v.z) || w === FF.slug(v.k))).sort((a, b) => a.p - b.p);
      if (hits[0]) { price = hits[0].p; orig = hits[0].o || 0; }
    }
    return { price, orig, name: d.n, store: FF.stores[d.s], img: FF.fixImg(d.i), out: d.t === 0 };
  }

  async function render() {
    await FF.loadMeta();
    const w = FF.wish.load();
    const rooms = FF.ROOMS.filter(r => w.rooms[r].length);
    const total = FF.wish.count();
    $('wishSummary').textContent = total
      ? `${total} product${total > 1 ? 's' : ''} across ${rooms.length} room${rooms.length > 1 ? 's' : ''}. Prices update every night.`
      : 'Nothing saved yet. Tap the ♡ on any product and pick a room.';
    const tabs = ['All rooms', ...FF.ROOMS];
    if (!tabs.includes(active)) active = 'All rooms';
    $('wishTabs').innerHTML = tabs.map(t => {
      const n = t === 'All rooms' ? total : w.rooms[t].length;
      return `<button type="button" role="tab" class="wish-tab${t === active ? ' on' : ''}" aria-selected="${t === active}" data-tab="${esc(t)}">${esc(t)}${n ? ` <span>${n}</span>` : ''}</button>`;
    }).join('');
    const show = active === 'All rooms' ? rooms : [active];
    if (!total) {
      $('wishRooms').innerHTML = `<div class="wish-empty"><p>Save pieces to Living Room, Bedroom, Dining Room, Kitchen or Bathroom and they'll appear here, grouped by room.</p><a class="btn-dark" href="browse.html">Browse furniture →</a></div>`;
      return;
    }
    const sections = await Promise.all(show.map(async room => {
      const items = w.rooms[room];
      if (!items.length) return `<section class="wish-room-sec"><h2>${esc(room)}</h2><p class="wish-sub">Nothing saved to this room yet.</p></section>`;
      const live = await Promise.all(items.map(current));
      let sum = 0, was = 0;
      const cards = items.map((it, i) => {
        const c = live[i];
        if (c.gone) return `<li class="pc-card wish-gone"><div class="pc-body"><div class="pc-meta"><span class="pc-brand">${esc(it.store || '')}</span></div>
          <span class="pc-name" title="${esc(it.name || '')}">${esc(it.name || it.id)}</span><p class="pc-price"><span class="pc-price-was">No longer listed</span></p>
          <button class="wish-remove" type="button" data-remove="${esc(it.id)}" data-room="${esc(room)}">Remove</button></div></li>`;
        sum += c.price; was += c.orig > c.price ? c.orig : c.price;
        const html = FF.pcCard({ id: it.id, name: c.name, store: c.store, img: c.img, price: c.price, orig: c.orig, size: it.size, colours: it.colours, room });
        const drop = it.price && c.price < it.price ? `<p class="wish-drop">↓ ${money(it.price - c.price)} since you saved it</p>` : '';
        const out = c.out ? '<p class="wish-drop wish-out">Out of stock at last check</p>' : '';
        return html.replace('</div>\n    </li>', `${drop}${out}</div>\n    </li>`);
      }).join('');
      const save = was > sum ? ` · you'd save ${money(was - sum)}` : '';
      return `<section class="wish-room-sec"><div class="wish-room-head"><h2>${esc(room)}</h2>
        <p class="wish-sub">${items.length} piece${items.length > 1 ? 's' : ''} · together ${money(sum)}${save}</p></div>
        <ul class="pc-grid">${cards}</ul></section>`;
    }));
    $('wishRooms').innerHTML = sections.join('');
  }

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-tab]'); if (t) { active = t.dataset.tab; render(); return; }
    const r = e.target.closest('[data-remove]'); if (r) { FF.wish.toggle(r.dataset.remove, r.dataset.room); }
  });
  let timer; document.addEventListener('ff-wish', () => { clearTimeout(timer); timer = setTimeout(render, 400); });   // re-draw after a room change
  render().catch(err => { console.error(err); $('wishSummary').textContent = 'Your wishlist could not be loaded. Please refresh the page.'; });
})();
