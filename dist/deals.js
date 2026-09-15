const DEALS = window.CATALOGUE || [];
const AED = new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 });
const escapeHTML = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));

function savings(product) { return Math.max(0, product.original - product.price); }

function selectBalancedDeals() {
  const candidates = DEALS
    .filter(product => product.discount >= .7 && product.original >= 1000 && product.price > 0 && product.url)
    .sort((a, b) => b.discount - a.discount || savings(b) - savings(a) || b.original - a.original);

  for (let target = Math.min(50, candidates.length); target >= 1; target--) {
    const perCategory = Math.max(1, Math.floor(target * .2));
    const selected = [];
    const categoryCounts = new Map();
    for (const product of candidates) {
      const count = categoryCounts.get(product.category) || 0;
      if (count >= perCategory) continue;
      selected.push(product);
      categoryCounts.set(product.category, count + 1);
      if (selected.length === target) return selected;
    }
  }
  return [];
}

function card(product, index) {
  const percent = Math.round(product.discount * 100);
  const image = product.image
    ? `<img src="${escapeHTML(product.image)}" alt="${escapeHTML(product.name)}" loading="lazy">`
    : `<div class="image-fallback">Furniture deal</div>`;
  return `<article class="deal-card deal-card-${index % 7}">
    <a class="deal-image" href="${escapeHTML(product.url)}" target="_blank" rel="noopener sponsored">${image}<span class="discount">${percent}%<small>off</small></span></a>
    <div class="deal-body">
      <div class="deal-meta"><span>${escapeHTML(product.category)}</span><span>${escapeHTML(product.store)}</span></div>
      <h3>${escapeHTML(product.name)}</h3>
      <p class="prices"><strong>${AED.format(product.price)}</strong><span>${AED.format(product.original)}</span></p>
      <div class="saving"><span>You save</span><b>${AED.format(savings(product))}</b></div>
      <a class="view-deal" href="${escapeHTML(product.url)}" target="_blank" rel="noopener sponsored">View this deal <span>↗</span></a>
    </div>
  </article>`;
}

const selected = selectBalancedDeals();
document.getElementById('dealCount').textContent = selected.length;
document.getElementById('deals').innerHTML = selected.map(card).join('');
document.getElementById('empty').hidden = selected.length > 0;
const refreshed = DEALS.map(product => product.source_run_date).filter(Boolean).sort().pop();
document.getElementById('updatedDate').textContent = refreshed ? new Date(`${refreshed}T00:00:00`).toLocaleDateString('en-AE', { day: 'numeric', month: 'short' }) : 'Live';
