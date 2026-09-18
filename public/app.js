const REFRESH_MS = 60_000;
const MAX_CARDS = 300;

const CATEGORY_LABELS = {
  ETB: 'Elite Trainer Box',
  BOOSTER_BOX: 'Booster box',
  BOOSTER_BUNDLE: 'Booster bundle',
  BOOSTER_PACK: 'Packs & blisters',
  COLLECTION: 'Collection',
  TIN: 'Tin',
  DECK: 'Deck',
  OTHER: 'Other',
};

const KIND_LABELS = {
  RESTOCK: 'Back in stock',
  NEW_PRODUCT: 'New listing',
  PRICE_DROP: 'Price drop',
  SOLD_OUT: 'Sold out',
};

const state = {
  products: [],
  sources: [],
  events: [],
  kind: 'ALL',
};

const $ = (id) => document.getElementById(id);
const nzd = new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' });

const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '#';
  } catch {
    return '#';
  }
}

const price = (cents) => (cents === null || cents === undefined ? '—' : nzd.format(cents / 100));

function timeAgo(value) {
  if (!value) return 'never';
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const fullTime = (value) =>
  value ? new Date(value).toLocaleString('en-NZ', { dateStyle: 'medium', timeStyle: 'short' }) : '';

async function getJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function refresh() {
  try {
    const [productData, sourceData, eventData] = await Promise.all([
      getJson('/api/products'),
      getJson('/api/sources'),
      getJson('/api/events?limit=300'),
    ]);
    state.products = productData.products;
    state.sources = sourceData.sources;
    state.events = eventData.events;

    const time = new Date().toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' });
    $('updated').textContent = `Updated ${time} · refreshes every minute`;

    renderStores();
    renderStoreOptions();
    renderProducts();
    renderFeed();
  } catch (error) {
    $('updated').textContent = `Couldn't load data (${error.message}). Is the tracker running?`;
  }
}

function renderStores() {
  $('stores').innerHTML = state.sources
    .map((source) => {
      const storeProducts = state.products.filter((product) => product.sourceId === source.id && product.listed);
      const inStock = storeProducts.filter((product) => product.inStock).length;
      const failing = source.consecutiveFailures > 0;
      const dotClass = source.checking || !source.lastSuccessAt ? 'pending' : failing ? 'error' : '';
      const lastChecked = source.checking
        ? 'Checking now…'
        : `Checked ${timeAgo(source.lastSuccessAt)}${failing ? ` · last attempt failed ${timeAgo(source.lastRunAt)}` : ''}`;

      return `
        <article class="store">
          <div class="store-head">
            <a class="store-name" href="${escapeHtml(safeUrl(source.url))}" target="_blank" rel="noopener">
              <span class="dot ${dotClass}" aria-hidden="true"></span>${escapeHtml(source.name)}
            </a>
            <button type="button" class="small-button" data-check="${source.id}" ${source.checking ? 'disabled' : ''}>
              ${source.checking ? 'Checking…' : 'Check now'}
            </button>
          </div>
          <div class="store-stats subtle">${inStock} in stock of ${storeProducts.length} tracked</div>
          <div class="store-stats subtle">${escapeHtml(lastChecked)}</div>
          ${failing && source.lastError ? `<p class="store-error">${escapeHtml(source.lastError)}</p>` : ''}
        </article>`;
    })
    .join('');
}

function renderStoreOptions() {
  const select = $('filters').elements.store;
  const current = select.value;
  select.innerHTML =
    '<option value="">All stores</option>' +
    state.sources
      .map((source) => `<option value="${source.id}">${escapeHtml(source.name)}</option>`)
      .join('');
  select.value = current;
}

function currentFilters() {
  const form = $('filters').elements;
  return {
    q: form.q.value.trim().toLowerCase(),
    store: form.store.value,
    category: form.category.value,
    language: form.language.value,
    sort: form.sort.value,
    inStock: form.inStock.checked,
  };
}

const SORTERS = {
  changed: (a, b) => new Date(b.changedAt ?? 0) - new Date(a.changedAt ?? 0),
  new: (a, b) => new Date(b.firstSeenAt) - new Date(a.firstSeenAt),
  'price-asc': (a, b) => (a.priceCents ?? Infinity) - (b.priceCents ?? Infinity),
  'price-desc': (a, b) => (b.priceCents ?? -Infinity) - (a.priceCents ?? -Infinity),
  name: (a, b) => a.title.localeCompare(b.title),
};

function renderProducts() {
  const filters = currentFilters();
  const words = filters.q.split(/\s+/).filter(Boolean);

  const matches = state.products
    .filter((product) => {
      if (!product.listed) return false;
      if (filters.inStock && !product.inStock) return false;
      if (filters.store && String(product.sourceId) !== filters.store) return false;
      if (filters.category && product.category !== filters.category) return false;
      if (filters.language && product.language !== filters.language) return false;
      const haystack = `${product.title} ${product.storeName}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .sort(SORTERS[filters.sort] ?? SORTERS.changed);

  const shown = matches.slice(0, MAX_CARDS);
  $('count').textContent =
    matches.length > shown.length
      ? `Showing ${shown.length} of ${matches.length} products. Narrow the search to see more.`
      : `${matches.length} product${matches.length === 1 ? '' : 's'}`;

  if (shown.length === 0) {
    const noData = state.products.length === 0;
    $('grid').innerHTML = `<div class="empty subtle">${
      noData
        ? 'No products yet. The first check runs when the tracker starts, so give it a minute.'
        : 'Nothing matches these filters.'
    }</div>`;
    return;
  }

  $('grid').innerHTML = shown.map(productCard).join('');
}

function stockBadge(product) {
  const stores = product.storesInStock ?? 0;
  const storeLabel = `In ${stores} store${stores === 1 ? '' : 's'}`;

  if (product.onlineInStock) {
    return `<span class="badge ok">Online</span>${stores > 0 ? `<span class="badge ok">${storeLabel}</span>` : ''}`;
  }
  if (stores > 0) {
    return `<span class="badge ok">${storeLabel}</span>`;
  }
  return `<span class="badge out">${product.inStock ? 'In stock' : 'Sold out'}</span>`;
}

function productCard(product) {
  const url = escapeHtml(safeUrl(product.url));
  const image = product.imageUrl
    ? `<img src="${escapeHtml(safeUrl(product.imageUrl))}" alt="" loading="lazy" />`
    : '<span class="placeholder">No image</span>';

  return `
    <article class="card ${product.inStock ? '' : 'is-out'}">
      <a class="thumb" href="${url}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">${image}</a>
      <div class="card-body">
        <div class="meta">
          ${stockBadge(product)}
          <span class="chip">${escapeHtml(CATEGORY_LABELS[product.category] ?? product.category)}</span>
          ${product.language === 'JP' ? '<span class="chip">Japanese</span>' : ''}
        </div>
        <h3><a href="${url}" target="_blank" rel="noopener">${escapeHtml(product.title)}</a></h3>
        <p class="store-label subtle">${escapeHtml(product.storeName)}</p>
        <div class="card-foot">
          <strong class="price">${price(product.priceCents)}</strong>
          <span class="subtle" title="${escapeHtml(fullTime(product.changedAt))}">
            ${product.storesChecked > 0 ? `${product.storesInStock ?? 0}/${product.storesChecked} stores · ` : ''}${timeAgo(product.changedAt)}
          </span>
        </div>
      </div>
    </article>`;
}

function renderFeed() {
  const events = state.events.filter((event) => state.kind === 'ALL' || event.kind === state.kind);

  if (events.length === 0) {
    $('feed').innerHTML = `<li class="event"><div class="empty subtle" style="grid-column: 1 / -1">${
      state.events.length === 0
        ? "No activity yet. Restocks, new listings and price drops appear here once a store's first check has run."
        : 'No activity of this type yet.'
    }</div></li>`;
    return;
  }

  $('feed').innerHTML = events
    .map((event) => {
      const image = event.imageUrl
        ? `<img src="${escapeHtml(safeUrl(event.imageUrl))}" alt="" loading="lazy" />`
        : '<span class="event-thumb" aria-hidden="true"></span>';
      const priceText =
        event.kind === 'PRICE_DROP' && event.prev
          ? `<s>${price(event.prev.priceCents)}</s> ${price(event.next.priceCents)}`
          : price(event.next.priceCents);
      const store =
        event.locationName && event.locationName !== 'Online'
          ? `${event.storeName} — ${event.locationName}`
          : event.storeName;

      return `
        <li class="event">
          ${image}
          <div class="event-main">
            <a href="${escapeHtml(safeUrl(event.url))}" target="_blank" rel="noopener">${escapeHtml(event.title)}</a>
            <div class="event-line">
              <span class="badge kind-${escapeHtml(event.kind)}">${escapeHtml(KIND_LABELS[event.kind] ?? event.kind)}</span>
              <span class="subtle">${escapeHtml(store)} · ${priceText}</span>
            </div>
          </div>
          <time datetime="${escapeHtml(event.occurredAt)}" title="${escapeHtml(fullTime(event.occurredAt))}">${timeAgo(event.occurredAt)}</time>
        </li>`;
    })
    .join('');
}

function selectTab(tab) {
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.setAttribute('aria-selected', String(button.dataset.tab === tab));
  });
  $('products-panel').hidden = tab !== 'products';
  $('activity-panel').hidden = tab !== 'activity';
}

document.querySelectorAll('[data-tab]').forEach((button) => {
  button.addEventListener('click', () => selectTab(button.dataset.tab));
});

$('filters').addEventListener('input', renderProducts);
$('filters').addEventListener('submit', (event) => event.preventDefault());

$('kind-filter').addEventListener('click', (event) => {
  const button = event.target.closest('[data-kind]');
  if (!button) return;
  state.kind = button.dataset.kind;
  document.querySelectorAll('[data-kind]').forEach((chip) => {
    chip.setAttribute('aria-pressed', String(chip === button));
  });
  renderFeed();
});

$('stores').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-check]');
  if (!button) return;
  button.disabled = true;
  button.textContent = 'Checking…';
  try {
    await getJson(`/api/sources/${button.dataset.check}/check`, { method: 'POST' });
  } catch (error) {
    button.textContent = `Failed (${error.message})`;
  }
  setTimeout(refresh, 3_000);
  setTimeout(refresh, 15_000);
});

refresh();
setInterval(refresh, REFRESH_MS);
