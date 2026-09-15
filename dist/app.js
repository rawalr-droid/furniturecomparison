const PRODUCTS = window.CATALOGUE || [];
const PAGE_SIZE = 24;
const state = { query: '', category: '', room: '', store: '', min: '', max: '', sale: false, sort: 'featured', shown: PAGE_SIZE, compare: [] };

const $ = (id) => document.getElementById(id);
const els = {
  grid: $('productGrid'), count: $('resultCount'), label: $('resultLabel'), search: $('searchInput'),
  category: $('categoryFilter'), room: $('roomFilter'), store: $('storeFilter'), min: $('minPrice'), max: $('maxPrice'),
  sale: $('saleOnly'), sort: $('sortSelect'), load: $('loadMore'), empty: $('emptyState'), active: $('activeFilters'),
  compareCount: $('compareCount'), compareTrigger: $('compareTrigger'), productDialog: $('productDialog'), compareDialog: $('compareDialog')
};

function money(value) { return new Intl.NumberFormat('en-AE', {style:'currency', currency:'AED', maximumFractionDigits:0}).format(value || 0); }
function escapeHTML(value='') { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c])); }
function options(id, values) { values.filter(Boolean).sort().forEach(v => $(id).insertAdjacentHTML('beforeend', `<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`)); }
options('categoryFilter', [...new Set(PRODUCTS.map(p => p.category))]);
options('roomFilter', [...new Set(PRODUCTS.map(p => p.room).filter(r => r !== 'Unspecified'))]);
options('storeFilter', [...new Set(PRODUCTS.map(p => p.store))]);

function filteredProducts() {
  const terms = state.query.toLowerCase().split(/\s+/).filter(Boolean);
  let rows = PRODUCTS.filter(p => {
    const haystack = `${p.name} ${p.variant} ${p.category} ${p.type} ${p.material} ${p.store}`.toLowerCase();
    return terms.every(t => haystack.includes(t)) &&
      (!state.category || p.category === state.category) && (!state.room || p.room === state.room) &&
      (!state.store || p.store === state.store) && (!state.min || p.price >= Number(state.min)) &&
      (!state.max || p.price <= Number(state.max)) && (!state.sale || p.discount > 0);
  });
  rows.sort((a,b) => {
    if (state.sort === 'price-low') return a.price - b.price;
    if (state.sort === 'price-high') return b.price - a.price;
    if (state.sort === 'discount') return b.discount - a.discount;
    if (state.sort === 'name') return a.name.localeCompare(b.name);
    return (b.discount * 2 + (b.image ? 1 : 0)) - (a.discount * 2 + (a.image ? 1 : 0));
  });
  return rows;
}

function imageMarkup(p, cls='product-image') {
  return p.image ? `<img class="${cls}" src="${escapeHTML(p.image)}" alt="${escapeHTML(p.name)}" loading="lazy" onerror="this.outerHTML='<div class=&quot;image-fallback&quot;>Image unavailable</div>'">` : '<div class="image-fallback">Image unavailable</div>';
}
function card(p) {
  const selected = state.compare.includes(p.id);
  return `<article class="product-card">
    <div data-view="${escapeHTML(p.id)}">${imageMarkup(p)}</div>
    <div class="product-body">
      <div class="product-kicker"><span>${escapeHTML(p.store)}</span>${p.discount ? `<span class="sale-badge">${Math.round(p.discount*100)}% off</span>` : ''}</div>
      <h3>${escapeHTML(p.name)}</h3>
      <div class="price">${money(p.price)}${p.original > p.price ? `<span class="was-price">${money(p.original)}</span>` : ''}</div>
      <div class="card-actions"><button class="view-button" data-view="${escapeHTML(p.id)}">View details</button><button class="${selected?'selected':''}" data-compare="${escapeHTML(p.id)}">${selected?'Added':'Compare'}</button></div>
    </div>
  </article>`;
}

function render() {
  const rows = filteredProducts(); const visible = rows.slice(0, state.shown);
  els.grid.innerHTML = visible.map(card).join('');
  els.count.textContent = `${rows.length.toLocaleString()} products`;
  els.label.textContent = state.query ? `Results for “${state.query}”` : 'Browse the catalogue';
  els.load.hidden = visible.length >= rows.length || !rows.length;
  els.empty.hidden = !!rows.length; els.grid.hidden = !rows.length;
  renderPills();
}

function renderPills() {
  const pills = [['query',state.query],['category',state.category],['room',state.room],['store',state.store],['sale',state.sale?'On sale':null]].filter(([,v])=>v);
  els.active.innerHTML = pills.map(([k,v]) => `<button class="filter-pill" data-clear="${k}">${escapeHTML(v)} ×</button>`).join('');
}

function syncFilters() {
  state.category=els.category.value; state.room=els.room.value; state.store=els.store.value;
  state.min=els.min.value; state.max=els.max.value; state.sale=els.sale.checked; state.sort=els.sort.value; state.shown=PAGE_SIZE; render();
}
function reset() {
  Object.assign(state,{query:'',category:'',room:'',store:'',min:'',max:'',sale:false,sort:'featured',shown:PAGE_SIZE});
  els.search.value=''; els.category.value=''; els.room.value=''; els.store.value=''; els.min.value=''; els.max.value=''; els.sale.checked=false; els.sort.value='featured'; render();
}

