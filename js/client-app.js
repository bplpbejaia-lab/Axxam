const CLIENT_SESSION_KEY = 'axxam_client_account';
const CLIENT_API_BASE = String(window.AXXAM_CLIENT_API_BASE || '').replace(/\/+$/, '');
const CLIENT_ASSET_BASE = String(window.AXXAM_CLIENT_ASSET_BASE || CLIENT_API_BASE || '').replace(/\/+$/, '');

const state = {
    account: null,
    products: [],
    categories: [],
    selectedCategory: 'all',
    search: '',
    cart: []
};

const statusLabels = {
    nouvelle: 'Nouvelle',
    confirmee: 'Confirmee',
    preparation: 'En preparation',
    prete: 'Prete',
    livree: 'Livree',
    annulee: 'Annulee'
};

function $(id) {
    return document.getElementById(id);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatPrice(price) {
    const value = Number(price) || 0;
    return value.toFixed(1).replace('.', ',') + ' DA';
}

function clientApiUrl(path) {
    if (/^https?:\/\//i.test(path)) return path;
    return `${CLIENT_API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

function clientAssetUrl(path) {
    const value = String(path || '').trim();
    if (!value) return '';
    if (/^(https?:|data:|blob:)/i.test(value)) return value;
    const cleanPath = value.replace(/^\/+/, '');
    const url = CLIENT_ASSET_BASE ? `${CLIENT_ASSET_BASE}/${cleanPath}` : `/${cleanPath}`;
    return encodeURI(url);
}

function productImage(product) {
    return clientAssetUrl(product.image || 'bibliotheque image/gateau.png');
}

function fallbackProductImage() {
    return clientAssetUrl('bibliotheque image/gateau.png');
}

function findClientProduct(productId) {
    return state.products.find(item => String(item.id) === String(productId));
}

function getClientCategoryName(categoryId) {
    return state.categories.find(category => String(category.id) === String(categoryId))?.name || 'Produit';
}

function normalizeClientText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function showClientToast(message) {
    const toast = $('clientToast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('active');
    setTimeout(() => toast.classList.remove('active'), 2400);
}

function saveClientSession(account) {
    state.account = account;
    localStorage.setItem(CLIENT_SESSION_KEY, JSON.stringify(account));
}

function loadClientSession() {
    try {
        const saved = localStorage.getItem(CLIENT_SESSION_KEY);
        state.account = saved ? JSON.parse(saved) : null;
    } catch {
        state.account = null;
    }
}

function clearClientSession() {
    state.account = null;
    state.cart = [];
    localStorage.removeItem(CLIENT_SESSION_KEY);
}

function updateClientAuthUi() {
    const isLoggedIn = !!state.account;
    const authView = $('clientAuthView');
    const shell = $('clientStoreShell');
    const accountBar = $('clientAccountBar');
    const accountLabel = $('clientAccountLabel');
    const checkoutIdentity = $('clientCheckoutIdentity');
    const addressInput = $('clientAddress');
    const accountTab = $('clientAccountTab');

    if (shell) shell.hidden = false;
    if (accountBar) accountBar.hidden = !isLoggedIn;
    if (accountTab) accountTab.hidden = isLoggedIn;

    if (isLoggedIn) {
        if (authView) authView.hidden = true;
        if (accountLabel) accountLabel.textContent = `${state.account.name} (${state.account.login})`;
        if (checkoutIdentity) {
            checkoutIdentity.innerHTML = `
                <strong>${escapeHtml(state.account.name)}</strong>
                <span>${escapeHtml(state.account.phone)}</span>
            `;
        }
        if (addressInput && !addressInput.value) addressInput.value = state.account.address || '';
    } else {
        if (checkoutIdentity) {
            checkoutIdentity.innerHTML = `
                <strong>Compte requis</strong>
                <span>Connectez-vous pour envoyer la commande.</span>
            `;
        }
    }
}

async function clientApi(path, options = {}) {
    const response = await fetch(clientApiUrl(path), {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Action impossible');
    return data;
}

async function loginClient(event) {
    event.preventDefault();
    try {
        const data = await clientApi('/api/client/login', {
            method: 'POST',
            body: JSON.stringify({
                login: $('loginIdentifier').value,
                password: $('loginPassword').value
            })
        });
        saveClientSession(data.account);
        $('clientLoginForm').reset();
        updateClientAuthUi();
        await loadCatalog();
        await loadClientOrders();
        switchClientView('catalog');
        showClientToast('Connexion reussie');
    } catch (error) {
        showClientToast(error.message);
    }
}

async function registerClient(event) {
    event.preventDefault();
    try {
        const data = await clientApi('/api/client/register', {
            method: 'POST',
            body: JSON.stringify({
                login: $('registerLogin').value,
                password: $('registerPassword').value,
                name: $('registerName').value,
                phone: $('registerPhone').value,
                address: $('registerAddress').value
            })
        });
        saveClientSession(data.account);
        $('clientRegisterForm').reset();
        updateClientAuthUi();
        await loadCatalog();
        await loadClientOrders();
        switchClientView('catalog');
        showClientToast('Compte cree');
    } catch (error) {
        showClientToast(error.message);
    }
}

function logoutClient() {
    clearClientSession();
    renderClientCart();
    updateClientAuthUi();
    switchClientView('catalog');
    showClientToast('Deconnecte');
}

async function loadCatalog() {
    const response = await fetch(clientApiUrl('/api/client/catalog'), { cache: 'no-store' });
    if (!response.ok) throw new Error('Catalogue indisponible');
    const catalog = await response.json();
    state.products = catalog.products || [];
    state.categories = catalog.categories || [];
    renderClientCategories();
    renderClientProducts();
    renderClientCart();
}

function renderClientCategories() {
    const container = $('clientCategoryTabs');
    if (!container) return;
    const activeCategory = state.selectedCategory || 'all';
    const allBtn = `<button class="client-category-pill ${activeCategory === 'all' ? 'active' : ''}" data-category="all">Tous <span>${state.products.length}</span></button>`;
    const categoryBtns = state.categories.map(category => {
        const count = state.products.filter(product => String(product.category) === String(category.id)).length;
        const isActive = String(activeCategory) === String(category.id);
        return `<button class="client-category-pill ${isActive ? 'active' : ''}" data-category="${category.id}">${escapeHtml(category.name)} <span>${count}</span></button>`;
    }).join('');
    container.innerHTML = allBtn + categoryBtns;
    container.querySelectorAll('.client-category-pill').forEach(button => {
        button.addEventListener('click', () => {
            state.selectedCategory = button.dataset.category;
            container.querySelectorAll('.client-category-pill').forEach(item => item.classList.toggle('active', item === button));
            renderClientProducts();
        });
    });
}

function renderClientProducts() {
    const container = $('clientProductsGrid');
    if (!container) return;
    const search = normalizeClientText(state.search);
    const products = state.products.filter(product => {
        const matchesCategory = state.selectedCategory === 'all' || String(product.category) === String(state.selectedCategory);
        const matchesSearch = !search || normalizeClientText(`${product.name || ''} ${getClientCategoryName(product.category)}`).includes(search);
        return matchesCategory && matchesSearch;
    });
    const countLabel = $('clientCatalogCount');
    if (countLabel) countLabel.textContent = `${products.length} produit${products.length > 1 ? 's' : ''}`;

    if (!products.length) {
        container.innerHTML = '<div class="client-empty">Aucun produit disponible.</div>';
        return;
    }

    const fallbackImage = fallbackProductImage();
    container.innerHTML = products.map(product => `
        <article class="client-product-card">
            <button type="button" class="client-product-media" onclick="openClientProductDetail('${product.id}')" aria-label="Voir ${escapeHtml(product.name)}">
                <img src="${escapeHtml(productImage(product))}" alt="${escapeHtml(product.name)}" loading="lazy"
                    onerror="this.src='${escapeHtml(fallbackImage)}'">
            </button>
            <div class="client-product-body">
                <span class="client-product-category">${escapeHtml(getClientCategoryName(product.category))}</span>
                <h3>${escapeHtml(product.name)}</h3>
                <div class="client-product-meta">
                    <strong>${formatPrice(product.price)}</strong>
                    <span>${Number(product.stock) > 0 ? 'Disponible' : 'Sur commande'}</span>
                </div>
                <div class="client-product-actions">
                    <button class="btn btn-outline" type="button" onclick="openClientProductDetail('${product.id}')">Voir</button>
                    <button class="btn btn-primary" type="button" onclick="addClientCartItem('${product.id}')">${state.account ? 'Ajouter' : 'Commander'}</button>
                </div>
            </div>
        </article>
    `).join('');
}

function addClientCartItem(productId) {
    if (!state.account) {
        switchClientView('account');
        showClientToast('Compte requis pour commander');
        return;
    }
    const product = findClientProduct(productId);
    if (!product) return;
    const existing = state.cart.find(item => String(item.productId) === String(productId));
    if (existing) existing.quantity += 1;
    else state.cart.push({ productId: product.id, quantity: 1 });
    renderClientCart();
    showClientToast('Produit ajoute au panier');
}

function openClientProductDetail(productId) {
    const product = findClientProduct(productId);
    const detail = $('clientProductDetail');
    const modal = $('clientProductModal');
    if (!product || !detail || !modal) return;

    const stock = Number(product.stock) || 0;
    const fallbackImage = fallbackProductImage();
    detail.innerHTML = `
        <div class="client-product-detail-media">
            <img src="${escapeHtml(productImage(product))}" alt="${escapeHtml(product.name)}" onerror="this.src='${escapeHtml(fallbackImage)}'">
        </div>
        <div class="client-product-detail-body">
            <span class="client-product-detail-category">${escapeHtml(getClientCategoryName(product.category))}</span>
            <h2>${escapeHtml(product.name)}</h2>
            <strong>${formatPrice(product.price)}</strong>
            <dl>
                <div><dt>Disponibilite</dt><dd>${stock > 0 ? 'Disponible' : 'Sur commande'}</dd></div>
                <div><dt>Stock affiche</dt><dd>${stock.toFixed(1)}</dd></div>
                <div><dt>Reference</dt><dd>${escapeHtml(product.id)}</dd></div>
            </dl>
            <button class="btn btn-primary w-full" type="button" onclick="addClientCartItem('${product.id}'); closeClientProductDetail();">
                ${state.account ? 'Ajouter au panier' : 'Se connecter pour commander'}
            </button>
        </div>
    `;
    modal.hidden = false;
}

function closeClientProductDetail() {
    const modal = $('clientProductModal');
    if (modal) modal.hidden = true;
}

function updateClientCartQty(productId, delta) {
    const item = state.cart.find(cartItem => String(cartItem.productId) === String(productId));
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) {
        state.cart = state.cart.filter(cartItem => String(cartItem.productId) !== String(productId));
    }
    renderClientCart();
}

function renderClientCart() {
    const container = $('clientCartItems');
    const count = state.cart.reduce((sum, item) => sum + item.quantity, 0);
    const total = state.cart.reduce((sum, item) => {
        const product = state.products.find(p => String(p.id) === String(item.productId));
        return sum + (Number(product?.price) || 0) * item.quantity;
    }, 0);

    if ($('clientCartCount')) $('clientCartCount').textContent = count;
    if ($('clientCartTotal')) $('clientCartTotal').textContent = formatPrice(total);

    if (!container) return;
    if (!state.cart.length) {
        container.innerHTML = '<div class="client-empty">Votre panier est vide.</div>';
        return;
    }

    const fallbackImage = fallbackProductImage();
    container.innerHTML = state.cart.map(item => {
        const product = state.products.find(p => String(p.id) === String(item.productId));
        if (!product) return '';
        return `
            <div class="client-cart-item">
                <img src="${escapeHtml(productImage(product))}" alt="${escapeHtml(product.name)}" onerror="this.src='${escapeHtml(fallbackImage)}'">
                <div>
                    <strong>${escapeHtml(product.name)}</strong>
                    <span>${formatPrice(product.price)}</span>
                </div>
                <div class="client-cart-qty">
                    <button type="button" onclick="updateClientCartQty('${product.id}', -1)">-</button>
                    <span>${item.quantity}</span>
                    <button type="button" onclick="updateClientCartQty('${product.id}', 1)">+</button>
                </div>
            </div>
        `;
    }).join('');
}

async function submitClientOrder(event) {
    event.preventDefault();
    if (!state.account) {
        switchClientView('account');
        showClientToast('Compte requis pour commander');
        return;
    }
    if (!state.cart.length) {
        showClientToast('Ajoutez un produit avant de commander');
        return;
    }

    const payload = {
        accountId: state.account.id,
        address: $('clientAddress').value,
        note: $('clientNote').value,
        items: state.cart.map(item => ({ productId: item.productId, quantity: item.quantity }))
    };

    try {
        const result = await clientApi('/api/client/orders', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        state.cart = [];
        renderClientCart();
        $('clientCheckoutForm').reset();
        if ($('clientAddress')) $('clientAddress').value = state.account.address || '';
        showClientToast(`Commande envoyee: ${result.order.code}`);
        switchClientView('tracking');
        await loadClientOrders();
    } catch (error) {
        showClientToast(error.message);
    }
}

async function loadClientOrders() {
    const container = $('clientOrdersList');
    if (!container) return;
    if (!state.account) {
        container.innerHTML = '<div class="client-empty">Connectez-vous pour voir vos commandes.</div>';
        return;
    }

    const response = await fetch(clientApiUrl(`/api/client/orders?accountId=${encodeURIComponent(state.account.id)}`), { cache: 'no-store' });
    const data = response.ok ? await response.json() : { orders: [] };
    const orders = data.orders || [];

    if (!orders.length) {
        container.innerHTML = '<div class="client-empty">Aucune commande pour ce compte.</div>';
        return;
    }

    container.innerHTML = orders.map(order => `
        <article class="client-order-card">
            <div>
                <span>${escapeHtml(order.code)}</span>
                <strong>${statusLabels[order.status] || order.status}</strong>
            </div>
            <p>${new Date(order.createdAt).toLocaleString('fr-FR')} - ${formatPrice(order.total)}</p>
            <ul>
                ${(order.items || []).map(item => `<li>${escapeHtml(item.name)} x ${item.quantity}</li>`).join('')}
            </ul>
        </article>
    `).join('');
}

function switchClientView(view) {
    const catalog = $('clientCatalogView');
    const tracking = $('clientTrackingView');
    const cart = $('clientCartPanel');
    const account = $('clientAuthView');
    const isCatalog = view === 'catalog';
    const isTracking = view === 'tracking';
    const isAccount = view === 'account';
    const showCart = isCatalog && !!state.account;

    if (catalog) catalog.hidden = !isCatalog;
    if (tracking) tracking.hidden = !isTracking;
    if (account) account.hidden = !isAccount || !!state.account;
    if (cart) cart.hidden = !showCart;
    const shell = $('clientStoreShell');
    if (shell) shell.classList.toggle('client-store-shell-wide', !showCart);
    document.querySelectorAll('.client-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.clientView === view);
    });
    if (view === 'tracking') {
        if (!state.account) {
            switchClientView('account');
            showClientToast('Connectez-vous pour voir vos commandes');
            return;
        }
        loadClientOrders();
    }
    if (view === 'account') switchAuthView('login');
}

function switchAuthView(view) {
    const isLogin = view === 'login';
    if ($('clientLoginForm')) $('clientLoginForm').hidden = !isLogin;
    if ($('clientRegisterForm')) $('clientRegisterForm').hidden = isLogin;
    document.querySelectorAll('.client-auth-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.authView === view);
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    loadClientSession();
    updateClientAuthUi();

    $('clientLoginForm')?.addEventListener('submit', loginClient);
    $('clientRegisterForm')?.addEventListener('submit', registerClient);
    $('clientLogoutBtn')?.addEventListener('click', logoutClient);
    $('clientProductSearch')?.addEventListener('input', event => {
        state.search = event.target.value;
        renderClientProducts();
    });
    $('clientProductModalClose')?.addEventListener('click', closeClientProductDetail);
    $('clientProductModal')?.addEventListener('click', event => {
        if (event.target === $('clientProductModal')) closeClientProductDetail();
    });
    $('clientCheckoutForm')?.addEventListener('submit', submitClientOrder);
    $('clientTrackingForm')?.addEventListener('submit', (event) => {
        event.preventDefault();
        loadClientOrders();
    });

    document.querySelectorAll('.client-tab').forEach(tab => {
        tab.addEventListener('click', () => switchClientView(tab.dataset.clientView));
    });
    document.querySelectorAll('.client-auth-tab').forEach(tab => {
        tab.addEventListener('click', () => switchAuthView(tab.dataset.authView));
    });

    try {
        await loadCatalog();
        if (state.account) await loadClientOrders();
        switchClientView('catalog');
    } catch {
        showClientToast('Catalogue indisponible');
    }
});