function similarity(base, p) {
  if (base.id===p.id) return -1;
  let score=0; if(base.type===p.type) score+=8; if(base.category===p.category) score+=5; if(base.room===p.room) score+=2;
  if(base.material && p.material && base.material.toLowerCase().includes(p.material.toLowerCase().split(',')[0])) score+=2;
  if(base.store!==p.store) score+=10; const ratio=Math.min(base.price,p.price)/Math.max(base.price,p.price); score+=ratio*3;
  const words=new Set(base.name.toLowerCase().split(/\W+/)); p.name.toLowerCase().split(/\W+/).forEach(w=>{if(w.length>3&&words.has(w))score+=1}); return score;
}
function similarTo(p) { return PRODUCTS.map(x=>({p:x,s:similarity(p,x)})).filter(x=>x.s>=0).sort((a,b)=>b.s-a.s).slice(0,4).map(x=>x.p); }
function fact(label,value){ return value ? `<div class="fact"><span>${label}</span>${escapeHTML(value)}</div>`:''; }

function openProduct(id) {
  const p=PRODUCTS.find(x=>x.id===id); if(!p)return;
  const similar=similarTo(p);
  $('productDialogContent').innerHTML=`<div class="product-detail">
    ${imageMarkup(p,'detail-image')}
    <div class="detail-copy"><div class="store">${escapeHTML(p.store)}</div><h2>${escapeHTML(p.name)}</h2><p class="variant">${escapeHTML(p.variant||p.type)}</p>
      <p class="detail-price">${money(p.price)}${p.original>p.price?` <span class="was-price">${money(p.original)}</span>`:''}</p>
      <div class="facts">${fact('Category',p.type)}${fact('Room',p.room)}${fact('Material',p.material)}${fact('Dimensions',p.dimensions)}</div>
      <p class="description">${escapeHTML(p.description||'See the retailer website for full product information.')}</p>
      <a class="retailer-link" href="${escapeHTML(p.url)}" target="_blank" rel="noopener sponsored">View at ${escapeHTML(p.store)}</a>
    </div>
    <div class="similar-wrap"><h3>Similar pieces across stores</h3><div class="similar-grid">${similar.map(s=>`<button class="similar-item" data-view="${escapeHTML(s.id)}">${imageMarkup(s)}<div><strong>${escapeHTML(s.name)}</strong><span>${money(s.price)} · ${escapeHTML(s.store)}</span></div></button>`).join('')}</div></div>
  </div>`;
  els.productDialog.showModal();
}

function toggleCompare(id) {
  if(state.compare.includes(id)) state.compare=state.compare.filter(x=>x!==id);
  else if(state.compare.length<3) state.compare.push(id);
  else return toast('You can compare up to 3 items');
  els.compareCount.textContent=state.compare.length; els.compareTrigger.disabled=state.compare.length<2; render();
}
function openCompare() {
  const items=state.compare.map(id=>PRODUCTS.find(p=>p.id===id)).filter(Boolean); if(items.length<2)return;
  const row=(label,fn)=>`<tr><td>${label}</td>${items.map(p=>`<td>${fn(p)||'—'}</td>`).join('')}</tr>`;
  $('compareContent').innerHTML=`<table class="compare-table"><tbody>
    ${row('',p=>imageMarkup(p))}${row('Product',p=>`<strong>${escapeHTML(p.name)}</strong><br><small>${escapeHTML(p.store)}</small>`)}
    ${row('Price',p=>`<strong>${money(p.price)}</strong>${p.original>p.price?`<br><small>${Math.round(p.discount*100)}% off</small>`:''}`)}
    ${row('Type',p=>escapeHTML(p.type))}${row('Material',p=>escapeHTML(p.material))}${row('Dimensions',p=>escapeHTML(p.dimensions))}
    ${row('',p=>`<a href="${escapeHTML(p.url)}" target="_blank" rel="noopener sponsored">View at retailer</a>`)}</tbody></table>`;
  els.compareDialog.showModal();
}
function toast(message){ const t=$('toast');t.textContent=message;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),1800); }

$('searchForm').addEventListener('submit',e=>{e.preventDefault();state.query=els.search.value.trim();state.shown=PAGE_SIZE;render();$('browse').scrollIntoView({behavior:'smooth'});});
document.querySelectorAll('[data-query]').forEach(b=>b.addEventListener('click',()=>{els.search.value=b.dataset.query;state.query=b.dataset.query;render();$('browse').scrollIntoView({behavior:'smooth'});}));
[els.category,els.room,els.store,els.sale,els.sort].forEach(x=>x.addEventListener('change',syncFilters));
[els.min,els.max].forEach(x=>x.addEventListener('input',()=>{clearTimeout(x.timer);x.timer=setTimeout(syncFilters,250);}));
$('clearFilters').addEventListener('click',reset); $('emptyReset').addEventListener('click',reset);
$('filterToggle').addEventListener('click',()=>[$('filters').classList.toggle('open')]);
els.load.addEventListener('click',()=>{state.shown+=PAGE_SIZE;render();}); els.compareTrigger.addEventListener('click',openCompare);
document.addEventListener('click',e=>{
  const view=e.target.closest('[data-view]'); const comp=e.target.closest('[data-compare]'); const clear=e.target.closest('[data-clear]');
  if(view) openProduct(view.dataset.view); if(comp) toggleCompare(comp.dataset.compare);
  if(clear){const k=clear.dataset.clear;if(k==='query'){state.query='';els.search.value='';}else if(k==='sale'){state.sale=false;els.sale.checked=false;}else{state[k]='';els[k].value='';}state.shown=PAGE_SIZE;render();}
  const closer=e.target.closest('[data-close]');if(closer)$(closer.dataset.close+'Dialog').close();
});
[els.productDialog,els.compareDialog].forEach(d=>d.addEventListener('click',e=>{if(e.target===d)d.close();}));
render();
