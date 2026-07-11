/**
 * Axxam - Chocolaterie Management System
 * Full Width Version with All Features
 */

// Flush any pending debounced save before leaving the page
window.addEventListener('beforeunload', function () {
    if (typeof _saveTimeout !== 'undefined' && _saveTimeout) {
        clearTimeout(_saveTimeout);
        _doSave();
    }
});

// ==========================================
// Data
// ==========================================

let db = {
    categories: [],
    products: [],
    adjustments: [],
    orders: [],
    withdrawals: [],
    components: [],
    lots: [],
    recipes: [],
    customerOrders: [],
    clientAccounts: [],
    invoices: [],
    suppliers: [],
    purchaseOrders: [],
    purchaseInvoices: [],
    saleReturns: [],
    purchaseReturns: [],
    settings: null
};

const DB_API_URL = '/api/db';
let remoteDbAvailable = false;

function syncWindowDb() {
    window.db = db;
    window.parallelOrdersCache = parallelOrders;
}

function shouldUseRemoteDb() {
    return window.location.protocol === 'http:' || window.location.protocol === 'https:';
}

async function loadRemoteState() {
    if (!shouldUseRemoteDb()) return null;

    try {
        const response = await fetch(DB_API_URL, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const state = await response.json();
        if (!state || !state.db) throw new Error('Reponse DB invalide');
        remoteDbAvailable = true;
        return state;
    } catch (error) {
        remoteDbAvailable = false;
        console.warn('SQLite indisponible, fallback local:', error.message);
        return null;
    }
}

function saveRemoteState(payload) {
    if (!shouldUseRemoteDb()) return Promise.reject(new Error('Serveur local absent'));

    return fetch(DB_API_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
    }).then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        remoteDbAvailable = true;
        return response.json();
    });
}

function saveLocalFallback(payload) {
    localStorage.setItem('cafegestion_db', JSON.stringify(payload.db));
    localStorage.setItem('cafegestion_parallel_orders', JSON.stringify(payload.parallelOrders || []));
}

// Data loading cache to prevent reloading on every page navigation
let dataLoaded = false;
let dataLoadPromise = null;

let cart = [];
let cartDiscountType = 'amount'; // 'amount' or 'percent'
let selectedCategory = 'all';
let isReorderMode = false;
let editingCategoryId = null;
let selectedClientId = 'divers';

// ==========================================
// Parallel Orders System
// ==========================================
let parallelOrders = window.parallelOrdersCache || []; // Array of { id, name, cart, clientId }
delete window.parallelOrdersCache; // Clean up cache
let activeOrderIndex = -1; // -1 means main/new order

// Global touch tracking to distinguish scrolling from clicking
let globalTouchMoved = false;
let globalTouchStartX = 0;
let globalTouchStartY = 0;

document.addEventListener('DOMContentLoaded', () => {
    // Apply scroll arrows preference
    const arrowsEnabled = localStorage.getItem('scroll_arrows_enabled') !== 'false';
    if (!arrowsEnabled) {
        document.body.classList.add('hide-scroll-arrows');
    }
});

document.addEventListener('touchstart', (e) => {
    globalTouchStartX = e.touches[0].clientX;
    globalTouchStartY = e.touches[0].clientY;
    globalTouchMoved = false;
}, { passive: true });

document.addEventListener('touchmove', (e) => {
    const moveX = Math.abs(e.touches[0].clientX - globalTouchStartX);
    const moveY = Math.abs(e.touches[0].clientY - globalTouchStartY);
    if (moveX > 10 || moveY > 10) globalTouchMoved = true;
}, { passive: true });

function createParallelOrder() {
    if (cart.length === 0) {
        showToast('Le panier est vide', 'warning');
        return;
    }

    // Automatic Name generation
    const client = getClientById(selectedClientId);
    const finalName = client.id !== 'divers' ? client.name : 'Cmd #' + (parallelOrders.length + 1);

    const orderId = Date.now();
    parallelOrders.push({
        id: orderId,
        name: finalName,
        cart: [...cart],
        clientId: selectedClientId
    });

    // Direct clearing for immediate next order
    cart = [];
    selectedClientId = 'divers';
    activeOrderIndex = -1;
    resetCartDiscount();

    updateCart();
    renderProducts();
    renderParallelOrderTabs();
    initClientSelector();
    saveDataImmediate();
    showToast(`${finalName} mise en attente`, 'success');
}

function switchToParallelOrder(index) {
    // Save current cart if it has items
    if (activeOrderIndex >= 0 && activeOrderIndex < parallelOrders.length) {
        parallelOrders[activeOrderIndex].cart = [...cart];
        parallelOrders[activeOrderIndex].clientId = selectedClientId;
    } else if (activeOrderIndex === -1 && cart.length > 0) {
        // Save current as new parallel order  
        parallelOrders.push({
            id: Date.now(),
            name: 'Cmd #' + (parallelOrders.length + 1),
            cart: [...cart],
            clientId: selectedClientId
        });
    }

    // Load selected order
    if (index >= 0 && index < parallelOrders.length) {
        cart = [...parallelOrders[index].cart];
        selectedClientId = parallelOrders[index].clientId;
        activeOrderIndex = index;
    }
    updateCart();
    renderProducts();
    renderParallelOrderTabs();
    initClientSelector();
    saveDataImmediate();
}

function switchToNewOrder() {
    // Save current cart
    if (activeOrderIndex >= 0 && activeOrderIndex < parallelOrders.length) {
        parallelOrders[activeOrderIndex].cart = [...cart];
        parallelOrders[activeOrderIndex].clientId = selectedClientId;
    }
    cart = [];
    selectedClientId = 'divers';
    activeOrderIndex = -1;
    resetCartDiscount();
    updateCart();
    renderProducts();
    renderParallelOrderTabs();
    initClientSelector();
    saveDataImmediate();
}

function removeParallelOrder(index) {
    if (index < 0 || index >= parallelOrders.length) return;
    const name = parallelOrders[index].name;
    parallelOrders.splice(index, 1);
    if (activeOrderIndex === index) {
        cart = [];
        activeOrderIndex = -1;
        resetCartDiscount();
    } else if (activeOrderIndex > index) {
        activeOrderIndex--;
    }
    updateCart();
    renderProducts();
    renderParallelOrderTabs();
    saveDataImmediate();
    showToast(`${name} supprimée`, 'info');
}

function renderParallelOrderTabs() {
    const container = document.getElementById('parallelOrderTabs');
    if (!container) return;

    let html = '';

    // New order tab
    html += `<button class="parallel-tab ${activeOrderIndex === -1 ? 'active' : ''}" onclick="switchToNewOrder()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Nouvelle
    </button>`;

    // Existing parallel orders
    parallelOrders.forEach((order, idx) => {
        const itemCount = order.cart.reduce((s, i) => s + i.quantity, 0);
        html += `<button class="parallel-tab ${activeOrderIndex === idx ? 'active' : ''}" onclick="switchToParallelOrder(${idx})">
            ${order.name} <span class="parallel-tab-count">${itemCount}</span>
            <span class="parallel-tab-close" onclick="event.stopPropagation(); removeParallelOrder(${idx})">&times;</span>
        </button>`;
    });

    // Hold button (save current to parallel)
    // Removed duplicate top "hold" button — keep only footer one

    container.innerHTML = html;
}

// Debounced save — batches rapid writes into a single localStorage write
let _saveTimeout = null;
function saveData() {
    if (_saveTimeout) clearTimeout(_saveTimeout);
    _saveTimeout = setTimeout(_doSave, 300);
}

// Immediate save for critical operations (checkout, data import)
function saveDataImmediate() {
    if (_saveTimeout) clearTimeout(_saveTimeout);
    _doSave();
}

function _doSave() {
    _saveTimeout = null;
    syncWindowDb();

    const payload = {
        db,
        parallelOrders
    };

    if (shouldUseRemoteDb()) {
        saveRemoteState(payload).catch((error) => {
            console.warn('Sauvegarde SQLite impossible, fallback local:', error.message);
            saveLocalFallback(payload);
        });
    } else {
        saveLocalFallback(payload);
    }

    // Clear current cart storage (we no longer persist active cart between sessions)
    localStorage.removeItem('cafegestion_current_cart');
    localStorage.removeItem('cafegestion_current_client');
}

// Load current cart and client from localStorage (used on page load)
function loadCurrentCartFromStorage() {
    localStorage.removeItem('cafegestion_current_cart');
    localStorage.removeItem('cafegestion_current_client');
    cart = [];
    selectedClientId = 'divers';
    resetCartDiscount();
}

function resetCartDiscount() {
    cartDiscountType = 'amount';
    const discountInput = document.getElementById('cartDiscountInput');
    if (discountInput) {
        discountInput.value = '';
    }
    const label = document.getElementById('cartDiscountLabel');
    const btn = document.getElementById('toggleCartDiscountType');
    if (label && btn) {
        label.textContent = 'Rem. (DA)';
        btn.textContent = '%';
        btn.style.background = 'var(--border)';
        btn.style.color = 'var(--text-dark)';
    }
}

// ==========================================
// Clients
// ==========================================

function initClientSelector() {
    const selector = document.getElementById('clientSelector');
    if (!selector) return;

    if (!db.clients || db.clients.length === 0) {
        db.clients = [{ id: 'divers', name: 'Vente', phone: '-', email: '-' }];
    } else {
        const divers = db.clients.find(c => c.id === 'divers');
        if (divers && (divers.name === 'Passager (Divers)' || divers.name === 'Divers')) {
            divers.name = 'Vente';
        }
    }

    selector.innerHTML = db.clients.map(c =>
        `<option value="${c.id}" ${c.id === selectedClientId ? 'selected' : ''}>👤 ${c.name}</option>`
    ).join('');
    selector.innerHTML = db.clients.map(client =>
        `<option value="${escapeHtml(client.id)}" ${client.id === selectedClientId ? 'selected' : ''}>${escapeHtml(client.name || 'Client')}</option>`
    ).join('');
}

function handleClientChange() {
    const selector = document.getElementById('clientSelector');
    if (!selector) return;
    selectedClientId = selector.value;
    saveData(); // Save client selection to localStorage
}

function openClientModal(clientId = null) {
    const titleEl = document.getElementById('clientModalTitle');
    const nameInput = document.getElementById('clientNameInput');
    const phoneInput = document.getElementById('clientPhoneInput');
    const idInput = document.getElementById('editClientId');

    if (clientId && clientId !== 'divers') {
        const client = db.clients.find(c => c.id === clientId);
        if (client) {
            titleEl.textContent = '✏️ Modifier Client';
            nameInput.value = client.name;
            phoneInput.value = client.phone === '-' ? '' : client.phone;
            idInput.value = client.id;
        }
    } else {
        titleEl.textContent = '👥 Nouveau Client';
        nameInput.value = '';
        phoneInput.value = '';
        idInput.value = '';
    }
    document.getElementById('clientModal').style.display = 'flex';
}

function closeClientModal() {
    document.getElementById('clientModal').style.display = 'none';
}

function saveNewClient() {
    const name = document.getElementById('clientNameInput').value.trim();
    const phone = document.getElementById('clientPhoneInput').value.trim();
    const editId = document.getElementById('editClientId').value;

    if (!name) {
        showToast('Nom requis', 'error');
        return;
    }

    if (editId) {
        const client = db.clients.find(c => c.id === editId);
        if (client) {
            client.name = name;
            client.phone = phone || '-';
        }
        showToast('Client mis à jour', 'success');
    } else {
        const newClient = {
            id: 'client_' + Date.now(),
            name,
            phone: phone || '-',
            email: '-'
        };
        if (!db.clients) db.clients = [];
        db.clients.push(newClient);
        selectedClientId = newClient.id;
        showToast('Client ajouté !', 'success');
    }

    saveData();
    initClientSelector();
    closeClientModal();
}

function editSelectedClient() {
    if (selectedClientId === 'divers') {
        showToast('Impossible de modifier le client passager', 'warning');
        return;
    }
    openClientModal(selectedClientId);
}

function deleteSelectedClient() {
    if (selectedClientId === 'divers') {
        showToast('Impossible de supprimer le client passager', 'warning');
        return;
    }

    const client = getClientById(selectedClientId);

    Swal.fire({
        title: 'Supprimer ce client ?',
        text: `Voulez-vous vraiment supprimer "${client.name}" ?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Oui, supprimer',
        cancelButtonText: 'Annuler',
        confirmButtonColor: '#dc3545'
    }).then((result) => {
        if (result.isConfirmed) {
            db.clients = db.clients.filter(c => c.id !== selectedClientId);
            selectedClientId = 'divers';
            saveData();
            initClientSelector();
            showToast('Client supprimé', 'success');
        }
    });
}

// Data Portability Functions
function exportData() {
    const fullBackup = {
        db,
        parallelOrders,
        users: JSON.parse(localStorage.getItem('cafe_users')),
        branding: {
            logo: localStorage.getItem('cafe_logo'),
            bg: localStorage.getItem('cafe_login_bg')
        },
        theme: localStorage.getItem('cafegestion_theme')
    };

    const dataStr = JSON.stringify(fullBackup, null, 4);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

    const exportFileDefaultName = 'cafegestion_full_backup_' + new Date().toISOString().split('T')[0] + '.json';

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
    showToast('Sauvegarde complète exportée', 'success');
}

function importData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const backup = JSON.parse(e.target.result);

            // Handle both new Full Backup and legacy Database-only backup
            const importedDb = backup.db || backup;

            if (importedDb.categories && importedDb.products) {
                // Restore main DB
                db = importedDb;
                parallelOrders = backup.parallelOrders || [];
                fillDbDefaults();
                syncWindowDb();
                saveDataImmediate();

                // Restore Users if present
                if (backup.users) {
                    localStorage.setItem('cafe_users', JSON.stringify(backup.users));
                }

                // Restore Branding if present
                if (backup.branding) {
                    if (backup.branding.logo) localStorage.setItem('cafe_logo', backup.branding.logo);
                    if (backup.branding.bg) localStorage.setItem('cafe_login_bg', backup.branding.bg);
                }

                // Restore Theme if present
                if (backup.theme) {
                    localStorage.setItem('cafegestion_theme', backup.theme);
                }

                showToast('Sauvegarde restaurée ! Redémarrage...', 'success');
                setTimeout(() => location.reload(), 1500);
            } else {
                showToast('Format de fichier invalide', 'error');
            }
        } catch (err) {
            console.error('Import Error:', err);
            showToast('Erreur lors de la lecture du fichier', 'error');
        }
    };
    reader.readAsText(file);
}

async function loadData() {
    if (dataLoaded) return;

    // Always load current cart from storage first
    loadCurrentCartFromStorage();

    // Priorité 1: LocalStorage (Instant)
    const remoteState = await loadRemoteState();
    if (remoteState) {
        db = { ...db, ...remoteState.db };
        parallelOrders = Array.isArray(remoteState.parallelOrders)
            ? remoteState.parallelOrders
            : [];
        fillDbDefaults();
        initViewOrders();
        dataLoaded = true;
        syncWindowDb();
        console.log('Systeme : Donnees chargees depuis SQLite.');
        return;
    }

    const saved = localStorage.getItem('cafegestion_db');
    if (saved) {
        try {
            const storedData = JSON.parse(saved);
            if (storedData) {
                db = storedData;
                initViewOrders(); // Initialize independent view orders
            } else {
                fillDbDefaults();
            }
            dataLoaded = true;
            syncWindowDb();
            console.log('Systeme : Donnees chargees depuis LocalStorage fallback.');
            return;
        } catch (e) {
            console.error('Erreur lecture LocalStorage:', e);
        }
    }

    // Priorité 2: database.json (Migration/Fallback)
    try {
        console.log('Système : Tentative de récupération depuis database.json...');
        const response = await fetch('data/database.json', { cache: 'no-store' });
        if (response.ok) {
            const fileData = await response.json();
            if (fileData && (fileData.products || fileData.categories)) {
                db = { ...db, ...fileData };
                fillDbDefaults();
                saveDataImmediate();
                dataLoaded = true;
                syncWindowDb();
                console.log('Systeme : Donnees migrees depuis database.json.');
                return;
            }
        }
    } catch (e) {
        console.warn('Fichier database.json non disponible.');
    }

    // Priorité 3: window.initialDb (Dernier recours)
    if (window.initialDb) {
        db = JSON.parse(JSON.stringify(window.initialDb));
        fillDbDefaults();
        saveDataImmediate();
        dataLoaded = true;
        syncWindowDb();
        return;
    }

    initDefaultData();
    syncWindowDb();
    dataLoaded = true;
}

function fillDbDefaults() {
    if (!db.withdrawals) db.withdrawals = [];
    if (!db.components) db.components = window.initialDb?.components || [];
    if (!db.lots) db.lots = [];
    if (!db.recipes) db.recipes = [];
    if (!db.customerOrders) db.customerOrders = [];
    if (!db.clientAccounts) db.clientAccounts = [];
    if (!db.invoices) db.invoices = [];
    if (!db.suppliers) db.suppliers = [];
    if (!db.purchaseOrders) db.purchaseOrders = [];
    if (!db.purchaseInvoices) db.purchaseInvoices = [];
    if (!db.saleReturns) db.saleReturns = [];
    if (!db.purchaseReturns) db.purchaseReturns = [];
    if (!db.categories) db.categories = [];
    if (!db.products) db.products = [];
    ensureSettingsDefaults();

    const savedParallelOrders = !remoteDbAvailable && localStorage.getItem('cafegestion_parallel_orders');
    if (savedParallelOrders) {
        try {
            parallelOrders = JSON.parse(savedParallelOrders);
        } catch (e) {
            parallelOrders = [];
        }
    }
}

// Wrapper pour compatibilité
async function loadDataInternal() {
    return loadData();
}


function ensureSettingsDefaults() {
    const defaults = {
        tva: "",
        contact: "",
        initialCash: 0,
        costCalcMethod: "wavg",
        printerName: "",
        printerFormat: "90mm",
        autoPrint: false,
        openDrawerOnSale: false,
        openDrawerOnWithdrawal: false
    };
    if (!db.settings) {
        db.settings = { ...defaults };
    } else {
        for (const [key, val] of Object.entries(defaults)) {
            if (db.settings[key] === undefined) db.settings[key] = val;
        }
    }
}

function getSettings() {
    ensureSettingsDefaults();
    return db.settings;
}

function initDefaultData() {
    db = {
        categories: [],
        products: [],
        adjustments: [],
        orders: [],
        withdrawals: [],
        components: [],
        lots: [],
        recipes: [],
        customerOrders: [],
        clientAccounts: [],
        invoices: [],
        suppliers: [],
        purchaseOrders: [],
        purchaseInvoices: [],
        saleReturns: [],
        purchaseReturns: [],
        settings: {
            tva: "",
            contact: "",
            initialCash: 0
        }
    };
    saveData();
}

// ==========================================
// Toast Notifications
// ==========================================

function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const icons = {
        success: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
        error: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
        warning: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
        info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'
    };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${icons[type]}</span>
        <span class="toast-message">${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ==========================================
// Utilities
// ==========================================

function formatPrice(price) {
    try {
        const p = parseFloat(price);
        if (isNaN(p)) return '0,0 DA';
        return p.toFixed(1).replace('.', ',') + ' DA';
    } catch (e) {
        return '0,0 DA';
    }
}

function formatPriceNoSymbol(price) {
    try {
        const p = parseFloat(price);
        if (isNaN(p)) return '0,0';
        return p.toFixed(1).replace('.', ',');
    } catch (e) {
        return '0,0';
    }
}


function formatDate(d) {
    return new Date(d).toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatDateShort(d) {
    return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

function getOrderLineNetUnitPrice(item) {
    const quantity = parseFloat(item?.quantity) || 0;
    if (quantity <= 0) return 0;
    const price = parseFloat(item?.price) || 0;
    const discount = parseFloat(item?.itemDiscount) || 0;
    return Math.max(0, ((price * quantity) - discount) / quantity);
}

function getOrderReturnedItems(order) {
    return Array.isArray(order?.returnedItems) ? order.returnedItems : [];
}

function getOrderReturnedQuantity(order, item) {
    const productId = String(item?.productId ?? '');
    return getOrderReturnedItems(order)
        .filter(returned => String(returned.productId ?? '') === productId)
        .reduce((sum, returned) => sum + (parseFloat(returned.quantity) || 0), 0);
}

function getOrderNetQuantity(order, item) {
    const quantity = parseFloat(item?.quantity) || 0;
    return Math.max(0, quantity - getOrderReturnedQuantity(order, item));
}

function getOrderReturnedTotal(order) {
    const explicitTotal = parseFloat(order?.returnTotal);
    if (!isNaN(explicitTotal) && explicitTotal > 0) return explicitTotal;
    return getOrderReturnedItems(order)
        .reduce((sum, returned) => sum + (parseFloat(returned.amount) || 0), 0);
}

function getOrderNetTotal(order) {
    if (!order) return 0;
    if (order.status === 'cancelled') return 0;
    const total = parseFloat(order.total) || 0;
    return Math.max(0, total - getOrderReturnedTotal(order));
}

function getOrderReturnStatus(order) {
    if (!order) return { label: '', tone: '' };
    if (order.status === 'cancelled') return { label: 'Annulee', tone: 'danger' };
    if (order.status === 'returned') return { label: 'Retour complet', tone: 'warning' };
    if (order.status === 'partial_return') return { label: 'Retour partiel', tone: 'warning' };
    return { label: 'Validee', tone: 'success' };
}

function normalizeBarcodeValue(value) {
    return String(value || '').replace(/\s+/g, '').trim().toLowerCase();
}

function getProductBarcode(product) {
    return normalizeBarcodeValue(product?.barcode || product?.code || product?.sku || product?.ean || '');
}

function findProductByBarcode(code) {
    const normalized = normalizeBarcodeValue(code);
    if (!normalized) return null;
    return (db.products || []).find(product => getProductBarcode(product) === normalized) || null;
}

function isBarcodeUsedByAnotherProduct(code, productId = null) {
    const normalized = normalizeBarcodeValue(code);
    if (!normalized) return false;
    return (db.products || []).some(product =>
        String(product.id) !== String(productId) &&
        getProductBarcode(product) === normalized
    );
}

function getStockClass(stock, min) {
    if (stock === 0) return 'stock-out';
    if (stock <= min) return 'stock-low';
    return 'stock-ok';
}

/**
 * Converts a string input with unit (e.g. "500g") to a numeric value in the target unit.
 * Supports weight (g, kg) and volume (ml, cl, L).
 */
function convertQuantity(input, targetUnit) {
    if (input === null || input === undefined || input === '') return 0;

    const str = input.toString().toLowerCase().trim().replace(',', '.');
    const num = parseFloat(str);
    if (isNaN(num)) return 0;

    // Extract unit (e.g. "500g" -> "g", "1.5kg" -> "kg")
    const unitMatch = str.match(/[a-z]+/);
    const unit = unitMatch ? unitMatch[0] : null;

    if (!unit) return num;

    const target = (targetUnit || '').toLowerCase();

    // Weight logic (Base: kg)
    if (target === 'kg') {
        if (unit === 'g') return num / 1000;
        if (unit === 'mg') return num / 1000000;
        if (unit === 'kg') return num;
    }

    // Volume logic (Base: L)
    if (target === 'l' || target === 'litre') {
        if (unit === 'ml') return num / 1000;
        if (unit === 'cl') return num / 100;
        if (unit === 'l') return num;
    }

    // Weight logic (Base: g)
    if (target === 'g') {
        if (unit === 'kg') return num * 1000;
        if (unit === 'g') return num;
    }

    // Default: return numeric part if no conversion logic applies
    return num;
}

function isAboutToExpire(dateStr) {
    if (!dateStr) return false;
    const expiry = new Date(dateStr);
    const now = new Date();
    const diffTime = expiry - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= 7; // Alert if expires in 7 days or less
}

function getStockLabel(stock, min) {
    if (stock === 0) return 'Rupture';
    if (stock <= min) return 'Faible';
    return stock + '';
}

function getCategoryById(id) {
    return db.categories.find(c => String(c.id) === String(id));
}

function getProductById(id) {
    return db.products.find(p => String(p.id) === String(id));
}

function getClientById(id) {
    if (id === 'divers') return { name: 'Vente' };
    if (!db.clients) return { name: 'Vente' };
    return db.clients.find(c => String(c.id) === String(id)) || { name: 'Vente' };
}

// ==========================================
// Finance: factures, soldes, fournisseurs, bons
// ==========================================

const INVOICE_STATUS_LABELS = {
    unpaid: 'Non payee',
    partial: 'Partielle',
    paid: 'Payee',
    cancelled: 'Annulee'
};

const PURCHASE_ORDER_STATUS_LABELS = {
    pending: 'En attente',
    draft: 'Brouillon',
    sent: 'Envoye',
    received: 'Recu',
    cancelled: 'Annule'
};

function ensureFinanceDefaults() {
    if (!Array.isArray(db.clients)) db.clients = [];
    if (!db.clients.some(client => client.id === 'divers')) {
        db.clients.unshift({ id: 'divers', name: 'Vente', phone: '-', email: '-' });
    }
    if (!db.invoices) db.invoices = [];
    if (!db.suppliers) db.suppliers = [];
    if (!db.purchaseOrders) db.purchaseOrders = [];
    if (!db.purchaseInvoices) db.purchaseInvoices = [];
    if (!db.saleReturns) db.saleReturns = [];
    if (!db.purchaseReturns) db.purchaseReturns = [];
}

let financeDirectoryMode = 'clients';

const FINANCE_DEMO_CLIENTS = [
    {
        id: 'demo-client-cafe-gourmand',
        name: 'Cafe Gourmand',
        phone: '0550 24 18 90',
        email: 'contact@cafegourmand.dz',
        address: 'Centre-ville, Bejaia',
        isDemo: true
    },
    {
        id: 'demo-client-boulangerie-bahia',
        name: 'Boulangerie El Bahia',
        phone: '0770 42 31 08',
        email: 'commandes@elbahia.dz',
        address: 'Sidi Ahmed, Bejaia',
        isDemo: true
    },
    {
        id: 'demo-client-hotel-atlas',
        name: 'Hotel Atlas',
        phone: '0560 11 64 22',
        email: 'achats@hotelatlas.dz',
        address: 'Route des Aures, Bejaia',
        isDemo: true
    }
];

const FINANCE_DEMO_SUPPLIERS = [
    {
        id: 'demo-supplier-gouraya',
        name: 'Emballages Gouraya',
        phone: '0551 80 22 14',
        email: 'ventes@gouraya-emballage.dz',
        address: 'Zone industrielle, Bejaia',
        isDemo: true
    },
    {
        id: 'demo-supplier-maison-lait',
        name: 'Maison du Lait Bejaia',
        phone: '0771 36 09 52',
        email: 'contact@maisondulait.dz',
        address: 'Oued Ghir, Bejaia',
        isDemo: true
    },
    {
        id: 'demo-supplier-saveurs',
        name: 'Saveurs du Djurdjura',
        phone: '0561 43 77 20',
        email: 'pro@saveurs-djurdjura.dz',
        address: 'Akbou, Bejaia',
        isDemo: true
    }
];

function addFinanceDemoData(kind = 'all') {
    ensureFinanceDefaults();
    let added = 0;

    if (kind === 'all' || kind === 'clients') {
        FINANCE_DEMO_CLIENTS.forEach(sample => {
            if ((db.clients || []).some(client => String(client.id) === sample.id)) return;
            db.clients.push({ ...sample, createdAt: new Date().toISOString() });
            added += 1;
        });
    }

    if (kind === 'all' || kind === 'suppliers') {
        FINANCE_DEMO_SUPPLIERS.forEach(sample => {
            if ((db.suppliers || []).some(supplier => String(supplier.id) === sample.id)) return;
            db.suppliers.push({ ...sample, createdAt: new Date().toISOString() });
            added += 1;
        });
    }

    if (!added) {
        showToast('Les donnees exemple sont deja presentes', 'info');
        return;
    }

    saveDataImmediate();
    renderFinancePage();
    showToast(`${added} fiche${added > 1 ? 's' : ''} exemple ajoutee${added > 1 ? 's' : ''}`, 'success');
}

function getFinanceInitials(name) {
    return String(name || '?')
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map(part => part.charAt(0).toUpperCase())
        .join('') || '?';
}

function getClientFinanceSummary(clientId) {
    const invoices = (db.invoices || [])
        .filter(invoice => String(invoice.clientId) === String(clientId) && invoice.status !== 'cancelled')
        .map(refreshInvoiceStatus);
    const total = invoices.reduce((sum, invoice) => sum + (parseFloat(invoice.amount) || 0), 0);
    const paid = invoices.reduce((sum, invoice) => sum + getInvoicePaidAmount(invoice), 0);
    const balance = invoices.reduce((sum, invoice) => sum + getInvoiceRemaining(invoice), 0);

    return {
        invoices,
        total,
        paid,
        balance,
        openCount: invoices.filter(invoice => getInvoiceRemaining(invoice) > 0).length
    };
}

function openFinanceModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.style.display = 'flex';
    requestAnimationFrame(() => modal.classList.add('is-open'));
    setTimeout(() => modal.querySelector('input:not([type="hidden"]), select, textarea')?.focus(), 80);
}

function closeFinanceModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.style.display = 'none';
}

function openFinanceEditor(type) {
    if (type === 'client') {
        document.getElementById('financeClientForm')?.reset();
        const editInput = document.getElementById('financeClientEditId');
        if (editInput) editInput.value = '';
        const title = document.getElementById('financeClientModalTitle');
        if (title) title.textContent = 'Nouveau client';
        openFinanceModal('financeClientModal');
        return;
    }

    if (type === 'supplier') {
        document.getElementById('supplierForm')?.reset();
        const editInput = document.getElementById('supplierEditId');
        if (editInput) editInput.value = '';
        const title = document.getElementById('financeSupplierModalTitle');
        if (title) title.textContent = 'Nouveau fournisseur';
        openFinanceModal('financeSupplierModal');
        return;
    }

    if (type === 'invoice') {
        document.getElementById('manualInvoiceForm')?.reset();
        updateFinanceSelects();
        openFinanceModal('financeInvoiceModal');
        return;
    }

    if (type === 'purchaseOrder') {
        document.getElementById('purchaseOrderForm')?.reset();
        updateFinanceSelects();
        openFinanceModal('financePurchaseOrderModal');
    }
}

function switchFinanceDirectory(mode) {
    financeDirectoryMode = mode === 'suppliers' ? 'suppliers' : 'clients';
    const clientsView = document.getElementById('financeClientsView');
    const suppliersView = document.getElementById('financeSuppliersView');
    const clientsTab = document.getElementById('financeClientsTab');
    const suppliersTab = document.getElementById('financeSuppliersTab');
    const searchInput = document.getElementById('financeDirectorySearch');

    if (clientsView) clientsView.hidden = financeDirectoryMode !== 'clients';
    if (suppliersView) suppliersView.hidden = financeDirectoryMode !== 'suppliers';
    clientsTab?.classList.toggle('active', financeDirectoryMode === 'clients');
    suppliersTab?.classList.toggle('active', financeDirectoryMode === 'suppliers');
    clientsTab?.setAttribute('aria-selected', financeDirectoryMode === 'clients' ? 'true' : 'false');
    suppliersTab?.setAttribute('aria-selected', financeDirectoryMode === 'suppliers' ? 'true' : 'false');

    if (searchInput) {
        searchInput.value = '';
        searchInput.placeholder = financeDirectoryMode === 'clients'
            ? 'Rechercher un client...'
            : 'Rechercher un fournisseur...';
        searchInput.focus();
    }

    renderFinanceDirectory();
}

function renderFinanceDirectory() {
    renderClientBalances();
    renderSuppliers();
}

function generateFinanceNumber(prefix, collection, field = 'number') {
    const year = new Date().getFullYear();
    const matcher = new RegExp(`^${prefix}-${year}-(\\d+)$`);
    const maxSeq = (collection || []).reduce((max, item) => {
        const match = String(item[field] || '').match(matcher);
        return match ? Math.max(max, parseInt(match[1], 10) || 0) : max;
    }, 0);
    return `${prefix}-${year}-${String(maxSeq + 1).padStart(4, '0')}`;
}

function getInvoicePaidAmount(invoice) {
    const paymentsTotal = (invoice.payments || []).reduce((sum, payment) => sum + (parseFloat(payment.amount) || 0), 0);
    return Math.min(parseFloat(invoice.amount) || 0, paymentsTotal + (parseFloat(invoice.paidAmount) || 0));
}

function getInvoiceRemaining(invoice) {
    return Math.max(0, (parseFloat(invoice.amount) || 0) - getInvoicePaidAmount(invoice));
}

function refreshInvoiceStatus(invoice) {
    if (!invoice || invoice.status === 'cancelled') return invoice;
    const remaining = getInvoiceRemaining(invoice);
    const paid = getInvoicePaidAmount(invoice);
    invoice.status = remaining <= 0 ? 'paid' : (paid > 0 ? 'partial' : 'unpaid');
    invoice.updatedAt = new Date().toISOString();
    return invoice;
}

function createInvoiceFromSale(order, clientId, options = {}) {
    ensureFinanceDefaults();
    const client = getClientById(clientId);
    const amount = parseFloat(options.amount ?? order.total) || 0;
    if (!clientId || clientId === 'divers' || amount <= 0) return null;

    const invoice = {
        id: `inv-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        number: generateFinanceNumber('FAC', db.invoices),
        clientId,
        clientName: client.name || 'Client',
        title: options.title || `Vente ${order.ticketNum || order.id}`,
        amount,
        paidAmount: 0,
        status: 'unpaid',
        dueDate: options.dueDate || '',
        sourceOrderId: order.id,
        source: options.source || 'sale',
        payments: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    db.invoices.unshift(invoice);
    return invoice;
}

function getClientBalance(clientId) {
    ensureFinanceDefaults();
    return db.invoices
        .filter(invoice => String(invoice.clientId) === String(clientId) && invoice.status !== 'cancelled')
        .reduce((sum, invoice) => sum + getInvoiceRemaining(invoice), 0);
}

function getClientOpenInvoices(clientId) {
    ensureFinanceDefaults();
    return (db.invoices || [])
        .filter(invoice => String(invoice.clientId) === String(clientId) && invoice.status !== 'cancelled')
        .map(refreshInvoiceStatus)
        .filter(invoice => getInvoiceRemaining(invoice) > 0)
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function getPurchaseInvoiceReturnedItems(invoice) {
    return Array.isArray(invoice?.returnedItems) ? invoice.returnedItems : [];
}

function getPurchaseInvoiceReturnTotal(invoice) {
    const explicit = parseFloat(invoice?.returnTotal);
    if (!isNaN(explicit) && explicit > 0) return explicit;
    return getPurchaseInvoiceReturnedItems(invoice)
        .reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
}

function getPurchaseInvoiceNetTotal(invoice) {
    return Math.max(0, (parseFloat(invoice?.total) || 0) - getPurchaseInvoiceReturnTotal(invoice));
}

function getPurchaseInvoicePaidAmount(invoice) {
    const paymentsTotal = (invoice?.payments || [])
        .reduce((sum, payment) => sum + (parseFloat(payment.amount) || 0), 0);
    return Math.min(getPurchaseInvoiceNetTotal(invoice), paymentsTotal + (parseFloat(invoice?.paidAmount) || 0));
}

function getPurchaseInvoiceRemaining(invoice) {
    return Math.max(0, getPurchaseInvoiceNetTotal(invoice) - getPurchaseInvoicePaidAmount(invoice));
}

function getPurchaseInvoicePaymentStatus(invoice) {
    const netTotal = getPurchaseInvoiceNetTotal(invoice);
    if (netTotal <= 0 || invoice?.status === 'returned') return 'paid';
    const paid = getPurchaseInvoicePaidAmount(invoice);
    return getPurchaseInvoiceRemaining(invoice) <= 0 ? 'paid' : (paid > 0 ? 'partial' : 'unpaid');
}

function getSupplierPurchaseInvoices(supplierId, onlyOpen = false) {
    ensureFinanceDefaults();
    return (db.purchaseInvoices || [])
        .filter(invoice => String(invoice.supplierId || '') === String(supplierId))
        .filter(invoice => !onlyOpen || getPurchaseInvoiceRemaining(invoice) > 0)
        .sort((a, b) => new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0));
}

function getSupplierBalance(supplierId) {
    return getSupplierPurchaseInvoices(supplierId)
        .reduce((sum, invoice) => sum + getPurchaseInvoiceRemaining(invoice), 0);
}

function getSupplierFinanceSummary(supplierId) {
    const invoices = getSupplierPurchaseInvoices(supplierId);
    const openInvoices = invoices.filter(invoice => getPurchaseInvoiceRemaining(invoice) > 0);
    return {
        invoices,
        openInvoices,
        total: invoices.reduce((sum, invoice) => sum + getPurchaseInvoiceNetTotal(invoice), 0),
        paid: invoices.reduce((sum, invoice) => sum + getPurchaseInvoicePaidAmount(invoice), 0),
        returns: invoices.reduce((sum, invoice) => sum + getPurchaseInvoiceReturnTotal(invoice), 0),
        balance: openInvoices.reduce((sum, invoice) => sum + getPurchaseInvoiceRemaining(invoice), 0)
    };
}

function getFinanceKpis() {
    ensureFinanceDefaults();
    const activeInvoices = db.invoices.filter(invoice => invoice.status !== 'cancelled');
    const unpaidInvoices = activeInvoices.filter(invoice => getInvoiceRemaining(invoice) > 0);
    const clientBalances = (db.clients || [])
        .filter(client => client.id !== 'divers')
        .map(client => ({ client, balance: getClientBalance(client.id) }))
        .filter(item => item.balance > 0);

    return {
        totalReceivable: unpaidInvoices.reduce((sum, invoice) => sum + getInvoiceRemaining(invoice), 0),
        unpaidCount: unpaidInvoices.length,
        clientsWithBalance: clientBalances.length,
        totalSupplierPayable: (db.suppliers || []).reduce((sum, supplier) => sum + getSupplierBalance(supplier.id), 0),
        purchaseOrdersOpen: (db.purchaseOrders || []).filter(order => !['received', 'cancelled'].includes(order.status)).length
    };
}

function updateFinanceSelects() {
    const clientOptions = (db.clients || [])
        .filter(client => client.id !== 'divers')
        .map(client => `<option value="${client.id}">${escapeHtml(client.name)}${client.phone && client.phone !== '-' ? ' - ' + escapeHtml(client.phone) : ''}</option>`)
        .join('');
    const supplierOptions = (db.suppliers || [])
        .map(supplier => `<option value="${supplier.id}">${escapeHtml(supplier.name)}</option>`)
        .join('');

    document.querySelectorAll('[data-finance-client-select]').forEach(select => {
        select.innerHTML = clientOptions || '<option value="">Aucun client</option>';
    });
    document.querySelectorAll('[data-finance-supplier-select]').forEach(select => {
        select.innerHTML = supplierOptions || '<option value="">Aucun fournisseur</option>';
    });
}

function renderFinanceStats() {
    const kpis = getFinanceKpis();
    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };
    setText('financeTotalReceivable', formatPrice(kpis.totalReceivable));
    setText('financeUnpaidInvoices', kpis.unpaidCount);
    setText('financeClientsWithBalance', kpis.clientsWithBalance);
    setText('financeSupplierPayable', formatPrice(kpis.totalSupplierPayable));
    setText('financeOpenPurchaseOrders', kpis.purchaseOrdersOpen);
}

function renderClientBalances() {
    const container = document.getElementById('financeClientBalances');
    if (!container) return;
    const allClients = (db.clients || [])
        .filter(client => client.id !== 'divers')
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    const count = document.getElementById('financeClientsCount');
    if (count) count.textContent = allClients.length;

    const search = (document.getElementById('financeDirectorySearch')?.value || '').trim().toLowerCase();
    const clients = search
        ? allClients.filter(client => `${client.name || ''} ${client.phone || ''} ${client.email || ''} ${client.address || ''}`.toLowerCase().includes(search))
        : allClients;

    if (!allClients.length) {
        container.innerHTML = `
            <div class="finance-empty finance-empty-action">
                <strong>Aucun client enregistre</strong>
                <span>Ajoutez votre premier client ou chargez quelques fiches de demonstration.</span>
                <div>
                    <button class="btn btn-primary" type="button" onclick="openFinanceEditor('client')">Nouveau client</button>
                    <button class="btn btn-outline" type="button" onclick="addFinanceDemoData('clients')">Ajouter des exemples</button>
                </div>
            </div>
        `;
        return;
    }

    if (!clients.length) {
        container.innerHTML = '<div class="finance-empty">Aucun client ne correspond a cette recherche.</div>';
        return;
    }

    container.innerHTML = `
        <div class="finance-table-wrap finance-directory-table-wrap">
            <table class="finance-public-table">
                <thead>
                    <tr>
                        <th>Client</th>
                        <th>Contact</th>
                        <th>Factures</th>
                        <th>Total facture</th>
                        <th>Paye</th>
                        <th>Solde</th>
                        <th>Statut</th>
                        <th class="finance-actions-column">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${clients.map(client => {
        const summary = getClientFinanceSummary(client.id);
        const hasBalance = summary.balance > 0.001;
        return `
                        <tr>
                            <td>
                                <div class="finance-contact-cell">
                                    <span class="finance-contact-avatar client">${escapeHtml(getFinanceInitials(client.name))}</span>
                                    <div>
                                        <strong>${escapeHtml(client.name || 'Client')}</strong>
                                        <span>${escapeHtml(client.address || 'Adresse non renseignee')}</span>
                                        ${client.isDemo ? '<em class="finance-demo-chip">Exemple</em>' : ''}
                                    </div>
                                </div>
                            </td>
                            <td>
                                <strong class="finance-contact-phone">${escapeHtml(client.phone || '-')}</strong>
                                <span>${escapeHtml(client.email || 'Email non renseigne')}</span>
                            </td>
                            <td><strong>${summary.invoices.length}</strong><span>${summary.openCount} ouverte${summary.openCount > 1 ? 's' : ''}</span></td>
                            <td>${formatPrice(summary.total)}</td>
                            <td>${formatPrice(summary.paid)}</td>
                            <td><span class="finance-table-amount ${hasBalance ? 'danger' : 'ok'}">${hasBalance ? formatPrice(summary.balance) : 'Solde OK'}</span></td>
                            <td><span class="finance-row-status ${hasBalance ? 'is-due' : 'is-ok'}">${hasBalance ? 'A regler' : 'A jour'}</span></td>
                            <td class="finance-actions-cell">
                                <div class="finance-table-actions">
                                    <button class="btn btn-sm btn-primary" type="button" onclick="showClientStatement('${escapeHtml(client.id)}')">Voir l'etat</button>
                                    <button class="finance-icon-button" type="button" onclick="editFinanceClient('${escapeHtml(client.id)}')" title="Modifier le client" aria-label="Modifier le client">
                                        <svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                                    </button>
                                    <button class="finance-icon-button danger" type="button" onclick="deleteFinanceClient('${escapeHtml(client.id)}')" title="Supprimer le client" aria-label="Supprimer le client">
                                        <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"/></svg>
                                    </button>
                                </div>
                            </td>
                        </tr>
                    `;
    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderInvoices() {
    const container = document.getElementById('financeInvoicesList');
    if (!container) return;
    const statusFilter = document.getElementById('financeInvoiceFilter')?.value || 'open';
    const search = (document.getElementById('financeInvoiceSearch')?.value || '').trim().toLowerCase();

    let invoices = [...(db.invoices || [])].map(refreshInvoiceStatus);
    if (statusFilter === 'open') invoices = invoices.filter(invoice => getInvoiceRemaining(invoice) > 0 && invoice.status !== 'cancelled');
    else if (statusFilter !== 'all') invoices = invoices.filter(invoice => invoice.status === statusFilter);

    if (search) {
        invoices = invoices.filter(invoice => {
            const haystack = `${invoice.number} ${invoice.clientName} ${invoice.title}`.toLowerCase();
            return haystack.includes(search);
        });
    }

    invoices.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    if (!invoices.length) {
        container.innerHTML = '<div class="finance-empty">Aucune facture dans cette vue.</div>';
        return;
    }

    container.innerHTML = `
        <div class="finance-table-wrap">
            <table class="finance-public-table finance-records-table">
                <thead>
                    <tr>
                        <th>Facture</th>
                        <th>Client</th>
                        <th>Total</th>
                        <th>Paye</th>
                        <th>Reste</th>
                        <th>Statut</th>
                        <th class="finance-actions-column">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${invoices.map(invoice => {
        const remaining = getInvoiceRemaining(invoice);
        const paid = getInvoicePaidAmount(invoice);
        const canPay = remaining > 0 && invoice.status !== 'cancelled';
        return `
                            <tr>
                                <td>
                                    <strong class="finance-code">${escapeHtml(invoice.number || 'Facture')}</strong>
                                    <span>${escapeHtml(invoice.title || 'Facture client')}</span>
                                </td>
                                <td>
                                    <strong>${escapeHtml(invoice.clientName || getClientById(invoice.clientId).name)}</strong>
                                    <span>${invoice.dueDate ? 'Echeance ' + escapeHtml(invoice.dueDate) : 'Sans echeance'}</span>
                                </td>
                                <td><strong>${formatPrice(invoice.amount)}</strong></td>
                                <td>${formatPrice(paid)}</td>
                                <td><span class="finance-table-amount ${remaining > 0 ? 'danger' : 'ok'}">${remaining > 0 ? formatPrice(remaining) : 'Soldee'}</span></td>
                                <td><span class="finance-row-status status-${invoice.status}">${INVOICE_STATUS_LABELS[invoice.status] || invoice.status}</span></td>
                                <td class="finance-actions-cell">
                                    <div class="finance-table-actions">
                                        <button class="btn btn-sm btn-primary" type="button" onclick="recordInvoicePayment('${invoice.id}')" ${canPay ? '' : 'disabled'}>Encaisser</button>
                                        <button class="finance-icon-button" type="button" onclick="printInvoice('${invoice.id}')" title="Imprimer la facture" aria-label="Imprimer la facture">
                                            <svg viewBox="0 0 24 24"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z"/></svg>
                                        </button>
                                        <details class="finance-action-menu">
                                            <summary title="Plus d'actions" aria-label="Plus d'actions">
                                                <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>
                                            </summary>
                                            <div class="finance-action-popover">
                                                <button type="button" onclick="payInvoiceInFull('${invoice.id}')" ${canPay ? '' : 'disabled'}>Solder la facture</button>
                                                <button class="danger" type="button" onclick="cancelInvoice('${invoice.id}')" ${invoice.status === 'cancelled' ? 'disabled' : ''}>Annuler la facture</button>
                                            </div>
                                        </details>
                                    </div>
                                </td>
                            </tr>
                        `;
    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function createManualInvoice(event) {
    event.preventDefault();
    ensureFinanceDefaults();
    const clientId = document.getElementById('invoiceClientId')?.value;
    const title = (document.getElementById('invoiceTitle')?.value || '').trim();
    const amount = parseFloat((document.getElementById('invoiceAmount')?.value || '').replace(',', '.')) || 0;
    const dueDate = document.getElementById('invoiceDueDate')?.value || '';

    if (!clientId || amount <= 0) {
        showToast('Client et montant obligatoires', 'warning');
        return;
    }

    const invoice = createInvoiceFromSale({ id: `manual-${Date.now()}`, total: amount, ticketNum: 'manuel' }, clientId, {
        title: title || 'Facture manuelle',
        dueDate,
        source: 'manual'
    });
    if (!invoice) {
        showToast('Impossible de creer la facture', 'error');
        return;
    }

    event.target.reset();
    closeFinanceModal('financeInvoiceModal');
    saveDataImmediate();
    renderFinancePage();
    showToast('Facture creee', 'success');
}

function recordInvoicePayment(invoiceId, forcedAmount = null) {
    const invoice = (db.invoices || []).find(item => item.id === invoiceId);
    if (!invoice) return;
    const remaining = getInvoiceRemaining(invoice);
    const value = forcedAmount !== null ? forcedAmount : prompt(`Montant encaisse pour ${invoice.number}`, remaining.toFixed(1));
    const amount = parseFloat(String(value || '').replace(',', '.')) || 0;
    if (amount <= 0) return;
    if (amount > remaining) {
        showToast('Montant superieur au reste a payer', 'warning');
        return;
    }

    if (!Array.isArray(invoice.payments)) invoice.payments = [];
    invoice.payments.push({
        id: `pay-${Date.now()}`,
        amount,
        date: new Date().toISOString()
    });
    refreshInvoiceStatus(invoice);
    saveDataImmediate();
    renderFinancePage();
    showToast('Paiement enregistre', 'success');
}

function payInvoiceInFull(invoiceId) {
    const invoice = (db.invoices || []).find(item => item.id === invoiceId);
    if (!invoice) return;
    recordInvoicePayment(invoiceId, getInvoiceRemaining(invoice));
}

function cancelInvoice(invoiceId) {
    const invoice = (db.invoices || []).find(item => item.id === invoiceId);
    if (!invoice || !confirm('Annuler cette facture ?')) return;
    invoice.status = 'cancelled';
    invoice.updatedAt = new Date().toISOString();
    saveDataImmediate();
    renderFinancePage();
    showToast('Facture annulee', 'info');
}

function printInvoice(invoiceId) {
    const invoice = (db.invoices || []).find(item => item.id === invoiceId);
    if (!invoice) return;
    const client = getClientById(invoice.clientId);
    const remaining = getInvoiceRemaining(invoice);
    const html = `
        <h1>Facture ${escapeHtml(invoice.number)}</h1>
        <p><strong>Client:</strong> ${escapeHtml(client.name || invoice.clientName || '-')}</p>
        <p><strong>Telephone:</strong> ${escapeHtml(client.phone || '-')}</p>
        <hr>
        <h2>${escapeHtml(invoice.title || 'Facture')}</h2>
        <p>Total: <strong>${formatPrice(invoice.amount)}</strong></p>
        <p>Paye: <strong>${formatPrice(getInvoicePaidAmount(invoice))}</strong></p>
        <p>Reste: <strong>${formatPrice(remaining)}</strong></p>
        <p>Statut: ${INVOICE_STATUS_LABELS[invoice.status] || invoice.status}</p>
    `;
    printFinanceDocument(`Facture ${invoice.number}`, html);
}

function openFinanceStatementModal(title, summaryHtml, rowsHtml) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content finance-statement-modal">
            <div class="modal-header">
                <h3>${escapeHtml(title)}</h3>
                <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            </div>
            <div class="modal-body">
                ${summaryHtml}
                <div class="finance-statement-list">${rowsHtml}</div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="this.closest('.modal-overlay').remove()">Fermer</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function showClientStatement(clientId) {
    const client = getClientById(clientId);
    const invoices = (db.invoices || [])
        .filter(invoice => String(invoice.clientId) === String(clientId) && invoice.status !== 'cancelled')
        .map(refreshInvoiceStatus)
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const balance = getClientBalance(clientId);
    const paidTotal = invoices.reduce((sum, invoice) => sum + getInvoicePaidAmount(invoice), 0);
    const amountTotal = invoices.reduce((sum, invoice) => sum + (parseFloat(invoice.amount) || 0), 0);
    const summary = `
        <div class="finance-statement-summary">
            <div><span>Total facture</span><strong>${formatPrice(amountTotal)}</strong></div>
            <div><span>Paye</span><strong>${formatPrice(paidTotal)}</strong></div>
            <div><span>Solde</span><strong>${formatPrice(balance)}</strong></div>
        </div>
    `;
    const rows = invoices.length ? invoices.map(invoice => {
        const remaining = getInvoiceRemaining(invoice);
        return `
        <article class="finance-card status-${invoice.status}">
            <div class="finance-card-head">
                <div>
                    <span class="finance-code">${escapeHtml(invoice.number)}</span>
                    <h3>${escapeHtml(invoice.title || 'Facture')}</h3>
                    <p>${escapeHtml(invoice.dueDate || invoice.createdAt || '-')}</p>
                </div>
                <span class="finance-status">${INVOICE_STATUS_LABELS[invoice.status] || invoice.status}</span>
            </div>
            <div class="finance-amount-grid">
                <div><span>Total</span><strong>${formatPrice(invoice.amount)}</strong></div>
                <div><span>Paye</span><strong>${formatPrice(getInvoicePaidAmount(invoice))}</strong></div>
                <div><span>Reste</span><strong>${formatPrice(remaining)}</strong></div>
            </div>
            <div class="finance-actions">
                <button class="btn btn-sm btn-primary" onclick="recordInvoicePayment('${invoice.id}'); this.closest('.modal-overlay')?.remove();" ${remaining <= 0 ? 'disabled' : ''}>Encaisser</button>
                <button class="btn btn-sm btn-outline" onclick="payInvoiceInFull('${invoice.id}'); this.closest('.modal-overlay')?.remove();" ${remaining <= 0 ? 'disabled' : ''}>Solder</button>
                <button class="btn btn-sm btn-outline" onclick="printInvoice('${invoice.id}')">Imprimer</button>
            </div>
        </article>
    `;
    }).join('') : '<div class="finance-empty">Aucune facture pour ce client.</div>';

    openFinanceStatementModal(`Etat client - ${client.name || 'Client'}`, summary, rows);
}

function recordPurchaseInvoicePayment(invoiceId, forcedAmount = null) {
    const invoice = (db.purchaseInvoices || []).find(item => String(item.id) === String(invoiceId));
    if (!invoice) return;
    const remaining = getPurchaseInvoiceRemaining(invoice);
    if (remaining <= 0) {
        showToast('Facture fournisseur deja soldee', 'info');
        return;
    }

    const value = forcedAmount !== null ? forcedAmount : prompt(`Montant paye pour ${invoice.number || 'facture fournisseur'}`, remaining.toFixed(1));
    const amount = parseFloat(String(value || '').replace(',', '.')) || 0;
    if (amount <= 0) return;
    if (amount > remaining) {
        showToast('Montant superieur au reste fournisseur', 'warning');
        return;
    }

    if (!Array.isArray(invoice.payments)) invoice.payments = [];
    invoice.payments.push({
        id: `ppay-${Date.now()}`,
        amount,
        date: new Date().toISOString()
    });
    invoice.paymentStatus = getPurchaseInvoicePaymentStatus(invoice);
    invoice.updatedAt = new Date().toISOString();
    saveDataImmediate();
    renderFinancePage();
    showToast('Paiement fournisseur enregistre', 'success');
}

function payPurchaseInvoiceInFull(invoiceId) {
    const invoice = (db.purchaseInvoices || []).find(item => String(item.id) === String(invoiceId));
    if (!invoice) return;
    recordPurchaseInvoicePayment(invoiceId, getPurchaseInvoiceRemaining(invoice));
}

function paySupplierOldestInvoice(supplierId) {
    const invoice = getSupplierPurchaseInvoices(supplierId, true)
        .sort((a, b) => new Date(a.createdAt || a.date || 0) - new Date(b.createdAt || b.date || 0))[0];
    if (!invoice) {
        showToast('Aucune facture fournisseur ouverte', 'info');
        return;
    }
    recordPurchaseInvoicePayment(invoice.id);
}

function printPurchaseInvoiceFinance(invoice) {
    if (!invoice) return;
    const rows = (invoice.items || []).map(line => `
        <tr>
            <td>${escapeHtml(line.name || 'Article')}</td>
            <td>${line.type === 'product' ? 'Produit' : 'Composant'}</td>
            <td>${line.quantity || 0} ${escapeHtml(line.unit || '')}</td>
            <td>${formatPrice(line.unitPrice || 0)}</td>
            <td>${formatPrice(line.totalPrice || line.total || 0)}</td>
        </tr>
    `).join('');
    const html = `
        <h1>Facture d'achat ${escapeHtml(invoice.number || '')}</h1>
        <p><strong>Fournisseur:</strong> ${escapeHtml(invoice.supplierName || '-')}</p>
        <p><strong>Date:</strong> ${escapeHtml(invoice.date || '-')}</p>
        <table><thead><tr><th>Article</th><th>Type</th><th>Qte</th><th>PU</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>
        <h2>Total net: ${formatPrice(getPurchaseInvoiceNetTotal(invoice))}</h2>
        <p>Retours: ${formatPrice(getPurchaseInvoiceReturnTotal(invoice))}</p>
        <p>Paye: ${formatPrice(getPurchaseInvoicePaidAmount(invoice))}</p>
        <p>Reste: ${formatPrice(getPurchaseInvoiceRemaining(invoice))}</p>
    `;
    printFinanceDocument(`Facture achat ${invoice.number || ''}`, html);
}

function printStoredPurchaseInvoice(invoiceId) {
    const invoice = (db.purchaseInvoices || []).find(item => String(item.id) === String(invoiceId));
    if (!invoice) {
        showToast('Facture fournisseur introuvable', 'error');
        return;
    }
    printPurchaseInvoiceFinance(invoice);
}

function showSupplierStatement(supplierId) {
    const supplier = (db.suppliers || []).find(item => String(item.id) === String(supplierId));
    if (!supplier) return;
    const summaryData = getSupplierFinanceSummary(supplierId);
    const invoices = summaryData.invoices;
    const summary = `
        <div class="finance-statement-summary">
            <div><span>Total achats net</span><strong>${formatPrice(summaryData.total)}</strong></div>
            <div><span>Paye</span><strong>${formatPrice(summaryData.paid)}</strong></div>
            <div><span>Retours</span><strong>${formatPrice(summaryData.returns)}</strong></div>
            <div><span>Solde</span><strong>${formatPrice(summaryData.balance)}</strong></div>
        </div>
    `;
    const rows = invoices.length ? invoices.map(invoice => {
        const payStatus = getPurchaseInvoicePaymentStatus(invoice);
        const returnLabel = invoice.status === 'returned' ? 'Retour complet' : (invoice.status === 'partial_return' ? 'Retour partiel' : '');
        return `
            <article class="finance-card status-${payStatus}">
                <div class="finance-card-head">
                    <div>
                        <span class="finance-code">${escapeHtml(invoice.number || 'Facture achat')}</span>
                        <h3>${escapeHtml(invoice.date || invoice.createdAt || '-')}</h3>
                        <p>${(invoice.items || []).length} article${(invoice.items || []).length > 1 ? 's' : ''}${returnLabel ? ' - ' + returnLabel : ''}</p>
                    </div>
                    <span class="finance-status">${INVOICE_STATUS_LABELS[payStatus] || payStatus}</span>
                </div>
                <div class="finance-amount-grid">
                    <div><span>Total net</span><strong>${formatPrice(getPurchaseInvoiceNetTotal(invoice))}</strong></div>
                    <div><span>Paye</span><strong>${formatPrice(getPurchaseInvoicePaidAmount(invoice))}</strong></div>
                    <div><span>Reste</span><strong>${formatPrice(getPurchaseInvoiceRemaining(invoice))}</strong></div>
                </div>
                <div class="finance-actions">
                    <button class="btn btn-sm btn-primary" onclick="recordPurchaseInvoicePayment('${invoice.id}'); this.closest('.modal-overlay')?.remove();" ${getPurchaseInvoiceRemaining(invoice) <= 0 ? 'disabled' : ''}>Payer</button>
                    <button class="btn btn-sm btn-outline" onclick="payPurchaseInvoiceInFull('${invoice.id}'); this.closest('.modal-overlay')?.remove();" ${getPurchaseInvoiceRemaining(invoice) <= 0 ? 'disabled' : ''}>Solder</button>
                    <button class="btn btn-sm btn-outline" onclick="printStoredPurchaseInvoice('${invoice.id}')">Imprimer</button>
                </div>
            </article>
        `;
    }).join('') : '<div class="finance-empty">Aucune facture fournisseur.</div>';

    openFinanceStatementModal(`Etat fournisseur - ${supplier.name}`, summary, rows);
}

function renderSuppliers() {
    const container = document.getElementById('financeSuppliersList');
    if (!container) return;
    const allSuppliers = [...(db.suppliers || [])].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    const count = document.getElementById('financeSuppliersCount');
    if (count) count.textContent = allSuppliers.length;
    const search = (document.getElementById('financeDirectorySearch')?.value || '').trim().toLowerCase();
    const suppliers = search
        ? allSuppliers.filter(supplier => `${supplier.name || ''} ${supplier.phone || ''} ${supplier.email || ''} ${supplier.address || ''}`.toLowerCase().includes(search))
        : allSuppliers;

    if (!allSuppliers.length) {
        container.innerHTML = `
            <div class="finance-empty finance-empty-action">
                <strong>Aucun fournisseur enregistre</strong>
                <span>Ajoutez un fournisseur ou chargez quelques fiches de demonstration.</span>
                <div>
                    <button class="btn btn-primary" type="button" onclick="openFinanceEditor('supplier')">Nouveau fournisseur</button>
                    <button class="btn btn-outline" type="button" onclick="addFinanceDemoData('suppliers')">Ajouter des exemples</button>
                </div>
            </div>
        `;
        return;
    }

    if (!suppliers.length) {
        container.innerHTML = '<div class="finance-empty">Aucun fournisseur ne correspond a cette recherche.</div>';
        return;
    }

    container.innerHTML = `
        <div class="finance-table-wrap finance-directory-table-wrap">
            <table class="finance-public-table">
                <thead>
                    <tr>
                        <th>Fournisseur</th>
                        <th>Contact</th>
                        <th>Factures</th>
                        <th>Total achats</th>
                        <th>Retours</th>
                        <th>Reste</th>
                        <th>Statut</th>
                        <th class="finance-actions-column">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${suppliers.map(supplier => {
        const summary = getSupplierFinanceSummary(supplier.id);
        const hasBalance = summary.balance > 0.001;
        return `
                            <tr>
                                <td>
                                    <div class="finance-contact-cell">
                                        <span class="finance-contact-avatar supplier">${escapeHtml(getFinanceInitials(supplier.name))}</span>
                                        <div>
                                            <strong>${escapeHtml(supplier.name || 'Fournisseur')}</strong>
                                            <span>${escapeHtml(supplier.address || 'Adresse non renseignee')}</span>
                                            ${supplier.isDemo ? '<em class="finance-demo-chip">Exemple</em>' : ''}
                                        </div>
                                    </div>
                                </td>
                                <td><strong class="finance-contact-phone">${escapeHtml(supplier.phone || '-')}</strong><span>${escapeHtml(supplier.email || 'Email non renseigne')}</span></td>
                                <td><strong>${summary.invoices.length}</strong><span>facture${summary.invoices.length > 1 ? 's' : ''} d'achat</span></td>
                                <td>${formatPrice(summary.total)}</td>
                                <td>${formatPrice(summary.returns)}</td>
                                <td><span class="finance-table-amount ${hasBalance ? 'danger' : 'ok'}">${hasBalance ? formatPrice(summary.balance) : 'Solde OK'}</span></td>
                                <td><span class="finance-row-status ${hasBalance ? 'is-due' : 'is-ok'}">${hasBalance ? 'A payer' : 'A jour'}</span></td>
                                <td class="finance-actions-cell">
                                    <div class="finance-table-actions">
                                        <button class="btn btn-sm btn-primary" type="button" onclick="showSupplierStatement('${supplier.id}')">Voir l'etat</button>
                                        <button class="btn btn-sm btn-outline" type="button" onclick="paySupplierOldestInvoice('${supplier.id}')" ${hasBalance ? '' : 'disabled'}>Payer</button>
                                        <details class="finance-action-menu">
                                            <summary title="Plus d'actions" aria-label="Plus d'actions">
                                                <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>
                                            </summary>
                                            <div class="finance-action-popover">
                                                <button type="button" onclick="editSupplier('${supplier.id}')">Modifier</button>
                                                <button class="danger" type="button" onclick="deleteSupplier('${supplier.id}')">Supprimer</button>
                                            </div>
                                        </details>
                                    </div>
                                </td>
                            </tr>
    `;
    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function saveFinanceClient(event) {
    event.preventDefault();
    ensureFinanceDefaults();
    const id = document.getElementById('financeClientEditId')?.value || '';
    const name = (document.getElementById('financeClientName')?.value || '').trim();
    const phone = (document.getElementById('financeClientPhone')?.value || '').trim();
    const email = (document.getElementById('financeClientEmail')?.value || '').trim();
    const address = (document.getElementById('financeClientAddress')?.value || '').trim();

    if (!name) {
        showToast('Nom du client obligatoire', 'warning');
        return;
    }

    const duplicate = (db.clients || []).find(client =>
        String(client.id) !== String(id)
        && phone
        && phone !== '-'
        && normalizeCustomerPhone(client.phone) === normalizeCustomerPhone(phone)
    );
    if (duplicate) {
        showToast(`Ce telephone est deja utilise par ${duplicate.name}`, 'warning');
        return;
    }

    const data = {
        name,
        phone: phone || '-',
        email: email || '-',
        address,
        updatedAt: new Date().toISOString()
    };

    if (id) {
        const client = db.clients.find(item => String(item.id) === String(id));
        if (client) Object.assign(client, data, { isDemo: false });
    } else {
        db.clients.push({
            id: `client-${Date.now()}`,
            ...data,
            createdAt: new Date().toISOString()
        });
    }

    event.target.reset();
    closeFinanceModal('financeClientModal');
    saveDataImmediate();
    renderFinancePage();
    showToast(id ? 'Client mis a jour' : 'Client ajoute', 'success');
}

function editFinanceClient(clientId) {
    const client = (db.clients || []).find(item => String(item.id) === String(clientId));
    if (!client || client.id === 'divers') return;
    document.getElementById('financeClientEditId').value = client.id;
    document.getElementById('financeClientName').value = client.name || '';
    document.getElementById('financeClientPhone').value = client.phone === '-' ? '' : (client.phone || '');
    document.getElementById('financeClientEmail').value = client.email === '-' ? '' : (client.email || '');
    document.getElementById('financeClientAddress').value = client.address || '';
    const title = document.getElementById('financeClientModalTitle');
    if (title) title.textContent = 'Modifier le client';
    openFinanceModal('financeClientModal');
}

function deleteFinanceClient(clientId) {
    const client = (db.clients || []).find(item => String(item.id) === String(clientId));
    if (!client || client.id === 'divers') return;
    const hasHistory = (db.invoices || []).some(invoice => String(invoice.clientId) === String(clientId))
        || (db.orders || []).some(order => String(order.clientId) === String(clientId))
        || (db.customerOrders || []).some(order => String(order.clientId || order.accountId) === String(clientId));

    if (hasHistory) {
        showToast('Ce client possede un historique. Modifiez sa fiche au lieu de la supprimer.', 'warning');
        return;
    }
    if (!confirm(`Supprimer le client ${client.name} ?`)) return;

    db.clients = db.clients.filter(item => String(item.id) !== String(clientId));
    saveDataImmediate();
    renderFinancePage();
    showToast('Client supprime', 'info');
}

function saveSupplier(event) {
    event.preventDefault();
    ensureFinanceDefaults();
    const id = document.getElementById('supplierEditId')?.value || '';
    const name = (document.getElementById('supplierName')?.value || '').trim();
    if (!name) {
        showToast('Nom fournisseur obligatoire', 'warning');
        return;
    }

    const data = {
        name,
        phone: (document.getElementById('supplierPhone')?.value || '').trim(),
        email: (document.getElementById('supplierEmail')?.value || '').trim(),
        address: (document.getElementById('supplierAddress')?.value || '').trim(),
        updatedAt: new Date().toISOString()
    };

    if (id) {
        const supplier = db.suppliers.find(item => item.id === id);
        if (supplier) Object.assign(supplier, data, { isDemo: false });
    } else {
        db.suppliers.push({
            id: `sup-${Date.now()}`,
            ...data,
            createdAt: new Date().toISOString()
        });
    }

    event.target.reset();
    const editInput = document.getElementById('supplierEditId');
    if (editInput) editInput.value = '';
    closeFinanceModal('financeSupplierModal');
    saveDataImmediate();
    renderFinancePage();
    showToast(id ? 'Fournisseur mis a jour' : 'Fournisseur ajoute', 'success');
}

function editSupplier(supplierId) {
    const supplier = (db.suppliers || []).find(item => item.id === supplierId);
    if (!supplier) return;
    document.getElementById('supplierEditId').value = supplier.id;
    document.getElementById('supplierName').value = supplier.name || '';
    document.getElementById('supplierPhone').value = supplier.phone || '';
    document.getElementById('supplierEmail').value = supplier.email || '';
    document.getElementById('supplierAddress').value = supplier.address || '';
    const title = document.getElementById('financeSupplierModalTitle');
    if (title) title.textContent = 'Modifier le fournisseur';
    openFinanceModal('financeSupplierModal');
}

function deleteSupplier(supplierId) {
    const supplier = (db.suppliers || []).find(item => String(item.id) === String(supplierId));
    if (!supplier) return;
    const hasHistory = (db.purchaseInvoices || []).some(invoice => String(invoice.supplierId) === String(supplierId))
        || (db.purchaseOrders || []).some(order => String(order.supplierId) === String(supplierId));
    if (hasHistory) {
        showToast('Ce fournisseur possede un historique. Modifiez sa fiche au lieu de la supprimer.', 'warning');
        return;
    }
    if (!confirm(`Supprimer le fournisseur ${supplier.name} ?`)) return;
    db.suppliers = (db.suppliers || []).filter(item => String(item.id) !== String(supplierId));
    saveDataImmediate();
    renderFinancePage();
    showToast('Fournisseur supprime', 'info');
}

function parsePurchaseOrderItems(rawText) {
    return String(rawText || '').split(/\n+/).map(line => {
        const parts = line.split(';').map(part => part.trim());
        if (!parts[0]) return null;
        const quantity = parseFloat((parts[1] || '1').replace(',', '.')) || 1;
        const price = parseFloat((parts[2] || '0').replace(',', '.')) || 0;
        return {
            name: parts[0],
            quantity,
            price,
            total: quantity * price
        };
    }).filter(Boolean);
}

function createPurchaseOrder(event) {
    event.preventDefault();
    ensureFinanceDefaults();
    const supplierId = document.getElementById('purchaseOrderSupplierId')?.value;
    const supplier = (db.suppliers || []).find(item => item.id === supplierId);
    const title = (document.getElementById('purchaseOrderTitle')?.value || '').trim();
    const expectedDate = document.getElementById('purchaseOrderExpectedDate')?.value || '';
    const items = parsePurchaseOrderItems(document.getElementById('purchaseOrderItems')?.value || '');
    const manualTotal = parseFloat((document.getElementById('purchaseOrderTotal')?.value || '').replace(',', '.')) || 0;
    const total = manualTotal || items.reduce((sum, item) => sum + item.total, 0);

    if (!supplier || !title) {
        showToast('Fournisseur et objet obligatoires', 'warning');
        return;
    }

    db.purchaseOrders.unshift({
        id: `po-${Date.now()}`,
        number: generateFinanceNumber('BC', db.purchaseOrders),
        supplierId: supplier.id,
        supplierName: supplier.name,
        title,
        expectedDate,
        items,
        total,
        status: 'draft',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });

    event.target.reset();
    closeFinanceModal('financePurchaseOrderModal');
    saveDataImmediate();
    renderFinancePage();
    showToast('Bon de commande cree', 'success');
}

function renderPurchaseOrders() {
    const container = document.getElementById('financePurchaseOrdersList');
    if (!container) return;
    const orders = [...(db.purchaseOrders || [])].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    if (!orders.length) {
        container.innerHTML = '<div class="finance-empty">Aucun bon de commande.</div>';
        return;
    }

    container.innerHTML = `
        <div class="finance-table-wrap">
            <table class="finance-public-table finance-records-table">
                <thead>
                    <tr>
                        <th>Bon</th>
                        <th>Fournisseur</th>
                        <th>Articles</th>
                        <th>Total estime</th>
                        <th>Date attendue</th>
                        <th>Statut</th>
                        <th class="finance-actions-column">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${orders.map(order => `
                        <tr>
                            <td><strong class="finance-code">${escapeHtml(order.number || 'Bon')}</strong><span>${escapeHtml(order.title || 'Commande fournisseur')}</span></td>
                            <td><strong>${escapeHtml(order.supplierName || 'Fournisseur')}</strong></td>
                            <td><strong>${(order.items || []).length}</strong><span>ligne${(order.items || []).length > 1 ? 's' : ''}</span></td>
                            <td><strong>${formatPrice(order.total || 0)}</strong></td>
                            <td>${escapeHtml(order.expectedDate || 'Non definie')}</td>
                            <td><span class="finance-row-status status-${order.status}">${PURCHASE_ORDER_STATUS_LABELS[order.status] || order.status}</span></td>
                            <td class="finance-actions-cell">
                                <div class="finance-table-actions">
                                    <button class="btn btn-sm btn-primary" type="button" onclick="updatePurchaseOrderStatus('${order.id}', 'received')" ${order.status === 'received' || order.status === 'cancelled' ? 'disabled' : ''}>Marquer recu</button>
                                    <button class="finance-icon-button" type="button" onclick="printPurchaseOrder('${order.id}')" title="Imprimer le bon" aria-label="Imprimer le bon">
                                        <svg viewBox="0 0 24 24"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z"/></svg>
                                    </button>
                                    <details class="finance-action-menu">
                                        <summary title="Plus d'actions" aria-label="Plus d'actions">
                                            <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>
                                        </summary>
                                        <div class="finance-action-popover">
                                            <button type="button" onclick="updatePurchaseOrderStatus('${order.id}', 'sent')" ${order.status !== 'draft' ? 'disabled' : ''}>Marquer envoye</button>
                                            <button class="danger" type="button" onclick="updatePurchaseOrderStatus('${order.id}', 'cancelled')" ${order.status === 'cancelled' ? 'disabled' : ''}>Annuler le bon</button>
                                        </div>
                                    </details>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function updatePurchaseOrderStatus(orderId, status) {
    const order = (db.purchaseOrders || []).find(item => item.id === orderId);
    if (!order || !PURCHASE_ORDER_STATUS_LABELS[status]) return;
    if (status === 'received' && order.source === 'achats' && !order.invoiceId) {
        showToast('Validez ce bon depuis la page Achats pour enregistrer le stock', 'warning');
        return;
    }
    order.status = status;
    order.updatedAt = new Date().toISOString();
    saveDataImmediate();
    renderFinancePage();
    showToast('Bon de commande mis a jour', 'success');
}

function printPurchaseOrder(orderId) {
    const order = (db.purchaseOrders || []).find(item => item.id === orderId);
    if (!order) return;
    const itemsHtml = (order.items || []).map(item => `
        <tr><td>${escapeHtml(item.name)}</td><td>${item.quantity}</td><td>${formatPrice(item.price)}</td><td>${formatPrice(item.total)}</td></tr>
    `).join('');
    const html = `
        <h1>Bon de commande ${escapeHtml(order.number)}</h1>
        <p><strong>Fournisseur:</strong> ${escapeHtml(order.supplierName || '-')}</p>
        <p><strong>Objet:</strong> ${escapeHtml(order.title)}</p>
        <p><strong>Date attendue:</strong> ${escapeHtml(order.expectedDate || '-')}</p>
        <table><thead><tr><th>Article</th><th>Qte</th><th>Prix</th><th>Total</th></tr></thead><tbody>${itemsHtml}</tbody></table>
        <h2>Total estime: ${formatPrice(order.total || 0)}</h2>
    `;
    printFinanceDocument(`Bon ${order.number}`, html);
}

function printFinanceDocument(title, bodyHtml) {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        showToast('Pop-up bloquee', 'error');
        return;
    }
    printWindow.document.write(`
        <!doctype html>
        <html><head><title>${escapeHtml(title)}</title>
        <style>
            body{font-family:Inter,Arial,sans-serif;padding:28px;color:#111827}
            h1{font-size:26px;margin:0 0 16px} h2{font-size:18px;margin-top:24px}
            p{margin:6px 0} table{width:100%;border-collapse:collapse;margin-top:18px}
            th,td{border:1px solid #d1d5db;padding:8px;text-align:left} th{background:#f3f4f6}
        </style></head><body>${bodyHtml}</body></html>
    `);
    printWindow.document.close();
    printWindow.onload = () => printWindow.print();
}

function renderFinancePage() {
    ensureFinanceDefaults();
    updateFinanceSelects();
    renderFinanceStats();
    renderFinanceDirectory();
    renderInvoices();
    renderPurchaseOrders();

    const clientsView = document.getElementById('financeClientsView');
    const suppliersView = document.getElementById('financeSuppliersView');
    if (clientsView) clientsView.hidden = financeDirectoryMode !== 'clients';
    if (suppliersView) suppliersView.hidden = financeDirectoryMode !== 'suppliers';
}

function initFinancePage() {
    loadData().then(() => {
        initTheme();
        fillDbDefaults();
        ensureFinanceDefaults();
        renderFinancePage();
        document.getElementById('financeClientForm')?.addEventListener('submit', saveFinanceClient);
        document.getElementById('manualInvoiceForm')?.addEventListener('submit', createManualInvoice);
        document.getElementById('supplierForm')?.addEventListener('submit', saveSupplier);
        document.getElementById('purchaseOrderForm')?.addEventListener('submit', createPurchaseOrder);
        document.getElementById('financeInvoiceFilter')?.addEventListener('change', renderInvoices);
        document.getElementById('financeInvoiceSearch')?.addEventListener('input', renderInvoices);
        document.getElementById('financeDirectorySearch')?.addEventListener('input', renderFinanceDirectory);

        document.querySelectorAll('.finance-editor-overlay').forEach(overlay => {
            overlay.addEventListener('click', event => {
                if (event.target === overlay) closeFinanceModal(overlay.id);
            });
        });

        document.addEventListener('keydown', event => {
            if (event.key !== 'Escape') return;
            const openModal = [...document.querySelectorAll('.finance-editor-overlay')]
                .find(modal => modal.style.display !== 'none');
            if (openModal) closeFinanceModal(openModal.id);
        });
    });
}

function getDefaultImage(categoryId) {
    const colors = {
        1: { bg: '#F5EEEB', icon: '🍫' },
        2: { bg: '#FDF0E6', icon: '🍬' },
        3: { bg: '#F5EDE6', icon: '🟤' },
        4: { bg: '#F5EDE6', icon: '☕' },
        5: { bg: '#FFF8E1', icon: '🎂' },
        6: { bg: '#F0E8F5', icon: '🎁' },
        7: { bg: '#F5F5F5', icon: '🧂' }
    };
    const c = colors[categoryId] || colors[1];
    return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="140"><rect width="200" height="140" fill="${c.bg}"/><text x="100" y="80" font-size="48" text-anchor="middle">${c.icon}</text></svg>`)}`;
}

function getProductImage(p) {
    return (p.image && p.image.trim()) ? p.image : getDefaultImage(p.category);
}

// ==========================================
// Theme
// ==========================================

function initTheme() {
    if (localStorage.getItem('cafegestion_theme') === 'dark') {
        document.documentElement.classList.add('dark');
    }

    const toggle = document.getElementById('themeToggle');
    if (toggle) {
        toggle.textContent = document.documentElement.classList.contains('dark') ? '☀️' : '🌙';
        toggle.addEventListener('click', () => {
            document.documentElement.classList.toggle('dark');
            const isDark = document.documentElement.classList.contains('dark');
            localStorage.setItem('cafegestion_theme', isDark ? 'dark' : 'light');
            toggle.textContent = isDark ? '☀️' : '🌙';
        });
    }
}

// ==========================================
// Dashboard (Ventes)
// ==========================================

function renderCategories() {
    const container = document.getElementById('categoryPills');
    if (!container) return;

    const favCount = db.products.filter(p => p.isFavorite).length;

    container.innerHTML = `
        <button class="category-pill active" data-category="all" onclick="if(!globalTouchMoved) filterCategory('all')">
            Tous <span class="badge">${db.products.length}</span>
        </button>
        <button class="category-pill" data-category="favorites" onclick="if(!globalTouchMoved) filterCategory('favorites')">
            ☕ Favoris <span class="badge">${favCount}</span>
        </button>
    `;

    db.categories.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'category-pill';
        btn.dataset.category = cat.id;
        btn.draggable = true;
        btn.innerHTML = `${cat.icon ? cat.icon + ' ' : ''}${cat.name || ''}`;

        btn.onclick = (e) => {
            if (globalTouchMoved) return;
            filterCategory(cat.id);
        };

        // Drag events
        btn.addEventListener('dragstart', (e) => handleCategoryDragStart(e, cat.id));
        btn.addEventListener('dragover', (e) => handleCategoryDragOver(e));
        btn.addEventListener('drop', (e) => handleCategoryDrop(e, cat.id));
        btn.addEventListener('dragend', (e) => handleCategoryDragEnd(e));

        container.appendChild(btn);
    });


}

let draggedCategoryId = null;

function handleCategoryDragStart(e, id) {
    draggedCategoryId = id;
    e.target.style.opacity = '0.5';
    e.dataTransfer.effectAllowed = 'move';
}

function handleCategoryDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleCategoryDragEnd(e) {
    e.target.style.opacity = '1';
    draggedCategoryId = null;
}

function handleCategoryDrop(e, targetId) {
    e.preventDefault();
    e.stopPropagation();

    if (draggedCategoryId === null || draggedCategoryId === targetId) return;

    const fromIndex = db.categories.findIndex(c => c.id === draggedCategoryId);
    const toIndex = db.categories.findIndex(c => c.id === targetId);

    if (fromIndex > -1 && toIndex > -1) {
        // Move item
        const [movedItem] = db.categories.splice(fromIndex, 1);
        db.categories.splice(toIndex, 0, movedItem);
        saveData();
        renderCategories();
        showToast('Ordre des catégories mis à jour', 'success');
    }

    return false;
}

function filterCategory(catId) {
    selectedCategory = catId;
    document.querySelectorAll('.category-pill').forEach(p => {
        p.classList.toggle('active', p.dataset.category == catId);
    });
    renderProducts();
}

function toggleFavorite(id) {
    const p = getProductById(id);
    if (!p) return;
    p.isFavorite = !p.isFavorite;
    saveData();
    renderProducts();
    renderCategories();
    // showToast(p.isFavorite ? 'Ajouté aux favoris' : 'Retiré des favoris', 'info');
}

function renderProducts() {
    const container = document.getElementById('productsGrid');
    if (!container) return;

    let products = getOrderedItems(db.products || [], 'vente');

    if (selectedCategory === 'favorites') {
        products = products.filter(p => p.isFavorite);
    } else if (selectedCategory !== 'all') {
        products = products.filter(p => p.category === selectedCategory);
    }

    const normalize = str => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const searchVal = document.getElementById('searchInput')?.value || "";
    const search = normalize(searchVal);

    if (search) {
        products = products.filter(p =>
            normalize(p.name || '').includes(search) ||
            getProductBarcode(p).includes(normalizeBarcodeValue(searchVal))
        );
    }

    if (!products.length) {
        container.innerHTML = `
            <div class="empty-state" style="grid-column:1/-1">
                <p class="text-muted">Aucun produit trouvé</p>
            </div>
        `;
        return;
    }

    // Clear container and use DocumentFragment for better performance
    container.innerHTML = '';
    const fragment = document.createDocumentFragment();

    // Batch processing for smooth rendering with many products
    const batchSize = 50;
    let index = 0;

    function renderBatch() {
        const end = Math.min(index + batchSize, products.length);

        for (let i = index; i < end; i++) {
            const p = products[i];
            const min = p.minStock || 10;
            const isInCart = cart.some(c => c.productId === p.id);

            // Create product card element
            const card = document.createElement('div');
            card.className = `product-card ${isInCart ? 'selected' : ''}`;
            card.dataset.id = p.id;
            card.style.cssText = 'position: relative; transition: transform 0.2s, box-shadow 0.2s;';

            // Determine stock display
            let stockHtml = '';
            if (p.stock < 0) {
                stockHtml = `<div class="stock-alert-anime" style="background: #d32f2f; color: white; font-weight: 800; border: 2px solid #b71c1c;">STOCK NÉGATIF: ${p.stock}</div>`;
            } else if (p.stock === 0) {
                stockHtml = `<div class="stock-alert-anime">RUPTURE</div>`;
            } else if (p.stock <= min) {
                stockHtml = `<div class="stock-alert-anime">Stock : ${p.stock}</div>`;
            } else {
                stockHtml = `<div class="product-stock stock-ok" style="margin-top: auto; width: 100%; text-align: center;">Stock : ${p.stock}</div>`;
            }

            const favIcon = p.isFavorite
                ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`
                : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line></svg>`;

            const favColor = p.isFavorite ? 'var(--primary)' : '#8b4513';

            card.innerHTML = `
                <button onclick="event.stopPropagation(); toggleFavorite(${p.id})"
                        style="position: absolute; top: 8px; right: 8px; z-index: 10; width: 32px; height: 32px; border-radius: 50%; border: none; background: rgba(255,255,255,0.95); box-shadow: 0 2px 8px rgba(0,0,0,0.1); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; color: ${favColor};">
                    ${favIcon}
                </button>
                <img src="${getProductImage(p)}" alt="${p.name}" class="product-image"
                     onerror="this.src='${getDefaultImage(p.category)}'" loading="lazy">
                <div class="product-info">
                    <div class="product-name">${p.name}</div>
                    <div style="display: flex; gap: 6px; align-items: center; margin-top: 3px; margin-bottom: 3px;">
                        <span class="product-price-badge" style="font-size: 0.9rem; font-weight: 700; color: var(--primary); background: rgba(74, 44, 42, 0.08); padding: 3px 8px; border-radius: 6px; display: inline-block;">${formatPrice(p.price)}</span>
                        <span class="stock-badge" style="font-size: 0.75rem; font-weight: 700; padding: 2px 6px; border-radius: 4px; ${p.stock > 0 ? 'background: rgba(76, 175, 80, 0.15); color: #2e7d32;' : 'background: rgba(244, 67, 54, 0.15); color: #d32f2f;'}">${p.stock}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 3px;">
                        <span style="font-size: 0.65rem; color: var(--text-light); font-weight: 600;">Qty:</span>
                        <input type="number" class="card-qty-input compact-qty" value="1" min="1"
                               onclick="event.stopPropagation()"
                               onfocus="this.select()"
                               onblur="if(this.value==='' || parseInt(this.value) < 1) this.value='1'"
                               style="width: 45px; text-align: center; border: 1px solid var(--border); padding: 2px 4px; border-radius: 4px; font-weight: 700; outline: none; font-size: 0.8rem; background: rgba(0,0,0,0.03);">
                    </div>
                </div>
            `;

            // Reorder Mode Logic
            if (isReorderMode) {
                card.draggable = true;
                card.ondragstart = (e) => handleDragStart(e, p.id, 'product', 'vente');
                card.ondragend = handleDragEnd;
                card.ondragover = handleProductDragOver;
                card.ondragleave = handleProductDragLeave;
                card.ondrop = (e) => handleProductDrop(e, p.id);
                card.style.cursor = 'move';
                card.classList.add('reorder-active');
            } else {
                // Add pointer event handlers for normal mode
                card.onpointerdown = (e) => onCardDown(e, p.id, card, 'cart');
                card.onpointermove = onCardMove;
                card.onpointerup = onCardUp;
                card.onpointerleave = onCardUp;
            }

            fragment.appendChild(card);
        }

        index = end;

        if (index < products.length) {
            // More products to render, continue in next frame
            requestAnimationFrame(renderBatch);
        } else {
            // All done, append to container
            container.appendChild(fragment);
        }
    }

    // Start rendering
    renderBatch();
}

function initSearch() {
    document.getElementById('searchInput')?.addEventListener('input', renderProducts);
}

// ==========================================
// Cart with Animations
// ==========================================

function initCart() {
    updateCart();
    document.getElementById('checkoutBtn')?.addEventListener('click', checkout);

    // Set initial state of auto-print toggle from settings
    const settings = getSettings();
    const printToggle = document.getElementById('printTicketToggle');
    if (printToggle && settings.autoPrint !== undefined) {
        printToggle.checked = settings.autoPrint;
    }
}

function addToCartAnimated(productId, element) {
    if (globalTouchMoved) return;
    const product = getProductById(productId);
    if (!product) return;

    let quantity = 1;

    // Get quantity from input if available
    if (element) {
        const input = element.querySelector('.card-qty-input');
        if (input) {
            quantity = parseInt(input.value) || 1;
        }

        // Remove animation class reset if needed, but adding it for visual feedback
        element.classList.add('adding');
        setTimeout(() => element.classList.remove('adding'), 500);
    }

    if (quantity <= 0) quantity = 1;

    /* Stock limit removed to allow negative stock
    if (product.stock < quantity) {
        showToast(`Stock insuffisant (Max: ${product.stock})`, 'error');
        return;
    }
    */

    const existing = cart.find(c => c.productId === productId);
    if (existing) {
        // Optional: Check total limit - REMOVED
        /*
        if (product.stock < (existing.quantity + quantity)) {
            showToast(`Stock insuffisant pour ajouter ${quantity} de plus`, 'error');
            return;
        }
        */
        existing.quantity += quantity;
    } else {
        cart.push({ productId, quantity: quantity });
    }

    updateCart(productId);
    renderProducts();
    saveData(); // Save cart to localStorage
}

let barcodeScannerInitialized = false;
let barcodeScanBuffer = '';
let barcodeLastKeyAt = 0;

function addProductByScannedCode(rawCode) {
    const code = normalizeBarcodeValue(rawCode);
    if (!code) return false;
    const product = findProductByBarcode(code);
    if (!product) return false;

    addToCartAnimated(product.id, null);
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.value = '';
        renderProducts();
    }
    showToast(`${product.name} ajoute par scan`, 'success');
    return true;
}

function initBarcodeScanner() {
    if (barcodeScannerInitialized) return;
    barcodeScannerInitialized = true;

    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            const value = searchInput.value.trim();
            if (addProductByScannedCode(value)) {
                event.preventDefault();
                searchInput.value = '';
            }
        });
    }

    document.addEventListener('keydown', (event) => {
        if (!document.getElementById('productsGrid')) return;
        if (event.ctrlKey || event.altKey || event.metaKey) return;

        const target = event.target;
        const isEditable = target && (
            target.isContentEditable ||
            ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
        );
        if (isEditable) return;

        const now = Date.now();
        if (now - barcodeLastKeyAt > 120) barcodeScanBuffer = '';
        barcodeLastKeyAt = now;

        if (event.key === 'Enter') {
            if (barcodeScanBuffer.length >= 3) {
                addProductByScannedCode(barcodeScanBuffer);
            }
            barcodeScanBuffer = '';
            return;
        }

        if (event.key === 'Escape') {
            barcodeScanBuffer = '';
            return;
        }

        if (event.key.length === 1) {
            barcodeScanBuffer += event.key;
            if (barcodeScanBuffer.length > 80) {
                barcodeScanBuffer = barcodeScanBuffer.slice(-80);
            }
        }
    });
}

function updateCartQty(productId, delta) {
    const item = cart.find(c => String(c.productId) === String(productId));
    if (!item) return;

    item.quantity += delta;
    if (item.quantity <= 0) {
        cart = cart.filter(c => String(c.productId) !== String(productId));
    }
    updateCart(productId);
    renderProducts();
    saveData();
}

function setCartQty(productId, qty) {
    const item = cart.find(c => String(c.productId) === String(productId));
    if (!item) return;

    if (isNaN(qty) || qty < 1) qty = 1;
    if (qty > 999) qty = 999;

    item.quantity = qty;

    // Only update totals and item price display without full re-render to preserve focus while typing
    const itemEl = document.querySelector(`.cart-item[data-product-id="${productId}"]`);
    if (itemEl) {
        const priceEl = itemEl.querySelector('.cart-item-price');
        if (priceEl) {
            const p = getProductById(item.productId) || (String(item.productId).startsWith('divers') ? { id: item.productId, name: 'Article Divers', price: item.origCustomPrice || 0 } : null);
            if (p) {
                const origUnit = item.origCustomPrice !== undefined ? item.origCustomPrice : (p.price || 0);
                const currUnit = item.customPrice !== undefined ? item.customPrice : origUnit;
                priceEl.innerHTML = `
                    ${(currUnit !== origUnit && origUnit > 0) ? `<span style="text-decoration: line-through; opacity: 0.5; font-size: 0.8rem; margin-right: 5px;">${formatPriceNoSymbol(origUnit * item.quantity)}</span>` : ''}
                    ${formatPriceNoSymbol(currUnit * item.quantity)}
                `;
            }
        }
    }

    const total = cart.reduce((s, i) => {
        const p = getProductById(i.productId) || (String(i.productId).startsWith('divers') ? { price: 0 } : null);
        const price = i.customPrice !== undefined ? i.customPrice : (p?.price || 0);
        return s + (price * i.quantity) - (i.itemDiscount || 0);
    }, 0);
    const totalEl = document.getElementById('total');
    if (totalEl) totalEl.textContent = formatPrice(total);

    const countEl = document.getElementById('cartCount');
    const totalItems = cart.reduce((s, i) => s + i.quantity, 0);
    if (countEl) countEl.textContent = totalItems;

    saveData();
}

function removeFromCart(productId) {
    cart = cart.filter(i => String(i.productId) !== String(productId));
    updateCart();
    renderProducts();
    saveData(); // Save cart to localStorage
}

function openItemDiscountModal(productId) {
    const item = cart.find(i => String(i.productId) === String(productId));
    if (!item) return;

    const isDivers = String(productId).startsWith('divers');
    const prodObj = getProductById(productId);
    if (item.origCustomPrice === undefined) {
        item.origCustomPrice = prodObj ? (prodObj.price || 0) : (item.customPrice || 0);
    }

    const p = prodObj || (isDivers ? { name: 'Article Divers', price: item.origCustomPrice || 0 } : { name: 'Article', price: item.customPrice || 0 });
    const origUnitPrice = item.origCustomPrice;
    const defaultTotal = origUnitPrice * item.quantity;
    const currentUnitPrice = item.customPrice !== undefined ? item.customPrice : origUnitPrice;
    const currentTotal = (currentUnitPrice * item.quantity) - (item.itemDiscount || 0);

    Swal.fire({
        title: 'Nouveau prix de l\'article',
        html: `
            <div style="margin-bottom: 15px; font-size: 0.95rem;">
                <strong>${p.name}</strong><br>
                Prix standard : ${formatPrice(origUnitPrice)}
            </div>
            <div style="display: flex; gap: 10px; justify-content: center; margin-bottom: 15px;">
                <button type="button" id="itemPriceUnitBtn" class="swal2-confirm swal2-styled" style="margin: 0; padding: 8px 20px; font-weight: 700;">Prix Unité</button>
                <button type="button" id="itemPriceTotalBtn" class="swal2-cancel swal2-styled" style="margin: 0; padding: 8px 20px; font-weight: 700; background-color: #6e7881;">Prix Total</button>
            </div>
            <input id="itemCustomPriceValue" class="swal2-input" type="text" inputmode="decimal" placeholder="Nouveau prix" style="width: 80%; margin: 0 auto; text-align: center; font-weight: 700; font-size: 1.2rem;">
        `,
        showCancelButton: true,
        confirmButtonText: 'Appliquer',
        cancelButtonText: 'Annuler',
        didOpen: () => {
            const unitBtn = document.getElementById('itemPriceUnitBtn');
            const totalBtn = document.getElementById('itemPriceTotalBtn');
            const input = document.getElementById('itemCustomPriceValue');
            let mode = 'unit'; // Default to unit

            const updateUI = () => {
                if (mode === 'unit') {
                    unitBtn.style.backgroundColor = 'var(--primary)';
                    totalBtn.style.backgroundColor = '#6e7881';
                    input.placeholder = 'Nouveau Prix Unité (DA)';
                    input.value = '';
                } else {
                    totalBtn.style.backgroundColor = 'var(--primary)';
                    unitBtn.style.backgroundColor = '#6e7881';
                    input.placeholder = 'Nouveau Prix Total (DA)';
                    input.value = '';
                }
            };

            updateUI();

            unitBtn.onclick = () => { mode = 'unit'; updateUI(); input.focus(); };
            totalBtn.onclick = () => { mode = 'total'; updateUI(); input.focus(); };

            window.getItemPriceMode = () => mode;
            input.focus();
        },
        preConfirm: () => {
            const valStr = (document.getElementById('itemCustomPriceValue').value || '').replace(',', '.');
            const val = parseFloat(valStr);
            if (isNaN(val) || val < 0) {
                return Swal.showValidationMessage('Veuillez entrer un prix valide');
            }
            const mode = window.getItemPriceMode();
            return { val, mode };
        }
    }).then((result) => {
        if (result.isConfirmed) {
            const { val, mode } = result.value;
            let newUnit = mode === 'unit' ? val : val / item.quantity;

            if (Math.abs(newUnit - origUnitPrice) < 0.01) {
                item.itemDiscount = 0;
                item.itemDiscountPercent = 0;
                item.customPrice = isDivers ? item.origCustomPrice : undefined;
            } else {
                item.customPrice = Number(newUnit.toFixed(2));
                item.itemDiscount = 0;
                item.itemDiscountPercent = 0;
            }
            updateCart();
            saveData();
        }
    });
}

function updateCart(highlightProductId) {
    const container = document.getElementById('cartItems');
    const empty = document.getElementById('emptyCart');
    const countEl = document.getElementById('cartCount');
    if (!container) return;

    const totalItems = cart.reduce((s, i) => s + i.quantity, 0);
    if (countEl) countEl.textContent = totalItems;

    container.querySelectorAll('.cart-item').forEach(el => el.remove());

    if (!cart.length) {
        if (empty) empty.style.display = 'flex';
    } else {
        if (empty) empty.style.display = 'none';
        cart.forEach(item => {
            const p = getProductById(item.productId) || (String(item.productId).startsWith('divers') ? { id: item.productId, name: 'Article Divers', price: item.origCustomPrice || 0 } : null);
            if (!p) return;

            const origUnit = item.origCustomPrice !== undefined ? item.origCustomPrice : (p.price || 0);
            const currUnit = item.customPrice !== undefined ? item.customPrice : origUnit;

            const div = document.createElement('div');
            div.className = 'cart-item';
            div.setAttribute('data-product-id', p.id);
            div.innerHTML = `
                <div class="cart-item-info">
                    <div class="cart-item-name" title="${p.name}">${p.name}</div>
                    <div class="cart-item-price">
                        ${(currUnit !== origUnit && origUnit > 0) ? `<span style="text-decoration: line-through; opacity: 0.5; font-size: 0.8rem; margin-right: 5px;">${formatPriceNoSymbol(origUnit * item.quantity)}</span>` : ''}
                        ${formatPriceNoSymbol(currUnit * item.quantity)}
                    </div>
                </div>
                <div class="cart-qty">
                    <button class="cart-qty-btn" onclick="updateCartQty('${p.id}', -1)">−</button>
                    <input type="number" class="cart-qty-input" value="${item.quantity}" min="1" max="999"
                           oninput="setCartQty('${p.id}', parseInt(this.value))"
                           onfocus="if(this.value === '1') this.value = ''; this.select();"
                           onblur="if(this.value === '' || isNaN(parseInt(this.value))) { this.value = '1'; setCartQty('${p.id}', 1); }"
                           style="width: 70px; text-align: center; border: none; background: transparent; font-weight: 800; color: var(--primary); outline: none; -moz-appearance: textfield; appearance: textfield; font-size: 1.1rem;">
                    <button class="cart-qty-btn" onclick="updateCartQty('${p.id}', 1)">+</button>
                </div>
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <button class="cart-remove-btn" onclick="removeFromCart('${p.id}')" title="Annuler" style="margin-bottom: 2px;">✕</button>
                    <button class="cart-discount-btn" onclick="openItemDiscountModal('${p.id}')" title="Remise Article" style="background: none; border: 1px solid var(--border); border-radius: 4px; padding: 2px; font-size: 0.7rem; color: var(--primary); cursor: pointer;">
                        🏷️
                    </button>
                </div>
            `;
            container.insertBefore(div, empty);

            // If this item is the one to highlight, apply highlight class and scroll into view
            if (String(p.id) === String(highlightProductId)) {
                div.classList.add('highlighted');
                try { div.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) { }
                setTimeout(() => div.classList.remove('highlighted'), 1600);
            }
        });
    }

    const subtotal = cart.reduce((s, i) => {
        const p = getProductById(i.productId) || (String(i.productId).startsWith('divers') ? { price: 0 } : null);
        const price = i.customPrice !== undefined ? i.customPrice : (p?.price || 0);
        return s + (price * i.quantity) - (i.itemDiscount || 0);
    }, 0);

    const discountInput = document.getElementById('cartDiscountInput');
    const discountVal = discountInput ? (parseFloat(discountInput.value) || 0) : 0;
    let discount = 0;
    if (cartDiscountType === 'percent') {
        discount = subtotal * (discountVal / 100);
    } else {
        discount = discountVal;
    }
    const total = Math.max(0, subtotal - discount);

    const totalEl = document.getElementById('total');
    if (totalEl) totalEl.textContent = formatPrice(total);
}

function toggleCartDiscountType() {
    const label = document.getElementById('cartDiscountLabel');
    const btn = document.getElementById('toggleCartDiscountType');
    if (!label || !btn) return;

    if (cartDiscountType === 'amount') {
        cartDiscountType = 'percent';
        label.textContent = 'Remise (%)';
        btn.textContent = 'DA';
        btn.style.background = 'var(--primary)';
        btn.style.color = 'white';
    } else {
        cartDiscountType = 'amount';
        label.textContent = 'Remise (DA)';
        btn.textContent = '%';
        btn.style.background = 'var(--border)';
        btn.style.color = 'var(--text-dark)';
    }
    updateCart();
}



function checkout() {
    if (!cart.length) {
        showToast('Le panier est vide!', 'warning');
        return;
    }

    const subtotalWithItemDiscounts = cart.reduce((s, i) => {
        const p = getProductById(i.productId) || (String(i.productId).startsWith('divers') ? { price: 0 } : null);
        const price = i.customPrice !== undefined ? i.customPrice : (p?.price || 0);
        return s + (price * i.quantity) - (i.itemDiscount || 0);
    }, 0);

    const discountInput = document.getElementById('cartDiscountInput');
    const discountVal = discountInput ? (parseFloat(discountInput.value) || 0) : 0;

    let discountAmount = 0;
    if (cartDiscountType === 'percent') {
        discountAmount = subtotalWithItemDiscounts * (discountVal / 100);
    } else {
        discountAmount = discountVal;
    }

    const useCaisse = document.getElementById('caisseToggle')?.checked;
    const useCredit = document.getElementById('creditSaleToggle')?.checked;

    if (useCredit) {
        if (!selectedClientId || selectedClientId === 'divers') {
            showToast('Selectionnez un client pour une vente a credit', 'warning');
            const clientPanel = document.getElementById('compactClientPanel');
            if (clientPanel) clientPanel.style.display = 'block';
            return;
        }
        finalizeCheckout(null, null, discountAmount, { createInvoice: true });
        return;
    }

    if (useCaisse) {
        // openPaymentModal takes (total_before_global_discount, initial_discount)
        openPaymentModal(subtotalWithItemDiscounts, discountAmount);
    } else {
        finalizeCheckout(null, null, discountAmount);
    }
}








let currentCheckoutTotal = 0;
let originalCheckoutTotal = 0;
let currentRemiseType = 'amount';

function openPaymentModal(total, initialDiscount = 0) {
    originalCheckoutTotal = total;
    currentCheckoutTotal = total - initialDiscount;
    currentRemiseType = 'amount';

    const modal = document.getElementById('paymentModal');
    const totalDisplay = document.getElementById('paymentTotalDisplay');
    const input = document.getElementById('paymentReceivedInput');
    const changeDisplay = document.getElementById('paymentChangeDisplay');
    const confirmBtn = document.getElementById('confirmPaymentBtn');

    // Remise elements
    const toggleRemiseBtn = document.getElementById('toggleRemiseBtn');
    const remiseContainer = document.getElementById('remiseContainer');
    const remiseIcon = document.getElementById('remiseIcon');
    const remiseValueInput = document.getElementById('remiseValueInput');
    const remiseTypeBtns = document.querySelectorAll('.remise-type-btn');

    if (!modal) return finalizeCheckout(null, null, initialDiscount);

    // Reset Remise Section
    if (initialDiscount > 0) {
        remiseContainer.style.display = 'block';
        remiseIcon.textContent = '−';
        remiseValueInput.value = initialDiscount;
    } else {
        remiseContainer.style.display = 'none';
        remiseIcon.textContent = '+';
        remiseValueInput.value = '';
    }
    remiseTypeBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.type === 'amount'));

    totalDisplay.textContent = formatPrice(currentCheckoutTotal);
    totalDisplay.style.color = initialDiscount > 0 ? 'var(--secondary)' : 'var(--primary)';
    input.value = '';
    changeDisplay.textContent = '0,00 DA';
    changeDisplay.style.color = 'var(--gray)';

    modal.style.display = 'flex';
    input.focus();

    const updateCalculations = () => {
        const remiseVal = parseFloat(remiseValueInput.value) || 0;
        let discount = 0;

        if (remiseContainer.style.display !== 'none') {
            if (currentRemiseType === 'amount') {
                discount = remiseVal;
            } else {
                discount = originalCheckoutTotal * (remiseVal / 100);
            }
        }

        currentCheckoutTotal = Math.max(0, originalCheckoutTotal - discount);
        totalDisplay.textContent = formatPrice(currentCheckoutTotal);

        if (discount > 0) {
            totalDisplay.style.color = 'var(--secondary)';
        } else {
            totalDisplay.style.color = 'var(--primary)';
        }

        const received = parseFloat(input.value) || 0;
        const change = received - currentCheckoutTotal;
        changeDisplay.textContent = formatPrice(Math.max(0, change));

        if (received >= currentCheckoutTotal && currentCheckoutTotal > 0) {
            changeDisplay.style.color = 'var(--success)';
        } else {
            changeDisplay.style.color = 'var(--gray)';
        }
    };

    toggleRemiseBtn.onclick = () => {
        const isHidden = remiseContainer.style.display === 'none';
        remiseContainer.style.display = isHidden ? 'block' : 'none';
        remiseIcon.textContent = isHidden ? '−' : '+';
        if (!isHidden) remiseValueInput.value = '';
        updateCalculations();
    };

    remiseTypeBtns.forEach(btn => {
        btn.onclick = () => {
            currentRemiseType = btn.dataset.type;
            remiseTypeBtns.forEach(b => b.classList.toggle('active', b === btn));
            updateCalculations();
        };
    });

    remiseValueInput.oninput = updateCalculations;
    input.oninput = updateCalculations;

    // Bouton Montant Exact - remplit automatiquement le total à payer
    const exactAmountBtn = document.getElementById('exactAmountBtn');
    if (exactAmountBtn) {
        exactAmountBtn.onclick = () => {
            input.value = currentCheckoutTotal;
            updateCalculations();
            input.focus();
        };
    }

    const closeModal = () => document.getElementById('paymentModal').style.display = 'none';
    document.getElementById('closePaymentModal').onclick = closeModal;
    document.getElementById('cancelPaymentBtn').onclick = closeModal;

    confirmBtn.onclick = () => {
        const received = parseFloat(input.value) || 0;
        if (received < currentCheckoutTotal) {
            showToast('Montant reçu insuffisant', 'error');
            return;
        }
        const change = received - currentCheckoutTotal;
        const discount = originalCheckoutTotal - currentCheckoutTotal;
        finalizeCheckout(received, change, discount);
        closeModal();
    };

    input.onkeydown = (e) => {
        if (e.key === 'Enter') confirmBtn.click();
        if (e.key === 'Escape') closeModal();
    };
}

function finalizeCheckout(receivedAmount = null, changeAmount = null, discountAmount = 0, options = {}) {
    const shouldPrint = document.getElementById('printTicketToggle')?.checked !== false;
    const itemsTotal = cart.reduce((s, i) => {
        const p = getProductById(i.productId) || (String(i.productId).startsWith('divers') ? { price: 0 } : null);
        const price = i.customPrice !== undefined ? i.customPrice : (p?.price || 0);
        return s + (price * i.quantity) - (i.itemDiscount || 0);
    }, 0);
    const finalTotal = Math.max(0, itemsTotal - discountAmount);

    const finalOrderItems = [];

    cart.forEach(item => {
        const product = getProductById(item.productId);
        let dynamicCost = 0;

        const recipe = (db.recipes || []).find(r => String(r.productId) === String(item.productId));
        if (product && recipe && recipe.ingredients) {
            const unitsDivisor = parseFloat(recipe.unitsDivisor) || 1;
            let totalBatchIngredientsCost = 0;

            recipe.ingredients.forEach(ing => {
                const requiredQty = (ing.quantity / unitsDivisor) * item.quantity;
                const unitPrice = getComponentItemUnitPrice(ing.componentId);
                totalBatchIngredientsCost += unitPrice * ing.quantity;

                // Deduct FIFO from lots
                let remaining = requiredQty;
                const availableLots = (db.lots || []).filter(l => String(l.componentId) === String(ing.componentId) && (l.remainingQty || l.quantity) > 0)
                    .sort((a, b) => new Date(a.date) - new Date(b.date));

                availableLots.forEach(lot => {
                    if (remaining <= 0) return;
                    const available = parseFloat(lot.remainingQty || lot.quantity);
                    const canUse = Math.min(remaining, available);
                    lot.remainingQty = parseFloat((available - canUse).toFixed(4));
                    remaining = parseFloat((remaining - canUse).toFixed(4));
                });

                // Stock Adjustment for component
                db.adjustments.unshift({
                    id: Date.now() + Math.random(),
                    productId: ing.componentId,
                    quantity: -requiredQty,
                    reason: `Vente: ${product.name}`,
                    date: new Date().toISOString(),
                    user: 'POS'
                });
            });

            dynamicCost = getSaleUnitCost({ productId: item.productId }, product);
        } else if (product) {
            dynamicCost = getSaleUnitCost({ productId: item.productId }, product);
        }

        const origUnit = item.origCustomPrice !== undefined ? item.origCustomPrice : (product?.price || 0);
        finalOrderItems.push({
            productId: item.productId,
            quantity: item.quantity,
            price: item.customPrice !== undefined ? item.customPrice : (product?.price || 0),
            origUnitPrice: origUnit,
            itemDiscount: item.itemDiscount || 0,
            unitCost: dynamicCost
        });

        if (product) {
            product.stock -= item.quantity;
            db.adjustments.unshift({
                id: Date.now() + Math.random(),
                productId: product.id,
                quantity: -item.quantity,
                reason: 'Vente',
                date: new Date().toISOString(),
                user: 'POS'
            });
        }
    });

    const newOrder = {
        id: Date.now(),
        ticketNum: (db.orders || []).filter(o => new Date(o.date).toDateString() === new Date().toDateString()).length + 1,
        clientId: selectedClientId,
        items: finalOrderItems,
        total: finalTotal,
        discount: discountAmount,
        originalTotal: itemsTotal,
        date: new Date().toISOString(),
        payment: receivedAmount !== null ? { received: receivedAmount, change: changeAmount } : null,
        paymentStatus: options.createInvoice ? 'unpaid' : (receivedAmount !== null ? 'paid' : 'untracked')
    };

    if (!db.orders) db.orders = [];
    db.orders.push(newOrder);

    if (options.createInvoice) {
        const invoice = createInvoiceFromSale(newOrder, selectedClientId, {
            title: `Vente #${newOrder.ticketNum}`
        });
        if (invoice) {
            newOrder.invoiceId = invoice.id;
            newOrder.invoiceNumber = invoice.number;
        }
    }

    // Update client stats
    const client = db.clients.find(c => String(c.id) === String(selectedClientId));
    if (client) {
        client.orderCount = (client.orderCount || 0) + 1;
        client.totalRevenue = (client.totalRevenue || 0) + finalTotal;
    }

    // Reset Cart & Remove from Parallel Orders if active
    if (activeOrderIndex >= 0 && activeOrderIndex < parallelOrders.length) {
        parallelOrders.splice(activeOrderIndex, 1);
        activeOrderIndex = -1;
    }
    cart = [];
    selectedClientId = 'divers';
    resetCartDiscount();
    const creditToggle = document.getElementById('creditSaleToggle');
    if (creditToggle) creditToggle.checked = false;

    saveDataImmediate();
    if (shouldPrint) generateTicket(newOrder);

    showToast(options.createInvoice ? 'Vente a credit enregistree' : 'Vente terminée !', 'success');
    renderProducts();
    updateCart();
    initClientSelector();
    renderParallelOrderTabs();
}





function editCartQty(productId, element) {
    const item = cart.find(c => c.productId === productId);
    if (!item) return;

    const currentValue = item.quantity;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.max = '999';
    input.value = currentValue;
    input.className = 'cart-qty-input';
    input.style.cssText = 'width: 40px; text-align: center; border: 2px solid var(--primary); border-radius: 8px; padding: 2px; font-weight: 600; font-size: 0.9rem;';

    element.replaceWith(input);
    input.focus();
    input.select();

    const finishEdit = () => {
        let newQty = parseInt(input.value) || 1;
        if (newQty < 1) newQty = 1;
        if (newQty > 999) newQty = 999; setCartQty(productId, newQty);
    };

    input.addEventListener('blur', finishEdit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            finishEdit();
        } else if (e.key === 'Escape') {
            updateCart();
        }
    });
}

// Redundant setCartQty removed to avoid focus-loss bugs during manual typing.
// The primary setCartQty is defined around line 1014 and handles updates silently.

// ==========================================
// Ticket printing / PDF download
// ==========================================

function generateTicket(order) {
    const settings = getSettings();
    const items = order.items.map(item => {
        const product = getProductById(item.productId) || (String(item.productId).startsWith('divers') ? { name: 'Article Divers' } : null);
        const price = item.price !== undefined ? item.price : (product?.price || 0);
        const origPrice = item.origUnitPrice !== undefined ? item.origUnitPrice : (product?.price || 0);
        const itemDiscount = item.itemDiscount || 0;
        return {
            name: product?.name || 'Produit',
            quantity: item.quantity,
            price: price,
            origPrice: origPrice,
            itemDiscount: itemDiscount,
            total: (price * item.quantity) - itemDiscount
        };
    });

    const subTotal = items.reduce((sum, item) => sum + item.total, 0);
    const discount = order.discount || 0;
    const grandTotal = subTotal - discount;

    const ticketHtml = buildTicketHtml({
        order,
        items,
        subTotal,
        grandTotal,
        contact: settings.contact,
        payment: order.payment
    });

    downloadTicketPdf(ticketHtml, order.id);
}

function buildTicketHtml({ order, items, subTotal, grandTotal, contact, payment }) {
    const dateLabel = formatDate(order.date);
    // Ensure a stable ticket number if not present
    let ticketNum = order.ticketNum || (db.orders && db.orders.filter(o => new Date(o.date).toDateString() === new Date(order.date).toDateString()).length + 1);

    // Compact ticket with all info - readable but minimal space
    return `
        <div class="ticket-print-area" id="ticketPrintArea">
            <div style="padding-top:8px; padding-bottom:4px; text-align:center; font-weight:900; font-size:28px; color:#000; letter-spacing:2px; text-transform:uppercase;">AXXAM</div>
            <div style="text-align:center; font-size:13px; font-weight:700; color:#000; margin-bottom:4px;">Tel: 0772864617</div>
            <div style="text-align:center; font-size:16px; color:#000; margin-bottom:6px; font-weight:700;">${dateLabel} — N°${ticketNum}</div>
            <div style="border-top:1px dashed #000; margin:6px 0 8px 0;"></div>

            <div style="font-size:15px; color:#000;">
                ${items.length ? items.map(item => `
                    <div style="margin-bottom:8px;">
                        <div style="font-weight:700; font-size:14px; color:#000; white-space:normal; overflow-wrap:anywhere; word-break:break-word;">${item.name}</div>
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; font-size:13px; color:#000;">
                            <div style="font-weight:600;">${item.quantity} x ${(item.origPrice > 0 && item.price !== item.origPrice) ? `<s style="opacity: 0.7;">${formatPriceNoSymbol(item.origPrice)}</s> ` : ''}${formatPrice(item.price)} ${item.itemDiscount > 0 ? `(-${formatPrice(item.itemDiscount)})` : ''}</div>
                            <div style="text-align:right; font-weight:800; font-size:14px;">${formatPrice(item.total)}</div>
                        </div>
                    </div>
                `).join('') : `<div style="text-align:center; color:#000; padding:8px 0; font-size:14px; font-weight:700;">Aucun article</div>`}
            </div>

            ${order.discount > 0 ? `
                <div style="border-top:1px dashed #000; margin-top:8px; padding-top:6px; display:flex; justify-content:space-between; font-size:14px; color:#000;">
                    <div style="font-weight:700;">Sous-total</div>
                    <div style="font-weight:700;">${formatPrice(subTotal)}</div>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:14px; color:#000; margin-bottom:4px;">
                    <div style="font-weight:700;">Remise</div>
                    <div style="font-weight:700;">- ${formatPrice(order.discount)}</div>
                </div>
            ` : ''}

            <div style="border-top:2px dashed #000; margin-top:4px; padding-top:8px; display:flex; justify-content:space-between; font-weight:900; font-size:20px; color:#000;">
                <div style="color:#000;">Total</div>
                <div style="color:#000;">${formatPrice(grandTotal)}</div>
            </div>

            ${payment ? `
                <div style="margin-top:10px; padding-top:8px; border-top:1px solid #000; font-size:15px; color:#000;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:4px; color:#000;"><span style="font-weight:700;">Montant reçu:</span><strong style="color:#000;">${formatPrice(payment.received)}</strong></div>
                    <div style="display:flex; justify-content:space-between; color:#000;"><span style="font-weight:700;">Montant rendu:</span><strong style="color:#000;">${formatPrice(payment.change)}</strong></div>
                </div>
            ` : ''}

            ${contact ? `<div style="margin-top:10px; text-align:center; font-size:14px; font-weight:800; color:#000;">${contact}</div>` : ''}
            
            <div style="margin-top:12px; padding-top:8px; border-top:1px dashed #000; text-align:center; font-size:14px; font-weight:800; color:#000;">
                Merci pour votre visite!
            </div>
            <div style="height:8px;"></div>
        </div>
    `;
}





function downloadTicketPdf(html, orderId) {
    const settings = getSettings();
    const printerName = settings.printerName || `Axxam`;
    const format = settings.printerFormat || '80mm';

    // Define width based on format
    let width = '80mm';
    if (format === '58mm') width = '58mm';
    if (format === 'A4') width = '210mm';

    // Supprimer l'ancien iframe s'il existe
    let printIframe = document.getElementById('printIframe');
    if (printIframe) printIframe.remove();

    // Créer un iframe caché pour l'impression
    printIframe = document.createElement('iframe');
    printIframe.id = 'printIframe';
    printIframe.style.position = 'fixed';
    printIframe.style.right = '100%';
    printIframe.style.bottom = '100%';
    printIframe.style.width = '0';
    printIframe.style.height = '0';
    printIframe.style.border = 'none';
    document.body.appendChild(printIframe);

    const styles = document.querySelector('link[href="css/style.css"]')?.outerHTML || '';
    const iframeDoc = printIframe.contentWindow.document;

    iframeDoc.write(`
        <html>
            <head>
                <title>${printerName}</title>
                ${styles}
                <style>
                    @page { size: ${width} auto; margin: 0; }
                    body {
                        margin: 0;
                        background: #fff;
                        font-family: 'Segoe UI', Arial, sans-serif !important;
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                        color: #000 !important;
                        text-rendering: optimizeLegibility;
                    }
                    .ticket-print-area {
                        width: ${width};
                        padding: 6mm 7mm;
                        margin: 0;
                        box-sizing: border-box;
                        font-size: 22px;
                    }
                    .ticket-header { text-align: center; margin-bottom: 12px; }
                    .ticket-title {
                        font-size: 30px !important;
                        font-weight: 900 !important;
                        color: #000 !important;
                        margin: 0 !important;
                        letter-spacing: 0.5px;
                        text-transform: uppercase;
                    }
                    .ticket-meta-tel { font-size: 20px !important; font-weight: 700 !important; color: #000 !important; }
                    .ticket-meta { font-size: 19px !important; font-weight: 600 !important; color: #000 !important; margin-top: 6px; }
                    .ticket-divider { border-top: 3px solid #000 !important; margin: 14px 0 !important; }
                    .ticket-line { display: flex; justify-content: space-between; font-size: 21px !important; margin-bottom: 10px; color: #000 !important; align-items: center; }
                    .ticket-line-single {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        font-size: 21px !important;
                        margin-bottom: 10px;
                        color: #000 !important;
                        gap: 12px;
                    }
                    .ticket-item-name {
                        font-weight: 700 !important;
                        font-size: 16px !important;
                        color: #000 !important;
                        white-space: normal !important;
                        overflow-wrap: anywhere !important;
                        word-break: break-word !important;
                        margin-bottom: 4px;
                    }
                    .ticket-item-meta {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        font-size: 13px !important;
                        gap: 8px;
                    }
                    .ticket-item-meta .qty {
                        font-size: 13px !important;
                        font-weight: 600 !important;
                    }
                    .ticket-item-meta .total {
                        font-weight: 800 !important;
                        font-size: 14px !important;
                        min-width: 70px;
                        text-align: right;
                    }
                    .ticket-total-row {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin: 16px 0;
                        padding: 12px 0;
                        border-top: 3px solid #000;
                    }
                    .ticket-total-row span { font-size: 22px !important; font-weight: 800 !important; }
                    .ticket-total-row strong { font-size: 28px !important; font-weight: 900 !important; }
                    .payment-line { font-weight: 700 !important; font-size: 20px !important; }
                    .remise-line { font-weight: 700 !important; font-size: 20px !important; }
                    .ticket-footer { text-align: center; font-size: 19px !important; font-weight: 600; margin-top: 14px; color: #000 !important; }
                </style>
            </head>
            <body onload="window.print(); setTimeout(() => { window.close(); }, 500);">
                ${html}
            </body>
        </html>
    `);
    iframeDoc.close();

    setTimeout(() => {
        if (printIframe) printIframe.remove();
    }, 2000);
}

function openCashDrawer() {
    let drawerIframe = document.getElementById('drawerIframe');
    if (drawerIframe) drawerIframe.remove();

    drawerIframe = document.createElement('iframe');
    drawerIframe.id = 'drawerIframe';
    drawerIframe.style.position = 'fixed';
    drawerIframe.style.right = '100%';
    drawerIframe.style.bottom = '100%';
    drawerIframe.style.width = '0';
    drawerIframe.style.height = '0';
    drawerIframe.style.border = 'none';
    document.body.appendChild(drawerIframe);

    const doc = drawerIframe.contentWindow.document;
    doc.write(`
        <html>
            <body onload="window.print(); setTimeout(() => { window.close(); }, 200);">
                <div style="font-size: 1px; color: white;">.</div>
            </body>
        </html>
    `);
    doc.close();
}

function downloadReportPdf(html, title) {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        showToast('Pop-up bloquée', 'error');
        return;
    }

    printWindow.document.write(`
        <html>
            <head>
                <title>${title}</title>
                <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap" rel="stylesheet">
                <style>
                    @page { size: A4; margin: 20mm; }
                    body { font-family: 'Inter', sans-serif; margin: 0; padding: 0; background: #fff; color: #333; }
                    table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
                    th { background: #f8f9fa; padding: 12px; text-align: left; border: 1px solid #dee2e6; font-weight: 700; }
                    td { padding: 10px; border: 1px solid #dee2e6; vertical-align: top; }
                    .price { text-align: right; font-weight: 700; }
                    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 4px solid #8B4513; padding-bottom: 20px; margin-bottom: 30px; }
                    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 40px; }
                    .stat-card { background: #f8f9fa; padding: 15px; border-radius: 10px; border-top: 4px solid #8B4513; }
                    .stat-label { font-size: 0.8rem; color: #666; margin-bottom: 5px; }
                    .stat-value { font-size: 1.2rem; font-weight: 700; }
                </style>
            </head>
            <body>
                 <div style="padding: 20px;">
                    ${html}
                 </div>
            </body>
        </html>
    `);

    printWindow.document.close();
    printWindow.onload = () => {
        printWindow.print();
        showToast('Rapport prêt', 'success');
    };
}

// ==========================================
// Inventory (Stock)
// ==========================================

function initInventoryPage() {
    loadData().then(() => {
        try {
            initTheme();
            renderInventoryCategories();
            renderInventoryGrid();
            renderAlerts();
            initInventorySearch();
            initProductModal();
        } catch (e) {
            console.error('Inventory Init Error:', e);
            showToast('Erreur lors du chargement de l\'inventaire', 'error');
        }
    });
}

function renderInventoryCategories() {
    const container = document.getElementById('categoryFilters');
    if (!container) return;

    container.innerHTML = `<button class="category-pill active" data-category="all">Tous</button>`;

    db.categories.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'category-pill drop-target';
        btn.dataset.category = cat.id;
        btn.textContent = `${cat.icon ? cat.icon + ' ' : ''}${cat.name}`;

        btn.onclick = () => {
            document.querySelectorAll('.category-pill').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            selectedCategory = cat.id;
            renderInventoryGrid();
        };

        btn.ondragover = (e) => {
            e.preventDefault();
            btn.classList.add('drag-over');
        };
        btn.ondragleave = () => {
            btn.classList.remove('drag-over');
        };
        btn.ondrop = (e) => {
            e.preventDefault();
            btn.classList.remove('drag-over');
            const productId = parseInt(e.dataTransfer.getData('text/plain'));
            moveProductToCategory(productId, cat.id);
        };

        container.appendChild(btn);
    });

    container.querySelector('[data-category="all"]').onclick = () => {
        document.querySelectorAll('.category-pill').forEach(p => p.classList.remove('active'));
        container.querySelector('[data-category="all"]').classList.add('active');
        selectedCategory = 'all';
        renderInventoryGrid();
    };
}

let draggedProductId = null;
let draggedType = null;
let currentReorderView = null; // 'vente', 'stock', 'production', 'recettes', 'achats', 'achatsForm'

function initViewOrders() {
    if (!db.viewOrders) db.viewOrders = {};
    const views = ['vente', 'stock', 'production', 'recettes', 'achats', 'achatsForm'];
    views.forEach(v => {
        if (!db.viewOrders[v]) db.viewOrders[v] = [];
    });
}

function getOrderedItems(items, viewKey) {
    if (!db.viewOrders || !db.viewOrders[viewKey] || db.viewOrders[viewKey].length === 0) {
        return [...items].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }
    const order = db.viewOrders[viewKey];
    return [...items].sort((a, b) => {
        let idxA = order.indexOf(a.id || a.productId);
        let idxB = order.indexOf(b.id || b.productId);
        if (idxA === -1) idxA = 999999;
        if (idxB === -1) idxB = 999999;
        return idxA - idxB;
    });
}

function handleDragStart(e, productId, type = 'product', viewKey = null) {
    draggedProductId = productId;
    draggedType = type;
    currentReorderView = viewKey;
    e.dataTransfer.setData('text/plain', productId);
    e.target.classList.add('dragging');

    if (!isReorderMode) {
        document.querySelectorAll('.category-pill.drop-target').forEach(pill => {
            pill.classList.add('can-accept');
        });
    }
}

function handleDragEnd(e) {
    e.target.classList.remove('dragging');
    draggedProductId = null;
    draggedType = null;
    currentReorderView = null;

    document.querySelectorAll('.category-pill').forEach(pill => {
        pill.classList.remove('can-accept', 'drag-over');
    });

    document.querySelectorAll('.product-card, .mosaic-card, .prod-pick-card, .comp-pick-card-lt').forEach(el => {
        el.classList.remove('drag-over-reorder');
    });
}

function handleProductDragOver(e) {
    if (!isReorderMode) return;
    e.preventDefault();
    e.currentTarget.classList.add('drag-over-reorder');
}

function handleProductDragLeave(e) {
    e.currentTarget.classList.remove('drag-over-reorder');
}

function handleProductDrop(e, targetId) {
    e.preventDefault();
    if (!isReorderMode || !draggedProductId || draggedProductId == targetId) return;

    initViewOrders();
    const viewKey = currentReorderView;
    if (!viewKey) {
        console.warn('handleProductDrop: No currentReorderView set');
        return;
    }

    let items = [];
    if (draggedType === 'product') items = db.products;
    else if (draggedType === 'recipe') items = db.recipes;
    else if (draggedType === 'component') items = db.components;

    let currentOrder = db.viewOrders[viewKey];
    if (currentOrder.length === 0) {
        currentOrder = items.map(item => item.id || item.productId);
    }

    const fromIndex = currentOrder.indexOf(draggedProductId);
    const toIndex = currentOrder.indexOf(targetId);

    if (fromIndex > -1 && toIndex > -1) {
        const [movedId] = currentOrder.splice(fromIndex, 1);
        currentOrder.splice(toIndex, 0, movedId);
        db.viewOrders[viewKey] = currentOrder;
        saveData();

        // Re-render appropriate grids
        if (document.getElementById('productsGrid')) renderProducts();
        if (document.getElementById('productsGridInventory')) renderInventoryGrid();
        if (document.getElementById('productsMosaic')) renderMosaic();
        if (typeof renderProdCards === 'function') renderProdCards();
    }
}

function toggleReorderMode() {
    isReorderMode = !isReorderMode;
    initViewOrders();
    const btn = document.getElementById('reorderBtn');
    if (btn) {
        btn.classList.toggle('active', isReorderMode);
        btn.innerHTML = isReorderMode ? '✅ Finir' : '🔃 <span class="btn-text">Réorganiser</span>';
        btn.style.background = isReorderMode ? 'var(--success)' : '';
        btn.style.color = isReorderMode ? 'white' : '';
    }

    if (isReorderMode) {
        showToast('Mode réorganisation activé : faites glisser les éléments pour changer l\'ordre', 'info');
    }

    // Refresh grids to apply draggable state
    if (document.getElementById('productsGrid')) renderProducts();
    if (document.getElementById('productsGridInventory')) renderInventoryGrid();
    if (document.getElementById('productsMosaic')) renderMosaic();
    if (typeof renderProdCards === 'function') renderProdCards();
}

function moveProductToCategory(productId, categoryId) {
    const product = getProductById(productId);
    if (!product) return;

    const oldCategory = getCategoryById(product.category);
    const newCategory = getCategoryById(categoryId);

    if (product.category === categoryId) {
        showToast(`${product.name} est déjà dans ${newCategory.name}`, 'info');
        return;
    }

    product.category = categoryId;
    saveData();
    renderInventoryGrid();
    renderInventoryCategories();
    renderAlerts();

    showToast(`${product.name} déplacé vers ${newCategory.icon ? newCategory.icon + ' ' : ''}${newCategory.name}`, 'success');
}

function renderInventoryGrid() {
    const container = document.getElementById('productsGridInventory');
    const total = document.getElementById('totalProducts');
    if (!container) return;

    let products = getOrderedItems(db.products, 'stock');
    if (selectedCategory !== 'all') {
        products = products.filter(p => p.category === selectedCategory);
    }

    const normalize = str => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const searchVal = document.getElementById('searchInput')?.value || "";
    const search = normalize(searchVal);

    if (search) {
        products = products.filter(p =>
            normalize(p.name || '').includes(search) ||
            getProductBarcode(p).includes(normalizeBarcodeValue(searchVal))
        );
    }

    if (total) total.textContent = products.length;

    if (!products.length) {
        container.innerHTML = `
            <div class="empty-state" style="grid-column:1/-1">
                <span class="icon">📦</span>
                <p class="text-muted">Aucun produit</p>
            </div>
        `;
        return;
    }

    // Clear container and use DocumentFragment for better performance
    container.innerHTML = '';
    const fragment = document.createDocumentFragment();

    // Batch processing for smooth rendering with many products
    const batchSize = 50;
    let index = 0;

    function renderBatch() {
        const end = Math.min(index + batchSize, products.length);

        for (let i = index; i < end; i++) {
            try {
                const p = products[i];
                const cat = getCategoryById(p.category);
                const price = formatPrice(p.price);
                const stock = p.stock || 0;
                const minStock = p.minStock || 10;

                const card = document.createElement('div');
                card.className = 'product-card draggable-product';
                card.dataset.productId = p.id;
                card.draggable = true;

                const expiryHtml = p.expiryDate ? `<div style="font-size: 0.65rem; color: ${isAboutToExpire(p.expiryDate) ? 'var(--danger)' : 'var(--text-light)'}; margin-bottom: 3px;">⌛ ${p.expiryDate}</div>` : '';

                card.innerHTML = `
                    <img src="${getProductImage(p)}" alt="${p.name}" class="product-image"
                         onerror="this.src='${getDefaultImage(p.category)}'" loading="lazy">
                    <button class="btn-icon-mini" title="Signaler expiré"
                            onclick="event.stopPropagation(); handleExpiredStock(${p.id})"
                            style="position: absolute; top: 8px; right: 8px; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.3); backdrop-filter: blur(8px); color: rgba(255,255,255,0.9); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; cursor: pointer; z-index: 10; transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"></circle>
                            <path d="M15 9l-6 6M9 9l6 6"></path>
                        </svg>
                    </button>
                    <div class="product-info">
                        <div class="product-name">${p.name}</div>
                        <div class="product-category-badge" style="font-size: 0.7rem; color: var(--text-light); margin-bottom: 4px;">
                            ${cat ? (cat.icon || '📦') + ' ' + (cat.name || '') : ''}
                        </div>
                        ${expiryHtml}
                        <div style="display: flex; gap: 4px; align-items: center; margin-top: 2px;">
                            <span class="product-price-badge" style="font-size: 0.8rem; font-weight: 700; color: var(--primary); background: rgba(74, 44, 42, 0.08); padding: 2px 6px; border-radius: 5px; display: inline-block;">${price}</span>
                            <div class="stock-badge ${stock <= 0 ? 'stock-out' : stock <= minStock ? 'stock-low' : 'stock-ok'}" style="padding: 2px 4px; min-width: auto;">
                                ${stock}
                            </div>
                        </div>
                    </div>
                    <div class="drag-hint" style="text-align: center; font-size: 0.65rem; color: var(--text-light); padding: 4px; border-top: 1px solid var(--border);">
                        Double-clic pour modifier
                    </div>
                `;

                // Add event handlers
                if (isReorderMode) {
                    card.draggable = true;
                    card.ondragstart = (e) => handleDragStart(e, p.id, 'product', 'stock');
                    card.ondragend = handleDragEnd;
                    card.ondragover = handleProductDragOver;
                    card.ondragleave = handleProductDragLeave;
                    card.ondrop = (e) => handleProductDrop(e, p.id);
                    card.style.cursor = 'move';
                    card.classList.add('reorder-active');
                } else {
                    card.onpointerdown = (e) => onCardDown(e, p.id, card, 'inventory');
                    card.onpointermove = onCardMove;
                    card.onpointerup = onCardUp;
                    card.onpointerleave = onCardUp;
                    card.ondragstart = (e) => handleDragStart(e, p.id);
                    card.ondragend = (e) => handleDragEnd(e);
                }

                fragment.appendChild(card);
            } catch (e) {
                console.error('Error rendering product:', e);
            }
        }

        index = end;

        if (index < products.length) {
            // More products to render, continue in next frame
            requestAnimationFrame(renderBatch);
        } else {
            // All done, append to container
            container.appendChild(fragment);
        }
    }

    // Start rendering
    renderBatch();
}

function renderAlerts() {
    const container = document.getElementById('alertsContainer');
    if (!container) return;

    const stockAlerts = db.products.filter(p => p.stock === 0 || p.stock <= p.minStock);
    const expiryAlerts = db.products.filter(p => p.expiryDate && isAboutToExpire(p.expiryDate));

    let html = '';

    stockAlerts.forEach(p => {
        html += `
            <div class="alert-card ${p.stock === 0 ? 'alert-danger' : 'alert-warning'}">
                <span class="alert-icon">${p.stock === 0 ? '🚨' : '⚠️'}</span>
                <div>
                    <div class="font-bold text-sm">${p.name}</div>
                    <div class="text-xs text-muted">${p.stock === 0 ? 'Rupture de stock!' : 'Stock faible: ' + p.stock + ' (Min: ' + p.minStock + ')'}</div>
                </div>
            </div>
        `;
    });

    expiryAlerts.forEach(p => {
        const date = new Date(p.expiryDate);
        const isExpired = date < new Date();
        html += `
            <div class="alert-card alert-danger">
                <span class="alert-icon">⌛</span>
                <div>
                    <div class="font-bold text-sm">${p.name}</div>
                    <div class="text-xs text-muted">${isExpired ? 'PRODUIT EXPIRÉ le ' + p.expiryDate : 'Expire bientôt: ' + p.expiryDate}</div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html || `
        <div style="text-align:center;padding:var(--space-2xl);opacity:0.5">
            <span style="font-size:48px">✅</span>
            <p class="text-sm mt-md">Tout va bien!</p>
        </div>
    `;
}

function initInventorySearch() {
    document.getElementById('searchInput')?.addEventListener('input', renderInventoryGrid);
}

function initProductModal() {
    const modal = document.getElementById('productModal');
    const form = document.getElementById('productForm');
    const categorySelect = document.getElementById('productCategory');

    if (!modal) return;

    if (categorySelect) {
        categorySelect.innerHTML = db.categories.map(c =>
            `<option value="${c.id}">${c.icon ? c.icon + ' ' : ''}${c.name}</option>`
        ).join('');
    }

    document.getElementById('addProductBtn')?.addEventListener('click', () => {
        modal.style.display = 'flex';
        modal.scrollTop = 0; // Ensure we start at the top for full-page
        resetImagePreview();
        if (window.selectedCategoryId && categorySelect) {
            categorySelect.value = window.selectedCategoryId;
        }
        document.querySelectorAll('#imageLibraryGrid .image-library-item').forEach(el => el.classList.remove('selected'));
    });

    const close = () => {
        modal.style.display = 'none';
        form?.reset();
        document.getElementById('productImage').value = '';
        resetImagePreview();
    };

    document.getElementById('closeModal')?.addEventListener('click', close);
    document.getElementById('cancelModal')?.addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    form?.addEventListener('submit', e => {
        e.preventDefault();

        const name = document.getElementById('productName').value;
        const barcode = normalizeBarcodeValue(document.getElementById('productBarcode')?.value || '');
        if (barcode && isBarcodeUsedByAnotherProduct(barcode)) {
            showToast('Ce code-barres est deja utilise par un autre produit', 'error');
            return;
        }

        const newProduct = {
            id: Date.now(),
            name: name,
            barcode,
            category: parseInt(document.getElementById('productCategory').value),
            price: parseFloat(document.getElementById('productPrice').value),
            purchasePrice: parseFloat(document.getElementById('productPurchasePrice').value) || 0,
            stock: parseInt(document.getElementById('productStock').value),
            minStock: parseInt(document.getElementById('productMinStock').value) || 10,
            expiryDate: document.getElementById('productExpiryDate').value || '',
            image: document.getElementById('productImage').value || '',
            isFavorite: false
        };

        db.products.push(newProduct);

        // Record initial stock as a purchase adjustment for accounting
        if (newProduct.stock > 0) {
            db.adjustments.unshift({
                id: Date.now() + 1,
                productId: newProduct.id,
                quantity: newProduct.stock,
                reason: 'Stock initial',
                date: new Date().toISOString(),
                user: 'Admin'
            });
        }

        saveData();
        close();
        renderInventoryGrid();
        renderInventoryCategories();
        renderAlerts();

        showToast(`${name} ajouté avec succès!`, 'success');
    });
}

function resetImagePreview() {
    const area = document.getElementById('imageUploadArea');
    const preview = document.getElementById('imagePreviewContainer');
    if (area) area.classList.remove('has-image');
    if (preview) preview.innerHTML = '<span class="upload-icon">📷</span><p class="text-sm text-muted">Cliquez pour ajouter une image</p>';
}

function editProduct(productId) {
    const product = getProductById(productId);
    if (!product) return;

    const modal = document.getElementById('editStockModal');
    if (!modal) return;

    document.getElementById('editProductId').value = productId;
    document.getElementById('editProductNameInput').value = product.name;
    const editBarcodeInput = document.getElementById('editProductBarcode');
    if (editBarcodeInput) editBarcodeInput.value = product.barcode || product.code || product.sku || product.ean || '';
    document.getElementById('editNewStock').value = product.stock;
    document.getElementById('editProductPrice').value = product.price;
    document.getElementById('editProductPurchasePrice').value = product.purchasePrice !== undefined && product.purchasePrice !== null ? product.purchasePrice : '';
    document.getElementById('editProductMinStock').value = product.minStock || 10;
    document.getElementById('editProductExpiryDate').value = product.expiryDate || '';
    document.getElementById('editProductImage').value = product.image || '';

    const categorySelect = document.getElementById('editProductCategory');
    if (categorySelect) {
        categorySelect.innerHTML = db.categories.map(c =>
            `<option value="${c.id}" ${c.id === product.category ? 'selected' : ''}>${c.icon ? c.icon + ' ' : ''}${c.name}</option>`
        ).join('');
    }

    const imageArea = document.getElementById('editImageUploadArea');
    const imagePreview = document.getElementById('editImagePreviewContainer');
    if (product.image && product.image.trim()) {
        imageArea.classList.add('has-image');
        imagePreview.innerHTML = `<img src="${product.image}" alt="${product.name}">`;
    } else {
        imageArea.classList.remove('has-image');
        imagePreview.innerHTML = '<span class="upload-icon">📷</span><p class="text-sm text-muted">Cliquez pour modifier l\'image</p>';
    }

    document.querySelectorAll('#editImageLibraryGrid .image-library-item').forEach(el => {
        el.classList.remove('selected');
        if (product.image && el.dataset.path === product.image) {
            el.classList.add('selected');
        }
    });

    const imageInput = document.getElementById('editProductImageFile');
    if (imageInput) {
        imageInput.onchange = function (e) {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function (e) {
                    imageArea.classList.add('has-image');
                    imagePreview.innerHTML = `<img src="${e.target.result}" alt="Preview">`;
                    document.getElementById('editProductImage').value = e.target.result;
                };
                reader.readAsDataURL(file);
            }
        };
    }

    modal.style.display = 'flex';
    modal.scrollTop = 0; // Ensure we start at the top for full-page
}

let inventoryClickTimer = null;

function handleProductInventoryClick(event, productId) {
    // If user was scrolling (touch moved), ignore the click
    if (globalTouchMoved) {
        return;
    }

    if (inventoryClickTimer === null) {
        inventoryClickTimer = setTimeout(() => {
            inventoryClickTimer = null;
            handleQuickAddStock(productId);
        }, 300);
    } else {
        clearTimeout(inventoryClickTimer);
        inventoryClickTimer = null;
        editProduct(productId);
    }
}

function handleQuickAddStock(productId) {
    const product = getProductById(productId);
    if (!product) return;

    const modal = document.getElementById('quickAddStockModal');
    if (!modal) return;

    document.getElementById('quickAddProductId').value = productId;
    document.getElementById('quickAddProductName').textContent = product.name;
    document.getElementById('quickAddCurrentStock').textContent = `Stock actuel: ${product.stock}`;
    document.getElementById('quickAddQtyInput').value = 1;

    const img = document.getElementById('quickAddProductImage');
    if (img) {
        img.src = getProductImage(product);
        img.onerror = () => img.src = getDefaultImage(product.category);
    }

    modal.style.display = 'flex';

    const close = () => modal.style.display = 'none';
    document.getElementById('closeQuickAddModal').onclick = close;
    document.getElementById('cancelQuickAddBtn').onclick = close;

    document.getElementById('confirmQuickAddBtn').onclick = () => {
        const qty = parseInt(document.getElementById('quickAddQtyInput').value);
        if (isNaN(qty) || qty <= 0) {
            showToast('Quantité invalide', 'error');
            return;
        }

        // If product has a recipe, attempt to consume components accordingly
        const recipe = (db.recipes || []).find(r => r.productId === productId);
        if (recipe && recipe.ingredients && recipe.ingredients.length) {
            // Verify availability
            for (const ing of recipe.ingredients) {
                const required = ing.quantity * qty;
                const available = (db.lots || []).filter(l => l.componentId === ing.componentId)
                    .reduce((s, l) => s + (parseFloat(l.remainingQty || l.quantity || 0)), 0);
                if (available < required) {
                    const comp = (db.components || []).find(c => c.id === ing.componentId);
                    showToast(`Matières premières insuffisantes: ${comp ? comp.name : 'un composant'}`, 'error');
                    return;
                }
            }

            // Deduct FIFO from lots
            let totalCompCost = 0;
            const unitsDivisor = parseFloat(recipe.unitsDivisor) || 1;
            recipe.ingredients.forEach(ing => {
                let remaining = (ing.quantity / unitsDivisor) * qty;
                const availableLots = (db.lots || []).filter(l => l.componentId === ing.componentId && (l.remainingQty || l.quantity) > 0)
                    .sort((a, b) => new Date(a.date) - new Date(b.date));
                availableLots.forEach(lot => {
                    if (remaining <= 0) return;
                    const canUse = Math.min(remaining, lot.remainingQty || lot.quantity);
                    lot.remainingQty = parseFloat(((lot.remainingQty || lot.quantity) - canUse).toFixed(4));
                    remaining = parseFloat((remaining - canUse).toFixed(4));
                });
                const unitPrice = (typeof getWeightedAverageCost === 'function') ? getWeightedAverageCost(ing.componentId) : 0;
                totalCompCost += unitPrice * (ing.quantity / unitsDivisor) * qty;
            });

            const fixedFees = (parseFloat(product.purchasePrice) || 0) / unitsDivisor;
            totalCompCost += fixedFees * qty;

            // Record a production entry for traceability
            if (!db.productions) db.productions = [];
            db.productions.push({
                id: Date.now() + Math.random(),
                productId: productId,
                quantity: qty,
                totalCost: parseFloat(totalCompCost.toFixed(2)),
                unitCost: parseFloat((totalCompCost / qty).toFixed(2)),
                date: new Date().toISOString(),
                note: 'Ajout stock via réapprovisionnement (consommation MP)'
            });
        }

        // Add to product stock and record adjustment
        product.stock += qty;

        db.adjustments.unshift({
            id: Date.now(),
            productId: product.id,
            quantity: qty,
            reason: 'Réapprovisionnement rapide',
            date: new Date().toISOString(),
            user: 'Admin'
        });

        saveData();
        close();
        renderInventoryGrid();
        renderAlerts();
        showToast(`${qty} unité(s) ajoutée(s) à ${product.name}`, 'success');
    };
}

function saveEditStock() {
    const productId = parseInt(document.getElementById('editProductId').value);
    const product = getProductById(productId);

    if (!product) return;

    const newName = document.getElementById('editProductNameInput').value.trim();
    const newBarcode = normalizeBarcodeValue(document.getElementById('editProductBarcode')?.value || '');
    const newCategory = parseInt(document.getElementById('editProductCategory').value);
    const newPrice = parseFloat(document.getElementById('editProductPrice').value);
    const newPurchasePrice = parseFloat(document.getElementById('editProductPurchasePrice').value) || 0;
    const newStock = parseInt(document.getElementById('editNewStock').value);
    const newMinStock = parseInt(document.getElementById('editProductMinStock').value);
    const newExpiryDate = document.getElementById('editProductExpiryDate').value || '';
    const newImage = document.getElementById('editProductImage').value;

    if (!newName || isNaN(newPrice) || isNaN(newStock) || isNaN(newMinStock)) {
        showToast('Veuillez remplir tous les champs correctement', 'error');
        return;
    }
    if (newBarcode && isBarcodeUsedByAnotherProduct(newBarcode, productId)) {
        showToast('Ce code-barres est deja utilise par un autre produit', 'error');
        return;
    }

    const stockDiff = newStock - product.stock;
    if (stockDiff !== 0) {
        db.adjustments.unshift({
            id: Date.now(),
            productId: productId,
            quantity: stockDiff,
            reason: 'Correction manuelle',
            date: new Date().toISOString(),
            user: 'Admin'
        });
    }

    product.name = newName;
    product.barcode = newBarcode;
    product.category = newCategory;
    product.price = newPrice;
    product.purchasePrice = newPurchasePrice;
    product.stock = newStock;
    product.minStock = newMinStock;
    product.expiryDate = newExpiryDate;
    product.image = newImage;

    saveData();
    renderInventoryGrid();
    renderInventoryCategories();
    renderAlerts();
    closeEditStockModal();
    showToast(`${newName} mis à jour avec succès!`, 'success');
}

function closeEditStockModal() {
    const modal = document.getElementById('editStockModal');
    if (modal) modal.style.display = 'none';
}

function initEditStockModal() {
    const modal = document.getElementById('editStockModal');
    if (!modal) return;

    document.getElementById('saveEditStockBtn')?.addEventListener('click', saveEditStock);
    document.getElementById('closeEditStockModal')?.addEventListener('click', closeEditStockModal);
    document.getElementById('cancelEditStockBtn')?.addEventListener('click', closeEditStockModal);
    document.getElementById('deleteProductBtn')?.addEventListener('click', deleteProduct);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeEditStockModal(); });
}

function deleteProduct() {
    const productId = parseInt(document.getElementById('editProductId').value);
    const product = getProductById(productId);
    if (!product) return;
    const modal = document.getElementById('deleteConfirmModal');
    if (!modal) return;
    document.getElementById('deleteConfirmText').textContent = `Supprimer "${product.name}" ? Cette action est irréversible.`;
    document.getElementById('deleteTargetProductId').value = productId;
    modal.style.display = 'flex';
}

function confirmDelete() {
    const productId = parseInt(document.getElementById('deleteTargetProductId').value);
    const product = getProductById(productId);
    if (!product) return;
    db.products = db.products.filter(p => p.id !== productId);
    saveData();
    renderInventoryGrid();
    renderInventoryCategories();
    renderAlerts();
    closeEditStockModal();
    closeDeleteConfirmModal();
    showToast(`${product.name} supprimé`, 'success');
}

function closeDeleteConfirmModal() {
    const modal = document.getElementById('deleteConfirmModal');
    if (modal) modal.style.display = 'none';
}

function initDeleteConfirmModal() {
    document.getElementById('confirmDeleteBtn')?.addEventListener('click', confirmDelete);
    document.getElementById('cancelDeleteBtn')?.addEventListener('click', closeDeleteConfirmModal);
    document.getElementById('closeDeleteConfirm')?.addEventListener('click', closeDeleteConfirmModal);
    const modal = document.getElementById('deleteConfirmModal');
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeDeleteConfirmModal(); });
}

// ==========================================
// Statistics Page
// ==========================================

let currentStatsPeriod = 'day';
let _currentDashOrders = []; // Stores current filtered orders for search
let statsUpdateToken = 0;
const STATS_EXTERNAL_SCRIPTS = [
    { key: 'html2pdf', globalName: 'html2pdf', src: 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js' },
    { key: 'chartjs', globalName: 'Chart', src: 'https://cdn.jsdelivr.net/npm/chart.js' },
    { key: 'sweetalert', globalName: 'Swal', src: 'https://cdn.jsdelivr.net/npm/sweetalert2@11' }
];

function loadStatsExternalScripts() {
    STATS_EXTERNAL_SCRIPTS.forEach(({ key, globalName, src }) => {
        if (window[globalName] || document.querySelector(`script[data-stats-lib="${key}"]`)) return;

        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.dataset.statsLib = key;
        if (key === 'chartjs') {
            script.addEventListener('load', () => renderWithdrawalsVsProfitChart(currentStatsPeriod));
        }
        document.head.appendChild(script);
    });
}

function initStatsPage() {
    loadData().then(() => {
        try {
            console.log("Système : Initialisation de la page statistiques avec", db.orders?.length || 0, "commandes et", db.products?.length || 0, "produits");
            initTheme();
            initPeriodFilter();
            renderStockOverview();
            updateStatsForPeriod(currentStatsPeriod);
            initOrdersSearch();
            setTimeout(loadStatsExternalScripts, 0);
        } catch (err) {
            console.error("Erreur lors de l'initialisation des statistiques :", err);
            showToast("Erreur d'affichage des statistiques", "error");
        }
    });
}

function initPeriodFilter() {
    const filterContainer = document.getElementById('periodFilter');
    if (!filterContainer) return;

    filterContainer.querySelectorAll('.stats-filter-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            filterContainer.querySelectorAll('.stats-filter-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Reset date inputs if preset selected
            const startInput = document.getElementById('dashFilterStart');
            const endInput = document.getElementById('dashFilterEnd');
            if (startInput) startInput.value = '';
            if (endInput) endInput.value = '';

            currentStatsPeriod = tab.dataset.period;
            updateStatsForPeriod(currentStatsPeriod);
        });
    });
}

function updateDashWithRange() {
    const start = document.getElementById('dashFilterStart')?.value;
    const end = document.getElementById('dashFilterEnd')?.value;

    if (start && end) {
        // Deactivate preset tabs
        document.querySelectorAll('#periodFilter .stats-filter-tab').forEach(t => t.classList.remove('active'));
        currentStatsPeriod = 'range';
        updateStatsForPeriod('range');
    }
}

function getFilteredOrders(period) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (period === 'range') {
        const start = new Date(document.getElementById('dashFilterStart').value);
        const end = new Date(document.getElementById('dashFilterEnd').value);
        end.setHours(23, 59, 59, 999);
        return db.orders.filter(o => {
            const d = new Date(o.date);
            return d >= start && d <= end;
        });
    }

    switch (period) {
        case 'day':
            return db.orders.filter(o => new Date(o.date) >= today);
        case 'week':
            // Custom week: Saturday to Friday
            // Find the most recent Saturday
            const lastSat = new Date(today);
            const day = today.getDay(); // 0 is Sunday, 6 is Saturday
            // If today is Sat(6), diff is 0. If Sun(0), diff is 1. If Mon(1), diff is 2...
            const diffToSat = (day + 1) % 7;
            lastSat.setDate(today.getDate() - diffToSat);
            lastSat.setHours(0, 0, 0, 0);
            return db.orders.filter(o => new Date(o.date) >= lastSat);
        case 'month':
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            return db.orders.filter(o => new Date(o.date) >= monthStart);
        case 'year':
            const yearStart = new Date(now.getFullYear(), 0, 1);
            return db.orders.filter(o => new Date(o.date) >= yearStart);
        case 'all':
        default:
            return db.orders;
    }
}

function getFilteredAdjustments(period) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (period === 'range') {
        const start = new Date(document.getElementById('dashFilterStart')?.value || document.getElementById('moveStart')?.value);
        const end = new Date(document.getElementById('dashFilterEnd')?.value || document.getElementById('moveEnd')?.value);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return db.adjustments;
        end.setHours(23, 59, 59, 999);
        return db.adjustments.filter(a => {
            const d = new Date(a.date);
            return d >= start && d <= end;
        });
    }

    switch (period) {
        case 'day':
            return db.adjustments.filter(a => new Date(a.date) >= today);
        case 'week':
            const lastSatAdj = new Date(today);
            const dayAdj = today.getDay();
            const diffToSatAdj = (dayAdj + 1) % 7;
            lastSatAdj.setDate(today.getDate() - diffToSatAdj);
            lastSatAdj.setHours(0, 0, 0, 0);
            return db.adjustments.filter(a => new Date(a.date) >= lastSatAdj);
        case 'month':
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            return db.adjustments.filter(a => new Date(a.date) >= monthStart);
        case 'year':
            const yearStart = new Date(now.getFullYear(), 0, 1);
            return db.adjustments.filter(a => new Date(a.date) >= yearStart);
        case 'all':
        default:
            return db.adjustments;
    }
}

function getFilteredLots(period) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (period === 'range') {
        const startStr = document.getElementById('dashFilterStart')?.value;
        const endStr = document.getElementById('dashFilterEnd')?.value;
        if (!startStr || !endStr) return db.lots || [];
        const start = new Date(startStr);
        const end = new Date(endStr);
        end.setHours(23, 59, 59, 999);
        return (db.lots || []).filter(l => {
            const d = new Date(l.date);
            return d >= start && d <= end;
        });
    }

    switch (period) {
        case 'day':
            return (db.lots || []).filter(l => new Date(l.date) >= today);
        case 'week':
            const lastSatLot = new Date(today);
            const dayLot = today.getDay();
            const diffToSatLot = (dayLot + 1) % 7;
            lastSatLot.setDate(today.getDate() - diffToSatLot);
            lastSatLot.setHours(0, 0, 0, 0);
            return (db.lots || []).filter(l => new Date(l.date) >= lastSatLot);
        case 'month':
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            return (db.lots || []).filter(l => new Date(l.date) >= monthStart);
        case 'year':
            const yearStart = new Date(now.getFullYear(), 0, 1);
            return (db.lots || []).filter(l => new Date(l.date) >= yearStart);
        case 'all':
        default:
            return db.lots || [];
    }
}

function getFilteredWithdrawals(period) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (period === 'range') {
        const startStr = document.getElementById('dashFilterStart')?.value;
        const endStr = document.getElementById('dashFilterEnd')?.value;
        if (!startStr || !endStr) return db.withdrawals || [];
        const start = new Date(startStr);
        const end = new Date(endStr);
        end.setHours(23, 59, 59, 999);
        return (db.withdrawals || []).filter(w => {
            const d = new Date(w.date);
            return d >= start && d <= end;
        });
    }

    switch (period) {
        case 'day':
            return (db.withdrawals || []).filter(w => new Date(w.date) >= today);
        case 'week':
            const lastSatWith = new Date(today);
            const dayWith = today.getDay();
            const diffToSatWith = (dayWith + 1) % 7;
            lastSatWith.setDate(today.getDate() - diffToSatWith);
            lastSatWith.setHours(0, 0, 0, 0);
            return (db.withdrawals || []).filter(w => new Date(w.date) >= lastSatWith);
        case 'month':
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            return (db.withdrawals || []).filter(w => new Date(w.date) >= monthStart);
        case 'year':
            const yearStart = new Date(now.getFullYear(), 0, 1);
            return (db.withdrawals || []).filter(w => new Date(w.date) >= yearStart);
        case 'all':
        default:
            return db.withdrawals || [];
    }
}

function renderMovements() {
    const filter = document.getElementById('moveFilter')?.value || 'all';
    const rangeInputs = document.getElementById('moveRangeInputs');

    if (rangeInputs) {
        rangeInputs.style.display = filter === 'range' ? 'flex' : 'none';
    }

    let adjustments = getFilteredAdjustments(filter);

    const container = document.getElementById('movementsTableBody');
    if (!container) return;

    container.innerHTML = adjustments.map(a => {
        const p = getProductById(a.productId);
        return `
            <tr>
                <td>${formatDate(a.date)}</td>
                <td style="font-weight:600">${p ? p.name : '—'}</td>
                <td>
                    <span class="badge ${a.quantity > 0 ? 'success' : 'danger'}">
                        ${a.quantity > 0 ? 'ENTRÉE' : 'SORTIE'}
                    </span>
                </td>
                <td style="font-weight:700; color:${a.quantity > 0 ? 'var(--accent)' : 'var(--danger)'}">
                    ${a.quantity > 0 ? '+' : ''}${a.quantity}
                </td>
                <td class="text-xs">${a.reason}</td>
            </tr>
        `;
    }).join('');

    if (!adjustments.length) {
        container.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-light)">Aucun mouvement trouvé</td></tr>';
    }
}
function resetProfitData() {
    if (typeof Swal === 'undefined') {
        if (!confirm("Reinitialiser toutes les donnees ? Cette action effacera les ventes, les mouvements de stock et l'historique.")) return;
        db.orders = [];
        db.adjustments = [];
        db.withdrawals = [];
        saveData();
        location.reload();
        return;
    }

    Swal.fire({
        title: 'Réinitialiser toutes les données ?',
        text: "Cela effacera les ventes, les mouvements de stock et l'historique. Cette action est irréversible !",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Oui, tout effacer',
        cancelButtonText: 'Annuler'
    }).then((result) => {
        if (result.isConfirmed) {
            db.orders = [];
            db.adjustments = [];
            db.withdrawals = [];
            saveData();
            Swal.fire('Réinitialisé !', 'Toutes les données ont été effacées.', 'success').then(() => {
                location.reload();
            });
        }
    });
}

function deleteTodaysSales() {
    if (typeof Swal === 'undefined') {
        if (!confirm("Supprimer les ventes d'aujourd'hui ? Cette action est irreversible.")) return;
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        db.orders = db.orders.filter(o => new Date(o.date) < today);
        saveDataImmediate();
        location.reload();
        return;
    }

    Swal.fire({
        title: "Supprimer les ventes d'aujourd'hui ?",
        text: "Cela effacera définitivement toutes les ventes enregistrées aujourd'hui. Cette action est irréversible !",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Oui, supprimer',
        cancelButtonText: 'Annuler'
    }).then((result) => {
        if (result.isConfirmed) {
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            db.orders = db.orders.filter(o => new Date(o.date) < today);
            saveDataImmediate();
            Swal.fire('Supprimé !', "Les ventes d'aujourd'hui ont été supprimées.", 'success').then(() => {
                location.reload();
            });
        }
    });
}

function handleExpiredStock(productId) {
    const p = getProductById(productId);
    if (!p) return;
    const modal = document.getElementById('expiredStockModal');
    if (!modal) return;
    document.getElementById('expiredProductName').textContent = `Produit: ${p.name}`;
    document.getElementById('expiredQtyInput').value = 1;
    modal.style.display = 'flex';
    const closeModal = () => modal.style.display = 'none';
    document.getElementById('closeExpiredModal').onclick = closeModal;
    document.getElementById('cancelExpiredBtn').onclick = closeModal;
    document.getElementById('confirmExpiredBtn').onclick = () => {
        const num = parseInt(document.getElementById('expiredQtyInput').value);
        if (isNaN(num) || num <= 0) {
            showToast('Quantité invalide', 'error');
            return;
        }
        if (num > p.stock) {
            showToast("Dépasse le stock actuel", 'error');
            return;
        }
        p.stock -= num;

        // Log adjustment
        db.adjustments.unshift({
            id: Date.now(),
            productId: p.id,
            quantity: -num,
            reason: 'Produit expiré',
            date: new Date().toISOString(),
            user: 'Admin'
        });

        saveData();
        closeModal();
        renderInventoryGrid();
        renderAlerts();
        showToast(`${num} unité(s) de ${p.name} retirées (expiré)`, 'success');
    };
}

function updateStatsForPeriod(period) {
    try {
        const updateToken = ++statsUpdateToken;
        const orders = getFilteredOrders(period);
        const adjustments = getFilteredAdjustments(period);
        const costContext = createCostLookupContext();

        const totalSales = orders.reduce((sum, o) => sum + getOrderNetTotal(o), 0);
        const totalOrders = orders.filter(order => getOrderNetTotal(order) > 0).length;

        // CASH PROFIT Calculation:
        // Profit = (Total Revenue from Sales) - (Total Expenses from Purchases)
        let totalRevenue = totalSales;
        let totalExpenses = 0;

        // Calculate cost of goods sold (from recipes or purchasePrice)
        let costOfGoodsSold = 0;
        try {
            costOfGoodsSold = calculateCostsForOrders(orders, costContext);
        } catch (costErr) {
            console.warn("Calculations cost warning:", costErr);
        }

        adjustments.forEach(adj => {
            if (adj.quantity > 0) {
                const product = getProductById(adj.productId);
                if (product) {
                    totalExpenses += adj.quantity * (product.purchasePrice || 0);
                }
            }
        });

        // Component expenses (Lots)
        const lots = getFilteredLots(period);
        let totalLotsCost = 0;
        lots.forEach(lot => {
            totalLotsCost += lot.totalPrice || 0;
        });

        // CASH FLOW Calculation (Option B):
        // Total expenses represent actual money spent during this period:
        // 1. Money spent on components (Lots)
        // 2. Money spent on stock additions (Adjustments > 0)
        const totalExpensesGlobal = totalExpenses + totalLotsCost;

        const expiredSum = adjustments
            .filter(adj => adj.reason === 'Produit expiré')
            .reduce((sum, adj) => sum + Math.abs(adj.quantity), 0);

        const withdrawals = getFilteredWithdrawals(period);
        const totalProfitWithdrawals = withdrawals
            .filter(w => w.category === 'profit')
            .reduce((sum, w) => sum + w.amount, 0);

        const totalPeriodWithdrawals = withdrawals
            .filter(w => {
                const cat = String(w.category || '').toLowerCase().trim();
                return cat !== 'ajout';
            })
            .reduce((sum, w) => sum + (parseFloat(w.amount) || 0), 0);

        const caisseTotal = getCurrentCaisseBalance();

        // Profit based on sold products:
        // revenue minus the purchase cost of the units sold, not the purchases made during the period.
        const grossSalesProfit = totalRevenue - costOfGoodsSold;
        const netSalesProfit = grossSalesProfit - totalPeriodWithdrawals;
        const profitNetGlobal = netSalesProfit;
        const profitNetSales = grossSalesProfit;

        const periodLabels = {
            day: "(Aujourd'hui)",
            week: "(Cette semaine)",
            month: "(Ce mois)",
            year: "(Cette année)",
            all: "(Depuis le début)"
        };
        const periodLabel = periodLabels[period] || "";

        const els = {
            periodSales: document.getElementById('periodSales'),
            periodOrders: document.getElementById('periodOrders'),
            periodProfit: document.getElementById('periodProfit'),
            periodProfitNet: document.getElementById('periodProfitNet'),
            itemsSold: document.getElementById('itemsSold'),
            ordersCount: document.getElementById('ordersCount'),
            movementsCount: document.getElementById('movementsCount'),
            salesPeriodLabel: document.getElementById('salesPeriodLabel'),
            movementsPeriodLabel: document.getElementById('movementsPeriodLabel'),
            marginBrut: document.getElementById('marginBrut'),
            marginNet: document.getElementById('marginNet'),
            marginBrutDetail: document.getElementById('marginBrutDetail'),
            marginNetDetail: document.getElementById('marginNetDetail'),
            marginPeriodLabel: document.getElementById('marginPeriodLabel')
        };

        if (els.periodSales) els.periodSales.textContent = formatPrice(totalSales);
        if (els.periodOrders) els.periodOrders.textContent = totalOrders;

        if (els.periodProfit) {
            els.periodProfit.textContent = formatPrice(profitNetSales);
            els.periodProfit.style.color = profitNetSales < 0 ? 'var(--danger)' : 'var(--success)';
        }
        if (els.periodProfitNet) {
            els.periodProfitNet.textContent = formatPrice(profitNetGlobal);
            els.periodProfitNet.style.color = profitNetGlobal < 0 ? 'var(--danger)' : 'var(--success)';
        }

        // Calculate and update Margins
        const margeBrut = grossSalesProfit;
        const margeNet = netSalesProfit;

        if (els.marginBrut) {
            els.marginBrut.textContent = formatPrice(margeBrut);
            els.marginBrut.style.color = margeBrut < 0 ? 'var(--danger)' : '#2e7d32';
        }
        if (els.marginNet) {
            els.marginNet.textContent = formatPrice(margeNet);
            els.marginNet.style.color = margeNet < 0 ? 'var(--danger)' : '#1565c0';
        }
        if (els.marginBrutDetail) {
            els.marginBrutDetail.textContent = `${formatPrice(totalSales)} ventes - ${formatPrice(costOfGoodsSold)} prix d'achat`;
        }
        if (els.marginNetDetail) {
            els.marginNetDetail.textContent = `${formatPrice(margeBrut)} marge brute - ${formatPrice(totalPeriodWithdrawals)} retraits/charges`;
        }
        if (els.marginPeriodLabel) els.marginPeriodLabel.textContent = periodLabel;

        if (els.itemsSold) els.itemsSold.textContent = expiredSum; // Now represents "Pertes"
        if (document.getElementById('caisseTotal')) {
            document.getElementById('caisseTotal').textContent = formatPrice(caisseTotal);
        }

        if (els.ordersCount) els.ordersCount.textContent = `${totalOrders} ventes`;
        if (els.movementsCount) els.movementsCount.textContent = `${adjustments.length} mouvements`;
        if (els.salesPeriodLabel) els.salesPeriodLabel.textContent = periodLabel;
        if (els.movementsPeriodLabel) els.movementsPeriodLabel.textContent = periodLabel;

        renderOrdersTableFiltered(orders);
        renderTopProductsFiltered(orders);
        requestAnimationFrame(() => {
            if (updateToken !== statsUpdateToken) return;
            renderClientPurchaseStats(orders);
            renderAdjustmentsTableFiltered(adjustments);
            renderWithdrawalsVsProfitChart(period);
        });
    } catch (err) {
        console.error("Erreur dans updateStatsForPeriod :", err);
    }
}

function renderStockOverview() {
    const totalProducts = db.products.length;
    const totalStock = db.products.reduce((sum, p) => sum + p.stock, 0);
    // Calcul de la somme des quantités de produits expirés enregistrés dans les mouvements de stock
    const expiredCount = db.adjustments
        .filter(adj => adj.reason === 'Produit expiré')
        .reduce((sum, adj) => sum + Math.abs(adj.quantity), 0);
    const outOfStock = db.products.filter(p => p.stock === 0).length;
    const stockValue = db.products.reduce((sum, p) => sum + (p.stock * p.price), 0);


    const els = {
        totalProducts: document.getElementById('totalProducts'),
        totalStock: document.getElementById('totalStock'),
        lowStockCount: document.getElementById('lowStockCount'),
        outOfStockCount: document.getElementById('outOfStockCount'),
        stockValue: document.getElementById('stockValue')
    };

    if (els.totalProducts) els.totalProducts.textContent = totalProducts;
    if (els.totalStock) els.totalStock.textContent = totalStock;
    if (els.lowStockCount) els.lowStockCount.textContent = expiredCount;
    if (els.outOfStockCount) els.outOfStockCount.textContent = outOfStock;
    if (els.stockValue) els.stockValue.textContent = formatPrice(stockValue);
}

let statsChart = null;
let statsChartRetryTimer = null;
let statsChartRetryCount = 0;

function calculateCostsForOrders(orders, costContext = null) {
    let costs = 0;
    orders.forEach(o => {
        if (!o.items) return;
        o.items.forEach(item => {
            const quantity = getOrderNetQuantity(o, item);
            const itemCost = getSaleUnitCost(item, null, costContext);
            costs += quantity * itemCost;
        });
    });
    return costs;
}

function getLegacyAggregatedChartData(period) {
    const now = new Date();
    const labels = [];
    const profits = [];
    const withdrawalsData = [];

    let daysToShow = 7;
    if (period === 'day') daysToShow = 7; // Show last 7 days for context
    else if (period === 'week') daysToShow = 7;
    else if (period === 'month') daysToShow = 30;
    else if (period === 'all' || period === 'year') {
        const monthsInFrench = ['Jan', 'Féb', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
        for (let i = 0; i < 12; i++) {
            const m = (now.getMonth() - (11 - i) + 12) % 12;
            const y = now.getFullYear() - (m > now.getMonth() ? 1 : 0);

            labels.push(monthsInFrench[m]);

            const monthOrders = db.orders.filter(o => {
                const d = new Date(o.date);
                return d.getFullYear() === y && d.getMonth() === m;
            });
            const monthWithdrawals = (db.withdrawals || []).filter(w => {
                const d = new Date(w.date);
                return d.getFullYear() === y && d.getMonth() === m;
            });

            const revenue = monthOrders.reduce((sum, o) => sum + getOrderNetTotal(o), 0);

            // Calculate total expenses for the month (Purchases of products + components)
            const monthAdjustments = db.adjustments.filter(a => {
                const d = new Date(a.date);
                return d.getFullYear() === y && d.getMonth() === m && a.quantity > 0;
            });
            const monthLots = (db.lots || []).filter(l => {
                const d = new Date(l.date);
                return d.getFullYear() === y && d.getMonth() === m;
            });

            let monthExpenses = monthAdjustments.reduce((sum, adj) => {
                const p = getProductById(adj.productId);
                return sum + (adj.quantity * (p?.purchasePrice || 0));
            }, 0);
            monthExpenses += monthLots.reduce((sum, l) => sum + (l.totalPrice || 0), 0);

            const totalW = monthWithdrawals
                .filter(w => ['retrait', 'caisse', 'profit', 'retrait bénéfice'].includes(String(w.category || '').toLowerCase().trim()))
                .reduce((sum, w) => sum + (parseFloat(w.amount) || 0), 0);

            profits.push(Number(revenue.toFixed(2))); // Now labels as Ventes
            withdrawalsData.push(Number(monthExpenses.toFixed(2))); // Now labeled as Achats
        }
        return { labels, revenues: profits, expenses: withdrawalsData };
    }

    for (let i = daysToShow - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        d.setHours(0, 0, 0, 0);

        labels.push(d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }));

        const dayOrders = db.orders.filter(o => {
            const od = new Date(o.date);
            od.setHours(0, 0, 0, 0);
            return od.getTime() === d.getTime();
        });

        const dayWithdrawals = (db.withdrawals || []).filter(w => {
            const wd = new Date(w.date);
            wd.setHours(0, 0, 0, 0);
            return wd.getTime() === d.getTime();
        });

        const revenue = dayOrders.reduce((sum, o) => sum + getOrderNetTotal(o), 0);

        // Calculate total expenses for the day (Purchases of products + components)
        const dayAdjustments = db.adjustments.filter(a => {
            const od = new Date(a.date);
            od.setHours(0, 0, 0, 0);
            return od.getTime() === d.getTime() && a.quantity > 0;
        });
        const dayLots = (db.lots || []).filter(l => {
            const ld = new Date(l.date);
            ld.setHours(0, 0, 0, 0);
            return ld.getTime() === d.getTime();
        });

        let dayExpenses = dayAdjustments.reduce((sum, adj) => {
            const prod = getProductById(adj.productId);
            return sum + (adj.quantity * (prod?.purchasePrice || 0));
        }, 0);
        dayExpenses += dayLots.reduce((sum, lot) => sum + (lot.totalPrice || 0), 0);

        const totalW = dayWithdrawals
            .filter(w => ['retrait', 'caisse', 'profit', 'retrait bénéfice'].includes(String(w.category || '').toLowerCase().trim()))
            .reduce((sum, w) => sum + (parseFloat(w.amount) || 0), 0);

        profits.push(Number(revenue.toFixed(2))); // Now labeled as Ventes
        withdrawalsData.push(Number(dayExpenses.toFixed(2))); // Now labeled as Achats
    }

    return { labels, revenues: profits, expenses: withdrawalsData };
}

function getStatsDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function getStatsLocalDate(value, endOfDay = false) {
    if (!value) return null;
    const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00'}`);
    return Number.isNaN(date.getTime()) ? null : date;
}

function getStatsBucketTotals(start, end) {
    const isInside = value => {
        const date = getStatsDate(value);
        return date && date >= start && date <= end;
    };

    const revenue = (db.orders || [])
        .filter(order => isInside(order.date))
        .reduce((sum, order) => sum + getOrderNetTotal(order), 0);

    const purchaseInvoices = (db.purchaseInvoices || [])
        .filter(invoice => invoice.status !== 'cancelled' && isInside(invoice.date || invoice.createdAt));
    const invoiceCosts = purchaseInvoices.reduce((sum, invoice) => {
        const total = typeof getPurchaseInvoiceNetTotal === 'function'
            ? getPurchaseInvoiceNetTotal(invoice)
            : (parseFloat(invoice.total) || 0);
        return sum + total;
    }, 0);

    const legacyLotCosts = (db.lots || [])
        .filter(lot => !lot.purchaseInvoiceId && isInside(lot.date || lot.createdAt))
        .reduce((sum, lot) => sum + Math.max(0, (parseFloat(lot.totalPrice) || 0) - (parseFloat(lot.returnedTotal) || 0)), 0);

    const legacyProductCosts = (db.adjustments || [])
        .filter(adjustment => adjustment.quantity > 0 && !adjustment.purchaseInvoiceId && isInside(adjustment.date))
        .reduce((sum, adjustment) => {
            const product = getProductById(adjustment.productId);
            return sum + ((parseFloat(adjustment.quantity) || 0) * (parseFloat(product?.purchasePrice) || 0));
        }, 0);

    return {
        revenue: Number(revenue.toFixed(2)),
        expenses: Number((invoiceCosts + legacyLotCosts + legacyProductCosts).toFixed(2))
    };
}

function buildStatsDailyBuckets(start, end) {
    const buckets = [];
    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);
    const limit = new Date(end);
    limit.setHours(23, 59, 59, 999);

    while (cursor <= limit && buckets.length < 62) {
        const bucketStart = new Date(cursor);
        const bucketEnd = new Date(cursor);
        bucketEnd.setHours(23, 59, 59, 999);
        buckets.push({
            label: bucketStart.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
            start: bucketStart,
            end: bucketEnd
        });
        cursor.setDate(cursor.getDate() + 1);
    }
    return buckets;
}

function buildStatsMonthlyBuckets(start, end) {
    const buckets = [];
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    const limit = new Date(end.getFullYear(), end.getMonth(), 1);

    while (cursor <= limit && buckets.length < 18) {
        const bucketStart = new Date(cursor);
        const bucketEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59, 999);
        buckets.push({
            label: bucketStart.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', ''),
            start: bucketStart,
            end: bucketEnd
        });
        cursor.setMonth(cursor.getMonth() + 1);
    }
    return buckets;
}

function getStatsChartBuckets(period) {
    const now = new Date();
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    if (period === 'range') {
        const start = getStatsLocalDate(document.getElementById('dashFilterStart')?.value);
        const end = getStatsLocalDate(document.getElementById('dashFilterEnd')?.value, true);
        if (start && end && start <= end) {
            const dayCount = Math.floor((end - start) / 86400000) + 1;
            return dayCount <= 45 ? buildStatsDailyBuckets(start, end) : buildStatsMonthlyBuckets(start, end);
        }
    }

    if (period === 'month') {
        return buildStatsDailyBuckets(new Date(now.getFullYear(), now.getMonth(), 1), todayEnd);
    }

    if (period === 'year') {
        return buildStatsMonthlyBuckets(new Date(now.getFullYear(), 0, 1), todayEnd);
    }

    if (period === 'all') {
        const dateCandidates = [
            ...(db.orders || []).map(order => getStatsDate(order.date)),
            ...(db.purchaseInvoices || []).map(invoice => getStatsDate(invoice.date || invoice.createdAt)),
            ...(db.lots || []).map(lot => getStatsDate(lot.date || lot.createdAt))
        ].filter(Boolean).sort((a, b) => a - b);
        const earliest = dateCandidates[0] || new Date(now.getFullYear(), now.getMonth() - 11, 1);
        const monthDistance = ((now.getFullYear() - earliest.getFullYear()) * 12) + now.getMonth() - earliest.getMonth();
        const start = monthDistance > 17
            ? new Date(now.getFullYear(), now.getMonth() - 17, 1)
            : new Date(earliest.getFullYear(), earliest.getMonth(), 1);
        return buildStatsMonthlyBuckets(start, todayEnd);
    }

    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    return buildStatsDailyBuckets(start, todayEnd);
}

function getAggregatedChartData(period) {
    try {
        const buckets = getStatsChartBuckets(period);
        const revenues = [];
        const expenses = [];

        buckets.forEach(bucket => {
            const totals = getStatsBucketTotals(bucket.start, bucket.end);
            revenues.push(totals.revenue);
            expenses.push(totals.expenses);
        });

        return {
            labels: buckets.map(bucket => bucket.label),
            revenues,
            expenses
        };
    } catch (error) {
        console.warn('Aggregation premium indisponible, utilisation du calcul compatible:', error);
        return getLegacyAggregatedChartData(period);
    }
}

function getStatsExampleChartData(labels, period) {
    const monthly = ['year', 'all'].includes(period) || labels.length > 20;
    const scale = monthly ? 7.5 : 1;
    const salesPattern = [14800, 17100, 16450, 20500, 19300, 23800, 26100, 24900, 28700, 27600, 31500, 30200];
    const purchasePattern = [6200, 7900, 7100, 9300, 8400, 10800, 9800, 11700, 12100, 10600, 13400, 12800];

    return {
        labels,
        revenues: labels.map((_, index) => Math.round(salesPattern[index % salesPattern.length] * scale)),
        expenses: labels.map((_, index) => Math.round(purchasePattern[index % purchasePattern.length] * scale))
    };
}

function formatStatsCompactCurrency(value) {
    const amount = Number(value) || 0;
    const absolute = Math.abs(amount);
    if (absolute >= 1000000) return `${(amount / 1000000).toFixed(absolute >= 10000000 ? 0 : 1).replace('.', ',')} M DA`;
    if (absolute >= 1000) return `${(amount / 1000).toFixed(absolute >= 100000 ? 0 : 1).replace('.', ',')} k DA`;
    return `${Math.round(amount)} DA`;
}

function formatStatsCurrency(value) {
    return `${new Intl.NumberFormat('fr-FR', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
    }).format(Number(value) || 0)} DA`;
}

function getStatsSeriesTrend(series) {
    const active = series.filter(value => Number(value) > 0);
    if (active.length < 2 || active[0] === 0) return { value: 0, label: `${active.length} point${active.length > 1 ? 's' : ''} actif${active.length > 1 ? 's' : ''}` };
    const change = ((active[active.length - 1] - active[0]) / active[0]) * 100;
    return {
        value: change,
        label: `${change >= 0 ? '+' : ''}${change.toFixed(1).replace('.', ',')}% sur la periode`
    };
}

function updateStatsComparisonSummary(data, isDemo, period) {
    const salesTotal = data.revenues.reduce((sum, value) => sum + value, 0);
    const purchaseTotal = data.expenses.reduce((sum, value) => sum + value, 0);
    const gap = salesTotal - purchaseTotal;
    const ratio = salesTotal > 0 ? (purchaseTotal / salesTotal) * 100 : 0;
    const salesTrend = getStatsSeriesTrend(data.revenues);
    const purchaseTrend = getStatsSeriesTrend(data.expenses);
    const setText = (id, value) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    };

    setText('comparisonSalesTotal', formatStatsCurrency(salesTotal));
    setText('comparisonPurchaseTotal', formatStatsCurrency(purchaseTotal));
    setText('comparisonNetGap', formatStatsCurrency(gap));
    setText('comparisonPurchaseRatio', `${ratio.toFixed(1).replace('.', ',')}%`);
    setText('comparisonSalesTrend', salesTrend.label);
    setText('comparisonPurchaseTrend', purchaseTrend.label);
    setText('comparisonGapStatus', gap >= 0 ? 'Flux positif' : 'Achats superieurs aux ventes');

    const periodLabels = {
        day: '(7 derniers jours)',
        week: '(7 derniers jours)',
        month: '(ce mois)',
        year: '(cette annee)',
        all: '(historique recent)',
        range: '(periode selectionnee)'
    };
    setText('statsComparisonRangeLabel', periodLabels[period] || '');

    const badge = document.getElementById('comparisonDataBadge');
    if (badge) {
        badge.textContent = isDemo ? 'Donnees exemple' : 'Donnees reelles';
        badge.classList.toggle('is-demo', isDemo);
    }

    const gapElement = document.getElementById('comparisonNetGap');
    gapElement?.classList.toggle('is-negative', gap < 0);

    const insight = document.querySelector('#comparisonInsight p');
    if (insight) {
        const prefix = isDemo ? 'Apercu exemple. ' : '';
        if (salesTotal <= 0 && purchaseTotal <= 0) {
            insight.textContent = `${prefix}Aucun flux financier sur cette periode.`;
        } else if (ratio <= 55) {
            insight.textContent = `${prefix}Les achats absorbent ${ratio.toFixed(1).replace('.', ',')}% des ventes, avec un ecart positif de ${formatStatsCurrency(Math.max(0, gap))}.`;
        } else if (ratio <= 85) {
            insight.textContent = `${prefix}Les achats representent ${ratio.toFixed(1).replace('.', ',')}% des ventes. Surveillez l'evolution de l'ecart net.`;
        } else {
            insight.textContent = `${prefix}Le cout des achats est eleve par rapport aux ventes (${ratio.toFixed(1).replace('.', ',')}%).`;
        }
    }
}

function openMovementsModal() {
    const modal = document.getElementById('stockMovementsModal');
    if (!modal) return;
    modal.style.display = 'flex';
    renderMovements();

    // Close on click outside or close button
    const closeBtn = document.getElementById('closeMovementsModal');
    if (closeBtn) {
        closeBtn.onclick = () => modal.style.display = 'none';
    }

    // Also listen for outside clicks once
    modal.onclick = (e) => {
        if (e.target === modal) modal.style.display = 'none';
    };
}

function renderWithdrawalsVsProfitChart(period) {
    const canvas = document.getElementById('withdrawalsProfitChart');
    if (!canvas) return;
    const chartShell = canvas.closest('.stats-chart-shell');

    if (typeof Chart === 'undefined') {
        chartShell?.classList.add('is-loading');
        if (statsChartRetryTimer) clearTimeout(statsChartRetryTimer);
        if (statsChartRetryCount < 20) {
            statsChartRetryCount += 1;
            statsChartRetryTimer = setTimeout(() => renderWithdrawalsVsProfitChart(period), 350);
        }
        return;
    }

    if (statsChartRetryTimer) {
        clearTimeout(statsChartRetryTimer);
        statsChartRetryTimer = null;
    }
    statsChartRetryCount = 0;
    chartShell?.classList.remove('is-loading');

    if (statsChart) statsChart.destroy();

    const realData = getAggregatedChartData(period);
    const hasRealData = realData.revenues.some(value => value > 0) || realData.expenses.some(value => value > 0);
    const data = hasRealData ? realData : getStatsExampleChartData(realData.labels, period);
    updateStatsComparisonSummary(data, !hasRealData, period);

    document.querySelectorAll('.stats-legend-toggle').forEach(button => {
        button.classList.add('active');
        button.setAttribute('aria-pressed', 'true');
    });

    const context = canvas.getContext('2d');
    const chartHeight = Math.max(320, chartShell?.clientHeight || 360);
    const salesGradient = context.createLinearGradient(0, 0, 0, chartHeight);
    salesGradient.addColorStop(0, 'rgba(46, 125, 50, 0.20)');
    salesGradient.addColorStop(0.7, 'rgba(46, 125, 50, 0.035)');
    salesGradient.addColorStop(1, 'rgba(46, 125, 50, 0)');
    const purchaseGradient = context.createLinearGradient(0, 0, 0, chartHeight);
    purchaseGradient.addColorStop(0, 'rgba(229, 115, 78, 0.15)');
    purchaseGradient.addColorStop(0.7, 'rgba(229, 115, 78, 0.025)');
    purchaseGradient.addColorStop(1, 'rgba(229, 115, 78, 0)');

    const crosshairPlugin = {
        id: 'statsPremiumCrosshair',
        afterDatasetsDraw(chart) {
            const activeElements = chart.tooltip?.getActiveElements?.() || [];
            if (!activeElements.length) return;
            const x = activeElements[0].element.x;
            const { ctx, chartArea } = chart;
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(x, chartArea.top);
            ctx.lineTo(x, chartArea.bottom);
            ctx.lineWidth = 1;
            ctx.strokeStyle = 'rgba(72, 86, 78, 0.18)';
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.restore();
        }
    };

    statsChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels: data.labels,
            datasets: [
                {
                    label: 'Ventes',
                    data: data.revenues,
                    borderColor: '#2e7d32',
                    backgroundColor: salesGradient,
                    fill: true,
                    tension: 0.38,
                    cubicInterpolationMode: 'monotone',
                    borderWidth: 2.5,
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    pointHoverBorderWidth: 3,
                    pointHoverBorderColor: '#ffffff',
                    pointHoverBackgroundColor: '#2e7d32'
                },
                {
                    label: 'Achats',
                    data: data.expenses,
                    borderColor: '#e5734e',
                    backgroundColor: purchaseGradient,
                    fill: true,
                    tension: 0.38,
                    cubicInterpolationMode: 'monotone',
                    borderWidth: 2.5,
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    pointHoverBorderWidth: 3,
                    pointHoverBorderColor: '#ffffff',
                    pointHoverBackgroundColor: '#e5734e'
                }
            ]
        },
        plugins: [crosshairPlugin],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            normalized: true,
            interaction: {
                mode: 'index',
                intersect: false
            },
            animation: {
                duration: 650,
                easing: 'easeOutQuart'
            },
            layout: {
                padding: { top: 8, right: 8, bottom: 0, left: 4 }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    enabled: true,
                    backgroundColor: '#10251a',
                    titleColor: '#ffffff',
                    bodyColor: 'rgba(255, 255, 255, 0.82)',
                    borderColor: 'rgba(255, 255, 255, 0.12)',
                    borderWidth: 1,
                    cornerRadius: 8,
                    padding: 13,
                    boxPadding: 5,
                    usePointStyle: true,
                    displayColors: true,
                    titleFont: { family: "'Inter', sans-serif", size: 12, weight: '700' },
                    bodyFont: { family: "'Inter', sans-serif", size: 12, weight: '600' },
                    callbacks: {
                        label(context) {
                            return ` ${context.dataset.label}: ${formatStatsCurrency(context.parsed.y)}`;
                        },
                        footer(items) {
                            if (items.length < 2) return '';
                            const values = items.reduce((result, item) => {
                                result[item.datasetIndex] = item.parsed.y;
                                return result;
                            }, {});
                            if (values[0] === undefined || values[1] === undefined) return '';
                            return `Ecart: ${formatStatsCurrency(values[0] - values[1])}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    border: { display: false },
                    grid: {
                        color: 'rgba(74, 91, 81, 0.08)',
                        drawTicks: false
                    },
                    ticks: {
                        callback(value) { return formatStatsCompactCurrency(value); },
                        color: '#7c8981',
                        padding: 11,
                        font: { family: "'Inter', sans-serif", size: 11, weight: '600' }
                    }
                },
                x: {
                    border: { display: false },
                    grid: { display: false },
                    ticks: {
                        autoSkip: true,
                        maxTicksLimit: period === 'month' ? 10 : 12,
                        maxRotation: 0,
                        color: '#7c8981',
                        padding: 9,
                        font: { family: "'Inter', sans-serif", size: 11, weight: '600' }
                    }
                }
            }
        }
    });
}

function toggleStatsComparisonDataset(datasetIndex, button) {
    if (!statsChart) return;
    const nextVisible = !statsChart.isDatasetVisible(datasetIndex);
    statsChart.setDatasetVisibility(datasetIndex, nextVisible);
    statsChart.update();
    button?.classList.toggle('active', nextVisible);
    button?.setAttribute('aria-pressed', nextVisible ? 'true' : 'false');
}

function renderOrdersTableFiltered(orders) {
    const container = document.getElementById('ordersTableBody');
    const noOrders = document.getElementById('noOrders');
    if (!container) return;

    // Store for search filtering
    _currentDashOrders = orders;

    // Clear search input when period changes
    const searchInput = document.getElementById('ordersSearchInput');
    if (searchInput) searchInput.value = '';

    _renderOrdersToTable(orders);
}

function _renderOrdersToTable(orders) {
    const container = document.getElementById('ordersTableBody');
    const noOrders = document.getElementById('noOrders');
    if (!container) return;

    if (!orders.length) {
        container.innerHTML = '';
        if (noOrders) noOrders.style.display = 'block';
        return;
    }

    if (noOrders) noOrders.style.display = 'none';

    container.innerHTML = orders.slice(0, 50).map(order => {
        const client = getClientById(order.clientId);
        const itemsText = order.items.map(i => {
            const p = getProductById(i.productId);
            const name = p ? p.name : (String(i.productId).startsWith('divers') ? 'Article Divers' : 'Produit inconnu');
            return `${i.quantity}x ${name}`;
        }).filter(Boolean).join(', ');

        return `
            <tr>
                <td>${formatDate(order.date)}</td>
                <td style="font-weight:600; color:var(--primary)">${client.name}</td>
                <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${itemsText}</td>
                <td style="text-align:right;font-weight:700;color:var(--primary)">${formatPrice(getOrderNetTotal(order))}</td>
            </tr>
        `;
    }).join('');
}

function initOrdersSearch() {
    const searchInput = document.getElementById('ordersSearchInput');
    if (!searchInput) return;

    let debounce = null;
    searchInput.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
            filterDashOrders(searchInput.value.trim());
        }, 200);
    });
}

function filterDashOrders(query) {
    if (!query) {
        _renderOrdersToTable(_currentDashOrders);
        const countEl = document.getElementById('ordersCount');
        if (countEl) countEl.textContent = `${_currentDashOrders.length} ventes`;
        return;
    }

    const q = query.toLowerCase();
    const filtered = _currentDashOrders.filter(order => {
        // Search in client name
        const client = getClientById(order.clientId);
        if (client && client.name && client.name.toLowerCase().includes(q)) return true;

        // Search in product names
        const hasProduct = order.items.some(i => {
            const p = getProductById(i.productId);
            const name = p ? p.name : (String(i.productId).startsWith('divers') ? 'Article Divers' : 'Produit inconnu');
            return name.toLowerCase().includes(q);
        });
        if (hasProduct) return true;

        // Search in formatted date
        const dateStr = formatDate(order.date).toLowerCase();
        if (dateStr.includes(q)) return true;

        return false;
    });

    _renderOrdersToTable(filtered);
    const countEl = document.getElementById('ordersCount');
    if (countEl) countEl.textContent = `${filtered.length} / ${_currentDashOrders.length} ventes`;
}

function renderTopProductsFiltered(orders) {
    const topContainer = document.getElementById('topProducts');
    const worstContainer = document.getElementById('worstProducts');
    if (!topContainer) return;

    const productSales = {};
    orders.forEach(order => {
        order.items.forEach(item => {
            const netQuantity = getOrderNetQuantity(order, item);
            if (netQuantity > 0) {
                productSales[item.productId] = (productSales[item.productId] || 0) + netQuantity;
            }
        });
    });

    const entries = Object.entries(productSales);

    // Top 5
    const topSorted = [...entries]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);


    const worstSorted = [...entries]
        .sort((a, b) => a[1] - b[1])
        .slice(0, 3);

    if (!topSorted.length) {
        topContainer.innerHTML = '<p class="text-muted text-sm" style="text-align:center;padding:var(--space-xl)">Aucune vente</p>';
        if (worstContainer) worstContainer.innerHTML = '';
        return;
    }

    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
    const worstIcons = ['⭕', '🟠', '🔴'];

    topContainer.innerHTML = topSorted.map(([productId, qty], i) => {
        const p = getProductById(productId);
        if (!p) return '';
        return `
            <div style="display:flex;align-items:center;gap:var(--space-md);padding:var(--space-md);background:rgba(46, 204, 113, 0.1);border-left:4px solid var(--success);border-radius:var(--radius-md);margin-bottom:var(--space-sm)">
                <span style="font-size:24px">${medals[i]}</span>
                <div style="flex:1">
                    <div class="font-bold">${p.name}</div>
                    <div class="text-sm text-muted">${qty} vendus</div>
                </div>
            </div>
        `;
    }).join('');

    if (worstContainer) {
        worstContainer.innerHTML = worstSorted.map(([productId, qty], i) => {
            const p = getProductById(productId);
            if (!p) return '';
            const colors = ['#f39c12', '#e67e22', '#e74c3c']; // Orange to Red
            return `
                <div style="display:flex;align-items:center;gap:var(--space-md);padding:var(--space-md);background:rgba(231, 76, 60, 0.1);border-left:4px solid ${colors[i]};border-radius:var(--radius-md);margin-bottom:var(--space-sm)">
                    <span style="font-size:24px">${worstIcons[i]}</span>
                    <div style="flex:1">
                        <div class="font-bold">${p.name}</div>
                        <div class="text-sm text-muted">${qty} vendus</div>
                    </div>
                </div>
            `;
        }).join('');
    }
}

function renderLegacyClientPurchaseStats(orders) {
    const revenueContainer = document.getElementById('clientRevenueContainer');

    if (!revenueContainer) return;

    // Calculate client statistics
    const clientStats = {};
    orders.forEach(order => {
        const client = getClientById(order.clientId);
        if (!client) return;

        if (!clientStats[client.id]) {
            clientStats[client.id] = {
                name: client.name,
                totalRevenue: 0,
                orderCount: 0,
                orders: []
            };
        }

        const netTotal = getOrderNetTotal(order);
        if (netTotal <= 0) return;
        clientStats[client.id].totalRevenue += netTotal;
        clientStats[client.id].orderCount += 1;
        clientStats[client.id].orders.push(order);
    });

    // Convert to array and sort by revenue
    const allClients = Object.values(clientStats)
        .sort((a, b) => b.totalRevenue - a.totalRevenue);

    if (allClients.length === 0) {
        revenueContainer.innerHTML = '<p style="padding: 20px; text-align: center; color: var(--text-light);">Aucune vente</p>';
        return;
    }

    // Render clients as scrollable cards
    revenueContainer.innerHTML = allClients.map(client => {
        const revenue = formatPrice(client.totalRevenue);
        const displayName = client.name === 'Divers' ? 'Client Divers' : client.name;

        return `
            <div style="
                flex: 0 0 280px;
                background: linear-gradient(135deg, rgba(74, 44, 42, 0.05), rgba(139, 69, 19, 0.05));
                border: 1px solid var(--border);
                border-radius: 14px;
                padding: 18px;
                display: flex;
                flex-direction: column;
                gap: 12px;
                transition: all 0.3s ease;
                cursor: pointer;
                position: relative;
            " 
            onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 8px 24px rgba(74, 44, 42, 0.15)'; this.style.borderColor='var(--primary)';"
            onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none'; this.style.borderColor='var(--border)';"
            >
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="
                        width: 40px;
                        height: 40px;
                        border-radius: 10px;
                        background: linear-gradient(135deg, var(--primary), var(--secondary));
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        color: white;
                        font-weight: 700;
                        font-size: 1.1rem;
                    ">
                        ${client.name.charAt(0).toUpperCase()}
                    </div>
                    <div style="flex: 1; min-width: 0;">
                        <div style="
                            font-weight: 700;
                            font-size: 0.95rem;
                            color: var(--text-dark);
                            white-space: nowrap;
                            overflow: hidden;
                            text-overflow: ellipsis;
                        ">
                            ${displayName}
                        </div>
                        <div style="
                            font-size: 0.8rem;
                            color: var(--text-light);
                        ">
                            ${client.orderCount} ${client.orderCount === 1 ? 'commande' : 'commandes'}
                        </div>
                    </div>
                </div>
                
                <div style="
                    background: linear-gradient(135deg, rgba(74, 44, 42, 0.1), rgba(139, 69, 19, 0.08));
                    padding: 12px;
                    border-radius: 10px;
                    border-left: 4px solid var(--primary);
                ">
                    <div style="
                        font-size: 0.75rem;
                        color: var(--text-light);
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                        margin-bottom: 4px;
                    ">
                        Chiffre d'Affaires Total
                    </div>
                    <div style="
                        font-weight: 800;
                        font-size: 1.4rem;
                        color: var(--primary);
                    ">
                        ${revenue}
                    </div>
                </div>
                
                <div style="
                    display: flex;
                    gap: 6px;
                    font-size: 0.75rem;
                    color: var(--text-light);
                    padding-top: 8px;
                    border-top: 1px solid rgba(74, 44, 42, 0.1);
                ">
                    <span style="flex: 1; text-align: center;">
                        Moyenne par commande: <strong>${formatPrice(client.totalRevenue / client.orderCount)}</strong>
                    </span>
                </div>
            </div>
        `;
    }).join('');

    // Update period label
    const periodLabelEl = document.getElementById('clientsPeriodLabel');
    if (periodLabelEl) {
        const periodLabels = {
            'day': "d'aujourd'hui",
            'week': 'de la semaine',
            'month': 'du mois',
            'year': "de l'année",
            'all': 'toutes périodes',
            'range': 'période sélectionnée'
        };
        periodLabelEl.textContent = periodLabels[currentStatsPeriod] || '';
    }
}

// Scroll function for clients
function scrollClients(direction) {
    const container = document.getElementById('clientRevenueContainer');
    if (!container) return;

    const scrollAmount = 300;
    if (direction === 'left') {
        container.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
    } else {
        container.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
}

function renderClientPurchaseStats(orders) {
    try {
    const revenueContainer = document.getElementById('clientRevenueContainer');
    if (!revenueContainer) return;

    const clientStats = {};
    (orders || []).forEach(order => {
        const netTotal = getOrderNetTotal(order);
        if (netTotal <= 0) return;
        const clientId = String(order.clientId || 'divers');
        const client = getClientById(clientId);

        if (!clientStats[clientId]) {
            clientStats[clientId] = {
                id: clientId,
                name: client?.name || 'Vente',
                totalRevenue: 0,
                orderCount: 0,
                isDemo: false
            };
        }

        clientStats[clientId].totalRevenue += netTotal;
        clientStats[clientId].orderCount += 1;
    });

    let clients = Object.values(clientStats).sort((a, b) => b.totalRevenue - a.totalRevenue);
    const isDemo = clients.length === 0;

    if (isDemo) {
        clients = [
            { id: 'demo-client-boulangerie-bahia', name: 'Boulangerie El Bahia', totalRevenue: 48300, orderCount: 18, isDemo: true },
            { id: 'demo-client-cafe-gourmand', name: 'Cafe Gourmand', totalRevenue: 32750, orderCount: 12, isDemo: true },
            { id: 'demo-client-hotel-atlas', name: 'Hotel Atlas', totalRevenue: 21900, orderCount: 7, isDemo: true },
            { id: 'demo-client-comptoir', name: 'Vente comptoir', totalRevenue: 14600, orderCount: 34, isDemo: true }
        ];
    }

    const totalRevenue = clients.reduce((sum, client) => sum + client.totalRevenue, 0);
    const totalOrders = clients.reduce((sum, client) => sum + client.orderCount, 0);
    const maxRevenue = Math.max(...clients.map(client => client.totalRevenue), 1);
    const setText = (id, value) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    };

    setText('clientRevenueTotal', formatStatsCurrency(totalRevenue));
    setText('clientRevenueActiveCount', clients.length);
    setText('clientRevenueAverageOrder', formatStatsCurrency(totalOrders > 0 ? totalRevenue / totalOrders : 0));
    setText('clientRevenueLeader', clients[0]?.name || '-');

    const badge = document.getElementById('clientRevenueDataBadge');
    if (badge) {
        badge.textContent = isDemo ? 'Donnees exemple' : 'Donnees reelles';
        badge.classList.toggle('is-demo', isDemo);
    }

    const periodLabelEl = document.getElementById('clientsPeriodLabel');
    if (periodLabelEl) {
        const periodLabels = {
            day: "d'aujourd'hui",
            week: 'de la semaine',
            month: 'du mois',
            year: "de l'annee",
            all: 'toutes periodes',
            range: 'de la periode selectionnee'
        };
        periodLabelEl.textContent = periodLabels[currentStatsPeriod] || '';
    }

    revenueContainer.innerHTML = clients.map((client, index) => {
        const share = totalRevenue > 0 ? (client.totalRevenue / totalRevenue) * 100 : 0;
        const barWidth = Math.max(6, (client.totalRevenue / maxRevenue) * 100);
        const averageOrder = client.orderCount > 0 ? client.totalRevenue / client.orderCount : 0;
        const initials = getFinanceInitials(client.name);

        return `
            <article class="stats-client-revenue-row ${index === 0 ? 'is-leader' : ''}" style="--client-revenue-width:${barWidth.toFixed(2)}%">
                <div class="stats-client-rank rank-${Math.min(index + 1, 4)}">${String(index + 1).padStart(2, '0')}</div>
                <div class="stats-client-avatar">${escapeHtml(initials)}</div>
                <div class="stats-client-identity">
                    <strong>${escapeHtml(client.name)}</strong>
                    <span>${client.orderCount} commande${client.orderCount > 1 ? 's' : ''}</span>
                </div>
                <div class="stats-client-metric">
                    <span>Panier moyen</span>
                    <strong>${formatStatsCurrency(averageOrder)}</strong>
                </div>
                <div class="stats-client-metric contribution">
                    <span>Contribution</span>
                    <strong>${share.toFixed(1).replace('.', ',')}%</strong>
                </div>
                <div class="stats-client-revenue-value">
                    <span>Chiffre d'affaires</span>
                    <strong>${formatStatsCurrency(client.totalRevenue)}</strong>
                </div>
                <div class="stats-client-progress" aria-hidden="true"><span></span></div>
            </article>
        `;
    }).join('');
    } catch (error) {
        console.warn('Classement client premium indisponible, utilisation du rendu compatible:', error);
        renderLegacyClientPurchaseStats(orders);
    }
}

function renderAdjustmentsTableFiltered(adjustments) {
    const container = document.getElementById('adjustmentsTableBody');
    if (!container) return;

    container.innerHTML = adjustments.slice(0, 15).map(a => {
        const p = getProductById(a.productId);
        return `
            <tr>
                <td>${formatDateShort(a.date)}</td>
                <td>${p?.name || '—'}</td>
                <td style="color:${a.quantity > 0 ? 'var(--success)' : 'var(--danger)'}; font-weight:700">
                    ${a.quantity > 0 ? '+' : ''}${a.quantity}
                </td>
                <td>${a.reason}</td>
            </tr>
        `;
    }).join('');

    if (!adjustments.length) {
        container.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:var(--space-xl);color:var(--text-light)">Aucun mouvement pour cette période</td></tr>';
    }
}

// ==========================================
// Categories Page
// ==========================================

function initCategoriesPage() {
    loadData().then(() => {
        initTheme();
        renderCategoriesGrid();
        initCategoryModal();
    });
}

// ==========================================
// Settings Page
// ==========================================

function initSettingsPage() {
    loadData().then(() => {
        initTheme();
        renderSettingsForm();
        initSettingsHandlers();
    });
}

function renderSettingsForm() {
    const settings = getSettings();
    const tvaInput = document.getElementById('settingsTva');
    const contactInput = document.getElementById('settingsContact');
    const printerNameInput = document.getElementById('settingsPrinterName');
    const printerFormatSelect = document.getElementById('settingsPrinterFormat');
    const autoPrintCheckbox = document.getElementById('settingsAutoPrint');
    const openDrawerOnSaleCheckbox = document.getElementById('settingsOpenDrawerOnSale');
    const openDrawerOnWithdrawalCheckbox = document.getElementById('settingsOpenDrawerOnWithdrawal');
    const costCalcMethodSelect = document.getElementById('settingsCostCalcMethod');

    if (tvaInput) tvaInput.value = settings.tva || "";
    if (contactInput) contactInput.value = settings.contact || "";
    if (document.getElementById('settingsInitialCash')) {
        document.getElementById('settingsInitialCash').value = settings.initialCash || 0;
    }
    if (printerNameInput) printerNameInput.value = settings.printerName || "";
    if (printerFormatSelect) printerFormatSelect.value = settings.printerFormat || "80mm";
    if (autoPrintCheckbox) autoPrintCheckbox.checked = settings.autoPrint === true;
    if (openDrawerOnSaleCheckbox) openDrawerOnSaleCheckbox.checked = settings.openDrawerOnSale === true;
    if (openDrawerOnWithdrawalCheckbox) openDrawerOnWithdrawalCheckbox.checked = settings.openDrawerOnWithdrawal === true;
    if (costCalcMethodSelect) costCalcMethodSelect.value = settings.costCalcMethod || "last";
}

function initSettingsHandlers() {
    const form = document.getElementById('settingsForm');
    const resetBtn = document.getElementById('resetSettingsBtn');

    form?.addEventListener('submit', (e) => {
        e.preventDefault();

        // Use a persistent reference to the form and its elements
        const currentForm = e.target;
        const tvaValue = currentForm.querySelector('#settingsTva')?.value || "";
        const contactValue = currentForm.querySelector('#settingsContact')?.value || "";
        const initialCash = currentForm.querySelector('#settingsInitialCash')?.value || 0;
        const printerName = currentForm.querySelector('#settingsPrinterName')?.value || "";
        const printerFormat = currentForm.querySelector('#settingsPrinterFormat')?.value || "80mm";
        const autoPrint = currentForm.querySelector('#settingsAutoPrint')?.checked || false;
        const openDrawerOnSale = currentForm.querySelector('#settingsOpenDrawerOnSale')?.checked || false;
        const openDrawerOnWithdrawal = currentForm.querySelector('#settingsOpenDrawerOnWithdrawal')?.checked || false;
        const costCalcMethod = currentForm.querySelector('#settingsCostCalcMethod')?.value || "last";

        db.settings = {
            tva: String(tvaValue).trim(),
            contact: String(contactValue).trim(),
            initialCash: parseFloat(initialCash) || 0,
            printerName: String(printerName).trim(),
            printerFormat: printerFormat,
            autoPrint: !!autoPrint,
            openDrawerOnSale: !!openDrawerOnSale,
            openDrawerOnWithdrawal: !!openDrawerOnWithdrawal,
            costCalcMethod: costCalcMethod
        };

        saveDataImmediate();
        showToast('Paramètres enregistrés', 'success');
    });

    resetBtn?.addEventListener('click', () => {
        if (!confirm('Réinitialiser les paramètres ?')) return;
        db.settings = { tva: "", contact: "", initialCash: 0, printerName: "", printerFormat: "90mm", autoPrint: false, openDrawerOnSale: false, openDrawerOnWithdrawal: false };
        saveData();
        renderSettingsForm();
        showToast('Paramètres réinitialisés', 'info');
    });
}

function renderCategoriesGrid() {
    const container = document.getElementById('categoriesGrid');
    if (!container) return;

    container.innerHTML = db.categories.map(cat => {
        const count = db.products.filter(p => p.category === cat.id).length;
        const stock = db.products.filter(p => p.category === cat.id).reduce((s, p) => s + p.stock, 0);

        return `
            <div class="category-card" style="border-left-color: ${cat.color};">
                <div class="category-icon">${cat.image && cat.image !== 'undefined' ? `<img src="${cat.image}" alt="${cat.name}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 8px;">` : '📁'}</div>
                <div class="category-name">${cat.name}</div>
                <div class="category-count">${count} produits · ${stock} en stock</div>
                <div style="display: flex; gap: var(--space-xs); margin-top: var(--space-sm);">
                    <button class="btn btn-outline" style="flex: 1; padding: 4px 8px; font-size: 0.75rem;" onclick="editCategory(${cat.id})">
                        ✏️ Modifier
                    </button>
                    <button class="btn btn-outline" style="padding: 4px 8px; color: var(--danger);" onclick="deleteCategory(${cat.id}, '${cat.name.replace(/'/g, "\\'")}')">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    if (!db.categories.length) {
        container.innerHTML = `
            <div class="empty-state" style="grid-column: 1/-1;">
                <span class="icon">🏷️</span>
                <p class="text-muted">Aucune catégorie</p>
                <p class="text-sm text-muted">Cliquez sur "+ Catégorie" pour en créer une</p>
            </div>
        `;
    }
}

function initCategoryModal() {
    const modal = document.getElementById('categoryModal');
    const form = document.getElementById('categoryForm');

    if (!modal) return;

    document.getElementById('addCategoryBtn')?.addEventListener('click', () => {
        resetCategoryModal();
        modal.style.display = 'flex';
    });

    const close = () => {
        modal.style.display = 'none';
        form?.reset();
        resetCategoryModal();
    };

    document.getElementById('closeCategoryModal')?.addEventListener('click', close);
    document.getElementById('cancelCategoryModal')?.addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    form?.addEventListener('submit', e => {
        e.preventDefault();

        const name = document.getElementById('categoryName').value.trim();
        const image = document.getElementById('categoryImage').value || '';
        const color = document.getElementById('categoryColor').value;

        if (!name) {
            showToast('Veuillez entrer un nom de catégorie', 'error');
            return;
        }

        if (editingCategoryId) {
            const cat = db.categories.find(c => c.id === editingCategoryId);
            if (cat) {
                cat.name = name;
                cat.image = image;
                cat.color = color;
                showToast(`Catégorie "${name}" modifiée!`, 'success');
            }
        } else {
            db.categories.push({
                id: Date.now(),
                name,
                image,
                color
            });
            showToast(`Catégorie "${name}" créée!`, 'success');
        }

        saveData();
        close();
        renderCategoriesGrid();
    });
}

function editCategory(categoryId) {
    const cat = db.categories.find(c => c.id === categoryId);
    if (!cat) return;

    editingCategoryId = categoryId;

    const modal = document.getElementById('categoryModal');
    const titleEl = modal?.querySelector('.modal-header h3');
    const submitBtn = modal?.querySelector('button[type="submit"]');

    if (titleEl) titleEl.innerHTML = '✏️ Modifier la Catégorie';
    if (submitBtn) submitBtn.textContent = '✓ Enregistrer';

    document.getElementById('categoryName').value = cat.name;
    document.getElementById('categoryImage').value = cat.image || '';
    document.getElementById('categoryColor').value = cat.color;

    // Display image preview if exists
    if (cat.image) {
        const previewContainer = document.getElementById('categoryImagePreviewContainer');
        if (previewContainer) {
            previewContainer.innerHTML = `<img src="${cat.image}" alt="Preview" style="max-width: 100%; max-height: 200px; object-fit: cover; border-radius: 8px;">`;
            document.getElementById('categoryImageUploadArea').classList.add('has-image');
        }
    }

    modal.style.display = 'flex';
}

function resetCategoryModal() {
    editingCategoryId = null;
    const modal = document.getElementById('categoryModal');
    const titleEl = modal?.querySelector('.modal-header h3');
    const submitBtn = modal?.querySelector('button[type="submit"]');

    if (titleEl) titleEl.innerHTML = '🏷️ Nouvelle Catégorie';
    if (submitBtn) submitBtn.textContent = '✓ Créer';

    // Reset image preview
    const previewContainer = document.getElementById('categoryImagePreviewContainer');
    if (previewContainer) {
        previewContainer.innerHTML = '<span class="upload-icon">📷</span><p class="text-sm text-muted">Cliquez pour ajouter une image</p>';
        document.getElementById('categoryImageUploadArea').classList.remove('has-image');
    }
}

function deleteCategory(categoryId, categoryName) {
    const cat = db.categories.find(c => c.id === categoryId);
    if (!cat) return;

    const productsInCategory = db.products.filter(p => p.category === categoryId).length;
    const message = productsInCategory > 0
        ? `Supprimer la catégorie "${categoryName}" et ses ${productsInCategory} produits ? Cette action est définitive.`
        : `Supprimer la catégorie "${categoryName}" ?`;

    Swal.fire({
        title: 'Confirmer la suppression',
        text: message,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: 'Oui, supprimer',
        cancelButtonText: 'Annuler'
    }).then((result) => {
        if (result.isConfirmed) {
            db.products = db.products.filter(p => p.category !== categoryId);
            db.categories = db.categories.filter(c => c.id !== categoryId);
            saveData();
            renderCategoriesGrid();
            showToast(`Catégorie "${categoryName}" supprimée`, 'success');
        }
    });
}

// ==========================================
// Reporting
// ==========================================

function downloadReportPdf(html, title) {
    if (typeof html2pdf === 'undefined') {
        downloadReportPdf._retryCount = (downloadReportPdf._retryCount || 0) + 1;
        if (downloadReportPdf._retryCount <= 12) {
            showToast('Module PDF en chargement...', 'info');
            setTimeout(() => downloadReportPdf(html, title), 500);
        } else {
            downloadReportPdf._retryCount = 0;
            showToast('Module PDF indisponible pour le moment', 'error');
        }
        return;
    }
    downloadReportPdf._retryCount = 0;

    const element = document.createElement('div');
    element.innerHTML = html;

    // Modern PDF Download Configuration
    const opt = {
        margin: 10,
        filename: `${title}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    // Show loading hint
    showToast('Génération du PDF en cours...', 'info');

    // New way: directly download
    html2pdf().set(opt).from(element).save()
        .then(() => {
            showToast('Téléchargement terminé', 'success');
        })
        .catch(err => {
            console.error('PDF Error:', err);
            showToast('Erreur lors du téléchargement PDF', 'error');
        });
}

function generateFullReport() {
    const orders = getFilteredOrders(currentStatsPeriod);
    const adjustments = getFilteredAdjustments(currentStatsPeriod);
    const products = db.products;

    const totalSales = orders.reduce((sum, o) => sum + getOrderNetTotal(o), 0);
    const totalOrders = orders.length;

    const reportHtml = `
        <div style="font-family: 'Inter', sans-serif; padding: 20px; background: #fff;">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 4px solid #8B4513; padding-bottom: 20px; margin-bottom: 30px;">
                <div>
                    <h1 style="color: #8B4513; margin: 0; font-size: 28px;">Rapport d'Activité</h1>
                    <p style="color: #666; margin: 5px 0 0 0;">Axxam - Période : ${currentStatsPeriod.toUpperCase()}</p>
                </div>
                <div style="text-align: right;">
                    <p style="margin: 0; font-size: 14px;">Édité le : <strong>${new Date().toLocaleDateString('fr-FR')}</strong></p>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 40px;">
                <div style="background: #f8f9fa; padding: 15px; border-radius: 10px; border-top: 4px solid #8B4513;">
                    <div style="font-size: 11px; color: #666; margin-bottom: 5px;">Chiffre d'Affaires</div>
                    <div style="font-size: 18px; font-weight: 700;">${formatPrice(totalSales)}</div>
                </div>
                <div style="background: #f8f9fa; padding: 15px; border-radius: 10px; border-top: 4px solid #D2691E;">
                    <div style="font-size: 11px; color: #666; margin-bottom: 5px;">Commandes</div>
                    <div style="font-size: 18px; font-weight: 700;">${totalOrders}</div>
                </div>
                <div style="background: #f8f9fa; padding: 15px; border-radius: 10px; border-top: 4px solid #4CAF50;">
                    <div style="font-size: 11px; color: #666; margin-bottom: 5px;">Total Produits</div>
                    <div style="font-size: 18px; font-weight: 700;">${products.length}</div>
                </div>
                <div style="background: #f8f9fa; padding: 15px; border-radius: 10px; border-top: 4px solid #F44336;">
                    <div style="font-size: 11px; color: #666; margin-bottom: 5px;">Ruptures</div>
                    <div style="font-size: 18px; font-weight: 700;">${products.filter(p => p.stock === 0).length}</div>
                </div>
            </div>

            <h2 style="color: #8B4513; margin-bottom: 15px; font-size: 18px; border-bottom: 2px solid #eee; padding-bottom: 8px;">Détails des Ventes (${orders.length})</h2>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px; font-size: 12px;">
                <thead>
                    <tr style="background: #f8f9fa;">
                        <th style="padding: 10px; text-align: left; border: 1px solid #dee2e6;">Date</th>
                        <th style="padding: 10px; text-align: left; border: 1px solid #dee2e6;">Client</th>
                        <th style="padding: 10px; text-align: left; border: 1px solid #dee2e6;">Articles</th>
                        <th style="padding: 10px; text-align: right; border: 1px solid #dee2e6;">Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${orders.map(o => `
                        <tr>
                            <td style="padding: 8px; border: 1px solid #dee2e6; white-space: nowrap;">${formatDate(o.date)}</td>
                            <td style="padding: 8px; border: 1px solid #dee2e6; font-weight: bold;">${getClientById(o.clientId).name}</td>
                            <td style="padding: 8px; border: 1px solid #dee2e6;">${o.items.map(i => {
        const p = getProductById(i.productId);
        const name = p ? p.name : (String(i.productId).startsWith('divers') ? 'Article Divers' : 'Produit inconnu');
        return `${i.quantity}x ${name}`;
    }).join(', ')}</td>
                            <td style="padding: 8px; border: 1px solid #dee2e6; text-align: right; font-weight: 700;">${formatPrice(getOrderNetTotal(o))}</td>
                        </tr>
                    `).join('') || '<tr><td colspan="3" style="text-align:center; padding: 20px;">Aucune vente</td></tr>'}
                </tbody>
            </table>

            <h2 style="color: #D2691E; margin-bottom: 15px; margin-top: 30px; font-size: 18px; border-bottom: 2px solid #eee; padding-bottom: 8px;">Mouvements de Stock (${adjustments.length})</h2>
            <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                <thead>
                    <tr style="background: #f8f9fa;">
                        <th style="padding: 10px; text-align: left; border: 1px solid #dee2e6;">Date</th>
                        <th style="padding: 10px; text-align: left; border: 1px solid #dee2e6;">Produit</th>
                        <th style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">Qté</th>
                        <th style="padding: 10px; text-align: left; border: 1px solid #dee2e6;">Raison</th>
                    </tr>
                </thead>
                <tbody>
                    ${adjustments.map(a => `
                        <tr>
                            <td style="padding: 8px; border: 1px solid #dee2e6; white-space: nowrap;">${formatDate(a.date)}</td>
                            <td style="padding: 8px; border: 1px solid #dee2e6;">${getProductById(a.productId)?.name || 'Produit inconnu'}</td>
                            <td style="padding: 8px; border: 1px solid #dee2e6; text-align: center; font-weight: 700; color: ${a.quantity > 0 ? '#28a745' : '#dc3545'}">
                                ${a.quantity > 0 ? '+' : ''}${a.quantity}
                            </td>
                            <td style="padding: 8px; border: 1px solid #dee2e6;">${a.reason}</td>
                        </tr>
                    `).join('') || '<tr><td colspan="4" style="text-align:center; padding: 20px;">Aucun mouvement</td></tr>'}
                </tbody>
            </table>
        </div>
    `;

    downloadReportPdf(reportHtml, `Rapport_${currentStatsPeriod}_${new Date().toISOString().split('T')[0]}`);
}

function openDiversModal() {
    const modal = document.getElementById('diversModal');
    const priceInput = document.getElementById('diversPriceInput');
    const qtyInput = document.getElementById('diversQtyInput');

    if (modal) {
        modal.style.display = 'flex';
        priceInput.value = '';
        qtyInput.value = '1';
        priceInput.focus();
    }
}

function closeDiversModal() {
    const modal = document.getElementById('diversModal');
    if (modal) modal.style.display = 'none';
}



function adjustDiversQty(delta) {
    const input = document.getElementById('diversQtyInput');
    let val = parseInt(input.value) || 1;
    val += delta;
    if (val < 1) val = 1;
    input.value = val;
}

function confirmDivers() {
    const priceInput = document.getElementById('diversPriceInput');
    const qtyInput = document.getElementById('diversQtyInput');
    const price = parseFloat(priceInput.value);
    const qty = parseInt(qtyInput.value) || 1;

    if (isNaN(price) || price < 0) {
        showToast('Veuillez entrer un prix valide', 'error');
        priceInput.focus();
        return;
    }

    if (qty < 1) {
        showToast('Quantité minimale : 1', 'error');
        return;
    }

    // Add to cart with custom price
    const uniqueId = 'divers_' + Date.now();
    cart.push({
        productId: uniqueId,
        quantity: qty,
        customPrice: price,
        origCustomPrice: price
    });

    updateCart();
    closeDiversModal();
    saveData(); // Save cart to localStorage
    showToast('Article divers ajouté', 'success');
}


// ==========================================
// Withdrawals Page (Retraits)
// ==========================================


function initWithdrawalsPage() {
    loadData().then(() => {
        initTheme();
        renderWithdrawalsTable();

        // Add filter listeners
        document.getElementById('withdrawalPeriodFilter')?.addEventListener('click', (e) => {
            if (e.target.classList.contains('stats-filter-tab')) {
                document.querySelectorAll('#withdrawalPeriodFilter .stats-filter-tab').forEach(btn => btn.classList.remove('active'));
                e.target.classList.add('active');
                renderWithdrawalsTable(e.target.dataset.period);
            }
        });

    });
}

function renderWithdrawalsTable(period = 'all') {
    const body = document.getElementById('withdrawalsTableBody');
    if (!body) return;

    let data = getFilteredWithdrawals(period);
    data = [...data].sort((a, b) => new Date(b.date) - new Date(a.date));

    body.innerHTML = data.map(w => {
        let categoryLabel = '';
        let categoryClass = '';
        let typeLabel = w.type || '-';
        let amountStyle = '';

        if (w.category === 'ajout') {
            categoryLabel = 'Ajout';
            categoryClass = 'stock-ok'; // Green tag
            typeLabel = 'Fond de Caisse';
            amountStyle = 'color: var(--success);';
        } else if (w.category === 'retrait' || w.category === 'caisse') {
            categoryLabel = 'Retrait';
            categoryClass = 'role-admin'; // Blue tag
            amountStyle = 'color: var(--danger);';
        } else if (w.category === 'profit') {
            categoryLabel = 'Retrait Bénéfice'; // Legacy
            categoryClass = 'role-user'; // Gray tag
            amountStyle = 'color: var(--danger);';
        } else {
            categoryLabel = w.category;
            categoryClass = 'role-user';
        }

        return `
            <tr>
                <td>${formatDate(w.date)}</td>
                <td><span class="role-tag ${categoryClass}">${categoryLabel}</span></td>
                <td>${typeLabel}</td>
                <td>${w.reason}</td>
                <td class="font-bold" style="${amountStyle}">${formatPrice(w.amount)}</td>
                <td style="text-align: right;">
                    <button onclick="editWithdrawal(${w.id})" class="btn btn-icon" style="color: var(--primary); background: none; border: none;" title="Modifier">
                        <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    if (data.length === 0) {
        body.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 40px; color: var(--text-light);">Aucune opération enregistrée</td></tr>';
    }
}

function getCurrentCaisseBalance() {
    const settings = getSettings();
    const initial = parseFloat(settings.initialCash) || 0;

    // Ensure we have arrays
    const orders = db.orders || [];
    const withdrawals = db.withdrawals || [];

    const sales = orders.reduce((sum, o) => {
        const val = getOrderNetTotal(o);
        return sum + (isNaN(val) ? 0 : val);
    }, 0);

    const additions = withdrawals
        .filter(w => w.category === 'ajout')
        .reduce((sum, w) => {
            const val = parseFloat(w.amount);
            return sum + (isNaN(val) ? 0 : val);
        }, 0);

    const subtractions = withdrawals
        .filter(w => {
            const cat = String(w.category || '').toLowerCase().trim();
            return ['retrait', 'caisse', 'profit', 'retrait bénéfice'].includes(cat);
        })
        .reduce((sum, w) => {
            const val = parseFloat(w.amount);
            return sum + (isNaN(val) ? 0 : val);
        }, 0);

    const balance = initial + sales + additions - subtractions;
    return Number(balance.toFixed(2)); // Avoid floating point issues
}

function addWithdrawal(event) {
    event.preventDefault();
    const category = document.getElementById('withdrawalCategory').value;
    const type = category === 'retrait' ? document.getElementById('withdrawalType').value : 'Ajout';
    const reason = document.getElementById('withdrawalReason').value.trim();
    const amount = parseFloat(document.getElementById('withdrawalAmount').value);

    // Amount is always required and must be positive
    if (isNaN(amount) || amount <= 0) {
        showToast('Veuillez entrer un montant valide', 'error');
        return;
    }

    // Reason is only mandatory for withdrawals (retrait)
    if (category === 'retrait' && !reason) {
        showToast('Veuillez indiquer un motif pour le retrait', 'error');
        return;
    }

    // Balance check for withdrawals
    if (category === 'retrait') {
        const currentBalance = getCurrentCaisseBalance();
        if (amount > currentBalance) {
            showToast(`Opération refusée : solde insuffisant (${formatPrice(currentBalance)})`, 'error');
            return;
        }
    }

    const newWithdrawal = {
        id: Date.now(),
        category,
        type,
        reason: reason || (category === 'ajout' ? 'Sans motif' : '-'),
        amount,
        date: new Date().toISOString()
    };

    db.withdrawals.unshift(newWithdrawal);
    saveData();
    showToast(`${category === 'retrait' ? 'Retrait' : 'Ajout'} enregistré avec succès`, 'success');

    event.target.reset();

    // Reset active filter to show everything
    document.querySelectorAll('#withdrawalPeriodFilter .stats-filter-tab').forEach(btn => btn.classList.remove('active'));
    document.querySelector('#withdrawalPeriodFilter [data-period="all"]')?.classList.add('active');

    renderWithdrawalsTable('all');
    if (category === 'retrait') {
        document.getElementById('withdrawalTypeGroup').style.display = 'block';
    }
}

function editWithdrawal(id) {
    const withdrawal = db.withdrawals.find(w => w.id === id);
    if (!withdrawal) return;

    Swal.fire({
        title: 'Modifier',
        html: `
            <div style="text-align: left; margin: 10px 0; max-width: 300px;">
                <div style="margin-bottom: 8px;">
                    <label style="display: block; margin-bottom: 3px; font-weight: 600; font-size: 13px;">Type:</label>
                    <select id="editCategory" class="swal2-input" style="width: 100%; margin-bottom: 5px; padding: 6px; font-size: 14px;">
                        <option value="retrait" ${withdrawal.category === 'retrait' ? 'selected' : ''}>Retrait Caisse</option>
                        <option value="ajout" ${withdrawal.category === 'ajout' ? 'selected' : ''}>Ajout Fond de Caisse</option>
                    </select>
                </div>
                <div style="margin-bottom: 8px;">
                    <label style="display: block; margin-bottom: 3px; font-weight: 600; font-size: 13px;">Détail:</label>
                    <select id="editType" class="swal2-input" style="width: 100%; margin-bottom: 5px; padding: 6px; font-size: 14px;">
                        <option value="Personnel" ${withdrawal.type === 'Personnel' ? 'selected' : ''}>Personnel</option>
                        <option value="Facture" ${withdrawal.type === 'Facture' ? 'selected' : ''}>Facture</option>
                    </select>
                </div>
                <div style="margin-bottom: 8px;">
                    <label style="display: block; margin-bottom: 3px; font-weight: 600; font-size: 13px;">Motif:</label>
                    <input id="editReason" class="swal2-input" value="${withdrawal.reason}" placeholder="Motif" style="width: 100%; padding: 6px; font-size: 14px;">
                </div>
                <div style="margin-bottom: 5px;">
                    <label style="display: block; margin-bottom: 3px; font-weight: 600; font-size: 13px;">Montant:</label>
                    <input id="editAmount" class="swal2-input" type="number" step="0.01" value="${withdrawal.amount}" placeholder="0.00" style="width: 100%; padding: 6px; font-size: 14px;">
                </div>
            </div>
        `,
        icon: null,
        showCancelButton: true,
        confirmButtonColor: '#3085d6',
        confirmButtonText: 'OK',
        cancelButtonText: 'Annul',
        confirmButtonAriaLabel: 'Enregistrer',
        cancelButtonAriaLabel: 'Annuler',
        customClass: {
            popup: 'compact-swal-popup',
            title: 'compact-swal-title',
            htmlContainer: 'compact-swal-content'
        },
        position: 'top',
        backdrop: 'rgba(0,0,0,0.4)',
        preConfirm: () => {
            const category = document.getElementById('editCategory').value;
            const type = document.getElementById('editType').value;
            const reason = document.getElementById('editReason').value.trim();
            const amount = parseFloat(document.getElementById('editAmount').value);

            if (!reason || !amount || amount <= 0) {
                Swal.showValidationMessage('Champs invalides');
                return false;
            }

            return { category, type, reason, amount };
        }
    }).then((result) => {
        if (result.isConfirmed) {
            const { category, type, reason, amount } = result.value;

            // Update withdrawal
            withdrawal.category = category;
            withdrawal.type = type;
            withdrawal.reason = reason;
            withdrawal.amount = amount;

            saveData();
            renderWithdrawalsTable();
            showToast('Transaction modifiée avec succès', 'success');
        }
    });
}

// ==========================================
// Product Cost Calculation (from recipe or purchasePrice)
// ==========================================

function createCostLookupContext() {
    const productsById = new Map((db.products || []).map(product => [String(product.id), product]));
    const componentsById = new Map((db.components || []).map(component => [String(component.id), component]));
    const recipesByProductId = new Map((db.recipes || []).map(recipe => [String(recipe.productId), recipe]));
    const lotsByComponentId = new Map();

    (db.lots || []).forEach(lot => {
        const key = String(lot.componentId);
        if (!lotsByComponentId.has(key)) lotsByComponentId.set(key, []);
        lotsByComponentId.get(key).push(lot);
    });

    return {
        productsById,
        componentsById,
        recipesByProductId,
        lotsByComponentId,
        productCostCache: new Map(),
        weightedCostCache: new Map()
    };
}

function getProductFromCostContext(productId, context = null) {
    return context?.productsById?.get(String(productId)) || getProductById(productId);
}

function getProductPurchaseCost(product) {
    const value = parseFloat(product?.purchasePrice);
    return value > 0 ? value : 0;
}

function getSaleUnitCost(item, product = null, costContext = null) {
    const saleProduct = product || getProductFromCostContext(item?.productId, costContext);
    const savedCost = parseFloat(item?.unitCost);
    if (savedCost > 0) return savedCost;

    const directPurchaseCost = getProductPurchaseCost(saleProduct);
    if (directPurchaseCost > 0) return directPurchaseCost;

    return saleProduct ? calculateProductCost(saleProduct.id, new Set(), costContext) : 0;
}

function calculateProductCost(productId, visited = new Set(), costContext = null) {
    const productKey = String(productId);
    if (visited.has(productKey)) return 0;
    if (costContext?.productCostCache?.has(productKey)) {
        return costContext.productCostCache.get(productKey);
    }
    visited.add(productKey);

    const product = getProductFromCostContext(productId, costContext);
    if (!product) return 0;

    // Check if product has a recipe
    const recipe = costContext?.recipesByProductId?.get(productKey) ||
        (db.recipes || []).find(r => String(r.productId) === productKey);

    let result = 0;
    if (recipe && recipe.ingredients && recipe.ingredients.length > 0) {
        const unitsDivisor = parseFloat(recipe.unitsDivisor) || 1;
        const ingredientsCost = recipe.ingredients.reduce((total, ing) => {
            const ingredientKey = String(ing.componentId);
            const comp = costContext?.componentsById?.get(ingredientKey) ||
                costContext?.productsById?.get(ingredientKey) ||
                (db.components || []).find(c => String(c.id) === ingredientKey) ||
                (db.products || []).find(p => String(p.id) === ingredientKey);
            if (!comp) return total;

            const isProduct = costContext?.productsById?.has(ingredientKey) ||
                !(db.components || []).some(c => String(c.id) === ingredientKey);
            let unitPrice = 0;

            if (isProduct) {
                unitPrice = calculateProductCost(comp.id, new Set(visited), costContext);
            } else {
                unitPrice = getWeightedAverageCost(ing.componentId, costContext) || comp.purchasePrice || 0;
            }

            return total + (ing.quantity * unitPrice);
        }, 0);

        const fixedFees = parseFloat(product.purchasePrice) || 0;
        result = (ingredientsCost + fixedFees) / unitsDivisor;
    } else {
        // No recipe - use purchasePrice
        result = product.purchasePrice || 0;
    }

    if (costContext?.productCostCache) {
        costContext.productCostCache.set(productKey, result);
    }
    return result;
}

// ==========================================
// Weighted Average Cost Calculation
// ==========================================

function getWeightedAverageCost(componentId, costContext = null) {
    const componentKey = String(componentId);
    if (costContext?.weightedCostCache?.has(componentKey)) {
        return costContext.weightedCostCache.get(componentKey);
    }

    const lots = costContext?.lotsByComponentId?.get(componentKey) ||
        (db.lots || []).filter(l => String(l.componentId) === componentKey);

    if (lots.length === 0) return 0;

    let totalValue = 0;
    let totalQty = 0;

    lots.forEach(lot => {
        const qty = parseFloat(lot.quantity) || 0;
        const totalPrice = parseFloat(lot.totalPrice) || 0;

        if (qty > 0) {
            totalValue += totalPrice;
            totalQty += qty;
        }
    });

    const result = totalQty === 0 ? 0 : totalValue / totalQty;
    if (costContext?.weightedCostCache) {
        costContext.weightedCostCache.set(componentKey, result);
    }
    return result;
}

/**
 * Calculates current unit price of a component based on the selected method in settings.
 * @param {number|string} componentId 
 * @returns {number} unit price
 */
function getComponentItemUnitPrice(componentId) {
    // 1. Check if it's a product first
    const isComp = (db.components || []).some(c => String(c.id) === String(componentId));
    if (!isComp) {
        const product = (db.products || []).find(p => String(p.id) === String(componentId));
        if (product) {
            const recipe = (db.recipes || []).find(r => String(r.productId) === String(product.id));
            if (recipe) {
                const totalBatchCost = calculateRecipeCost(recipe);
                const unitsDivisor = parseFloat(recipe.unitsDivisor) || 1;
                const baseCost = (totalBatchCost / unitsDivisor);
                const fixedFees = (parseFloat(product.purchasePrice) || 0) / unitsDivisor;
                return baseCost + fixedFees;
            }
            // If it's a product with no recipe but has a purchase price
            return (parseFloat(product.purchasePrice) || 0);
        }
    }

    // 2. Regular component lot-based cost
    const method = db.settings?.costCalcMethod || 'last';
    const lots = (db.lots || []).filter(l => String(l.componentId) === String(componentId));

    if (lots.length === 0) return 0;

    if (method === 'avg') {
        const activeLots = lots.filter(l => (l.remainingQty || l.quantity) > 0);
        if (activeLots.length === 0) return 0;
        const sum = activeLots.reduce((s, l) => s + (l.totalPrice / l.quantity), 0);
        return sum / activeLots.length;
    }

    if (method === 'wavg') {
        return (typeof getWeightedAverageCost === 'function') ? getWeightedAverageCost(componentId) : 0;
    }

    const latest = [...lots].sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    return latest ? (latest.totalPrice / latest.quantity) : 0;
}

/**
 * Calculates total batch cost for a recipe, handling sub-products recursively.
 */
function calculateRecipeCost(recipe, visitedIds = new Set()) {
    if (!recipe || !recipe.ingredients) return 0;

    const pid = String(recipe.productId);
    if (visitedIds.has(pid)) {
        console.warn("Circular dependency detected for product ID:", pid);
        return 0;
    }

    visitedIds.add(pid);

    const totalCost = recipe.ingredients.reduce((acc, ing) => {
        const compId = String(ing.componentId);

        // Check if it's a component or product
        const isProduct = (db.products || []).some(p => String(p.id) === compId);

        let unitPrice = 0;
        if (isProduct) {
            const subProduct = db.products.find(p => String(p.id) === compId);
            const subRecipe = (db.recipes || []).find(r => String(r.productId) === compId);

            if (subRecipe) {
                const subBatchCost = calculateRecipeCost(subRecipe, new Set(visitedIds));
                const subDivisor = parseFloat(subRecipe.unitsDivisor) || 1;
                unitPrice = (subBatchCost / subDivisor) + ((parseFloat(subProduct.purchasePrice) || 0) / subDivisor);
            } else {
                unitPrice = parseFloat(subProduct.purchasePrice) || 0;
            }
        } else {
            // It's a raw component
            unitPrice = getComponentItemUnitPrice(compId);
        }

        return acc + (ing.quantity * unitPrice);
    }, 0);

    return totalCost;
}

// ==========================================
// Sales History
// ==========================================

let currentHistoryFilter = 'day';
let currentHistoryDate = null;

function openSalesHistory() {
    const modal = document.getElementById('salesHistoryModal');
    if (!modal) return;

    // Set default filter to 'day' as requested
    currentHistoryFilter = 'day';
    currentHistoryDate = null;

    // Reset UI state
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.toggle('active', c.dataset.period === 'day'));
    const dateInput = document.getElementById('historyExactDate');
    if (dateInput) dateInput.value = '';
    const searchInput = document.getElementById('historySearchInput');
    if (searchInput) searchInput.value = '';

    renderSalesHistoryList();
    modal.style.display = 'flex';
}

function closeSalesHistory() {
    const modal = document.getElementById('salesHistoryModal');
    if (modal) modal.style.display = 'none';
}

function filterHistory(period, element) {
    currentHistoryFilter = period;

    if (period === 'date') {
        currentHistoryDate = element.value;
        document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    } else {
        currentHistoryDate = null;
        document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        element.classList.add('active');
        const dateInput = document.getElementById('historyExactDate');
        if (dateInput) dateInput.value = '';
    }

    renderSalesHistoryList();
}

function renderSalesHistoryList() {
    const container = document.getElementById('salesHistoryList');
    if (!container) return;

    let orders = [...(db.orders || [])];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Period Filter
    if (currentHistoryFilter === 'day') {
        orders = orders.filter(o => new Date(o.date) >= today);
    } else if (currentHistoryFilter === 'week') {
        const lastSat = new Date(today);
        const dayNum = today.getDay();
        const diffToSat = (dayNum + 1) % 7;
        lastSat.setDate(today.getDate() - diffToSat);
        lastSat.setHours(0, 0, 0, 0);
        orders = orders.filter(o => new Date(o.date) >= lastSat);
    } else if (currentHistoryFilter === 'month') {
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        orders = orders.filter(o => new Date(o.date) >= monthStart);
    } else if (currentHistoryFilter === 'date' && currentHistoryDate) {
        orders = orders.filter(o => {
            const od = new Date(o.date).toISOString().split('T')[0];
            return od === currentHistoryDate;
        });
    }

    // Article Search Filter
    const searchVal = (document.getElementById('historySearchInput')?.value || '').toLowerCase().trim();
    if (searchVal) {
        orders = orders.filter(order => {
            return order.items.some(item => {
                const product = getProductById(item.productId);
                const name = product ? product.name.toLowerCase() : '';
                return name.includes(searchVal);
            });
        });
    }

    // Sort by date desc
    orders.sort((a, b) => new Date(b.date) - new Date(a.date));

    const totalSales = orders.reduce((sum, o) => sum + getOrderNetTotal(o), 0);
    const totalDisplay = document.getElementById('salesHistoryTotal');
    if (totalDisplay) totalDisplay.textContent = formatPrice(totalSales);

    if (orders.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-light);"><p>Aucune vente trouvée pour cette période</p></div>';
        return;
    }

    container.innerHTML = orders.map(order => {
        const client = getClientById(order.clientId);
        const itemNames = order.items.map(i => {
            const p = getProductById(i.productId);
            const netQty = getOrderNetQuantity(order, i);
            const returnedText = netQty < (parseFloat(i.quantity) || 0) ? ` (${netQty} net)` : '';
            return p ? `${i.quantity}x ${p.name}${returnedText}` : `${i.quantity}x Article${returnedText}`;
        }).join(', ');
        const status = getOrderReturnStatus(order);
        const canReturn = order.status !== 'cancelled' && order.status !== 'returned';
        const netTotal = getOrderNetTotal(order);

        return `<div class="sales-history-item" onclick="previewTicket(${order.id})">
            <div class="sh-item-header">
                <span class="sh-item-date">${formatDate(order.date)}${status.label ? ` · ${status.label}` : ''}</span>
                <span class="sh-item-total">${formatPrice(netTotal)}</span>
            </div>
            <div class="sh-item-details">${itemNames}</div>
            <div class="sh-item-footer">
                <span class="sh-item-client">👤 ${client.name}</span>
                <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
                    <button class="sh-reprint-btn" onclick="event.stopPropagation(); previewTicket(${order.id})">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
                        </svg>
                        Aperçu
                    </button>
                    <button class="sh-reprint-btn sh-return-btn" onclick="event.stopPropagation(); openSaleReturnModal(${order.id})" ${canReturn ? '' : 'disabled'}>Retour</button>
                    <button class="sh-reprint-btn sh-cancel-btn" onclick="event.stopPropagation(); cancelSaleOrder(${order.id})" ${canReturn ? '' : 'disabled'}>Annuler</button>
                </div>
            </div>
        </div>`;
    }).join('');
}

function getSaleReturnableLines(order) {
    if (!order || !Array.isArray(order.items)) return [];
    return order.items.map((item, index) => {
        const product = getProductById(item.productId);
        const soldQty = parseFloat(item.quantity) || 0;
        const returnedQty = getOrderReturnedQuantity(order, item);
        const remainingQty = Math.max(0, soldQty - returnedQty);
        const unitNetPrice = getOrderLineNetUnitPrice(item);
        return {
            index,
            product,
            productId: item.productId,
            item,
            soldQty,
            returnedQty,
            remainingQty,
            unitNetPrice,
            unitCost: getSaleUnitCost(item, product)
        };
    }).filter(line => line.remainingQty > 0);
}

function applySaleReturn(order, returnLines, options = {}) {
    if (!order || !returnLines.length) return null;
    if (!db.saleReturns) db.saleReturns = [];
    if (!db.adjustments) db.adjustments = [];

    const now = new Date().toISOString();
    const saleReturn = {
        id: `sr-${Date.now()}`,
        orderId: order.id,
        ticketNum: order.ticketNum || '',
        type: options.type || 'return',
        reason: options.reason || '',
        items: [],
        total: 0,
        date: now
    };

    returnLines.forEach(line => {
        const qty = parseFloat(line.quantity) || 0;
        if (qty <= 0) return;
        const amount = Number((qty * (parseFloat(line.unitNetPrice) || 0)).toFixed(2));
        const product = getProductById(line.productId);
        if (product) {
            product.stock = (parseFloat(product.stock) || 0) + qty;
            db.adjustments.unshift({
                id: Date.now() + Math.random(),
                productId: product.id,
                quantity: qty,
                reason: options.type === 'cancel' ? `Annulation vente #${order.ticketNum || order.id}` : `Retour vente #${order.ticketNum || order.id}`,
                date: now,
                user: 'POS'
            });
        }

        const returnedItem = {
            productId: line.productId,
            quantity: qty,
            amount,
            unitCost: parseFloat(line.unitCost) || 0,
            date: now,
            type: saleReturn.type
        };
        if (!Array.isArray(order.returnedItems)) order.returnedItems = [];
        order.returnedItems.push(returnedItem);
        saleReturn.items.push(returnedItem);
        saleReturn.total += amount;
    });

    saleReturn.total = Number(saleReturn.total.toFixed(2));
    order.returnTotal = getOrderReturnedItems(order).reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
    order.returnedAt = now;
    order.updatedAt = now;
    const stillReturnable = getSaleReturnableLines(order).some(line => line.remainingQty > 0);
    order.status = options.type === 'cancel' ? 'cancelled' : (stillReturnable ? 'partial_return' : 'returned');

    const client = getClientById(order.clientId);
    if (client && saleReturn.total > 0) {
        client.totalRevenue = Math.max(0, (parseFloat(client.totalRevenue) || 0) - saleReturn.total);
        if (order.status === 'cancelled' || order.status === 'returned') {
            client.orderCount = Math.max(0, (parseInt(client.orderCount, 10) || 0) - 1);
        }
    }

    const invoice = (db.invoices || []).find(item =>
        item.status !== 'cancelled' &&
        (String(item.id || '') === String(order.invoiceId || '') ||
            String(item.sourceOrderId || '') === String(order.id))
    );
    if (invoice && saleReturn.total > 0) {
        invoice.amount = Math.max(0, (parseFloat(invoice.amount) || 0) - saleReturn.total);
        invoice.updatedAt = now;
        if (invoice.amount <= 0) {
            invoice.status = 'cancelled';
            invoice.cancelledAt = now;
        } else if (typeof refreshInvoiceStatus === 'function') {
            refreshInvoiceStatus(invoice);
        }
    }

    db.saleReturns.unshift(saleReturn);
    return saleReturn;
}

function openSaleReturnModal(orderId) {
    const order = (db.orders || []).find(o => String(o.id) === String(orderId));
    if (!order) {
        showToast('Vente introuvable', 'error');
        return;
    }
    const lines = getSaleReturnableLines(order);
    if (!lines.length) {
        showToast('Aucun article restant a retourner', 'info');
        return;
    }

    const rows = lines.map(line => `
        <tr>
            <td><strong>${escapeHtml(line.product?.name || 'Article')}</strong></td>
            <td>${line.remainingQty}</td>
            <td>${formatPrice(line.unitNetPrice)}</td>
            <td><input class="input sale-return-qty" data-product-id="${escapeHtml(line.productId)}" data-unit-price="${line.unitNetPrice}" data-unit-cost="${line.unitCost}" type="number" min="0" max="${line.remainingQty}" step="0.01" value="0"></td>
        </tr>
    `).join('');

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 620px;">
            <div class="modal-header">
                <h3>Retour vente #${escapeHtml(order.ticketNum || order.id)}</h3>
                <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            </div>
            <div class="modal-body">
                <p class="text-muted" style="margin-bottom:12px;">Saisissez les quantites retournees. Le stock sera restaure et les chiffres seront recalcules en net.</p>
                <div style="overflow-x:auto;">
                    <table class="purchase-cart-table">
                        <thead><tr><th>Article</th><th>Restant</th><th>PU net</th><th>Retour</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>
            <div class="modal-footer" style="display:flex; gap:10px; flex-wrap:wrap;">
                <button class="btn btn-outline" onclick="this.closest('.modal-overlay').remove()">Fermer</button>
                <button class="btn btn-outline" onclick="fillSaleReturnAll(this)">Tout retourner</button>
                <button class="btn btn-primary" onclick="confirmSaleReturn(${order.id}, this)">Valider le retour</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function fillSaleReturnAll(button) {
    button.closest('.modal-overlay').querySelectorAll('.sale-return-qty').forEach(input => {
        input.value = input.max || '0';
    });
}

function confirmSaleReturn(orderId, button) {
    const order = (db.orders || []).find(o => String(o.id) === String(orderId));
    if (!order) return;
    const modal = button.closest('.modal-overlay');
    const lines = [...modal.querySelectorAll('.sale-return-qty')].map(input => ({
        productId: input.dataset.productId,
        quantity: Math.min(parseFloat(input.value) || 0, parseFloat(input.max) || 0),
        unitNetPrice: parseFloat(input.dataset.unitPrice) || 0,
        unitCost: parseFloat(input.dataset.unitCost) || 0
    })).filter(line => line.quantity > 0);

    if (!lines.length) {
        showToast('Aucune quantite a retourner', 'warning');
        return;
    }

    applySaleReturn(order, lines, { type: 'return' });
    saveDataImmediate();
    modal.remove();
    renderSalesHistoryList();
    renderProducts();
    updateCart();
    showToast('Retour de vente enregistre', 'success');
}

function cancelSaleOrder(orderId) {
    const order = (db.orders || []).find(o => String(o.id) === String(orderId));
    if (!order || order.status === 'cancelled') return;
    Swal.fire({
        title: 'Annuler cette vente ?',
        text: "La vente restera dans l'historique, le stock sera restaure et son montant passera a zero.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: 'Oui, annuler',
        cancelButtonText: 'Non'
    }).then((result) => {
        if (!result.isConfirmed) return;
        const lines = getSaleReturnableLines(order).map(line => ({
            productId: line.productId,
            quantity: line.remainingQty,
            unitNetPrice: line.unitNetPrice,
            unitCost: line.unitCost
        }));
        if (lines.length) applySaleReturn(order, lines, { type: 'cancel' });
        order.status = 'cancelled';
        order.cancelledAt = new Date().toISOString();
        saveDataImmediate();
        renderSalesHistoryList();
        renderProducts();
        updateCart();
        showToast('Vente annulee et stock restaure', 'info');
    });
}

function deleteOrder(orderId) {
    return cancelSaleOrder(orderId);
    Swal.fire({
        title: 'Annuler cette vente ?',
        text: "Les stocks seront restaurés. Cette action est définitive.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: 'Oui, annuler la vente',
        cancelButtonText: 'Non'
    }).then((result) => {
        if (result.isConfirmed) {
            const order = db.orders.find(o => o.id === orderId);
            if (!order) return;

            // Restore stocks
            order.items.forEach(item => {
                const product = getProductById(item.productId);
                if (product) product.stock += item.quantity;
            });

            db.orders = db.orders.filter(o => o.id !== orderId);
            saveData();
            renderSalesHistoryList();
            renderProducts();
            showToast('Vente annulée et stocks restaurés', 'info');
        }
    });
}

function reprintTicket(orderId) {
    const order = db.orders.find(o => o.id === orderId);
    if (!order) {
        showToast('Commande introuvable', 'error');
        return;
    }
    generateTicket(order);
    showToast('Ticket réimprimé', 'success');
}

function previewTicket(orderId) {
    const order = db.orders.find(o => o.id === orderId);
    if (!order) {
        showToast('Commande introuvable', 'error');
        return;
    }

    // Store the order ID globally for the print function
    window.previewingOrderId = orderId;

    // Generate ticket preview content
    const ticketContent = generateTicketContent(order);

    // Set the preview modal content
    const previewContainer = document.getElementById('ticketPreviewContent');
    if (previewContainer) {
        previewContainer.innerHTML = ticketContent;
    }

    // Show the preview modal
    const previewModal = document.getElementById('ticketPreviewModal');
    if (previewModal) {
        previewModal.style.display = 'flex';
    }
}

function printFromPreview() {
    const orderId = window.previewingOrderId;
    if (!orderId) {
        showToast('Aucun ticket à imprimer', 'error');
        return;
    }

    const order = db.orders.find(o => o.id === orderId);
    if (!order) {
        showToast('Commande introuvable', 'error');
        return;
    }

    // Generate and print the ticket
    generateTicket(order);
    showToast('Ticket imprimé', 'success');

    // Close the preview modal
    closeTicketPreview();
}

function closeTicketPreview() {
    const previewModal = document.getElementById('ticketPreviewModal');
    if (previewModal) {
        previewModal.style.display = 'none';
    }
    window.previewingOrderId = null;
}

// Generate ticket content (without printing)
function generateTicketContent(order) {
    const settings = getSettings();
    const items = order.items.map(item => {
        const product = getProductById(item.productId) || (String(item.productId).startsWith('divers') ? { name: 'Article Divers' } : null);
        const price = item.price !== undefined ? item.price : (product?.price || 0);
        const origPrice = item.origUnitPrice !== undefined ? item.origUnitPrice : (product?.price || 0);
        const itemDiscount = item.itemDiscount || 0;
        return {
            name: product?.name || 'Produit',
            quantity: item.quantity,
            price: price,
            origPrice: origPrice,
            itemDiscount: itemDiscount,
            total: (price * item.quantity) - itemDiscount
        };
    });

    const subTotal = items.reduce((sum, item) => sum + item.total, 0);
    const discount = order.discount || 0;
    const grandTotal = subTotal - discount;
    const dateLabel = formatDate(order.date);
    const ticketNum = order.ticketNum || (db.orders && db.orders.filter(o => new Date(o.date).toDateString() === new Date(order.date).toDateString()).length + 1);

    const client = getClientById(order.clientId);

    let content = `
    <div style="font-family: 'Courier New', monospace; font-size: 12px; line-height: 1.5; width: 280px; background: white; padding: 16px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
        
        <div style="text-align: center; margin-bottom: 12px; font-weight: bold; font-size: 16px; letter-spacing: 1px;">
            AXXAM
        </div>
        
        <div style="text-align: center; font-size: 11px; margin-bottom: 8px; font-weight: 600;">
            Tel: 0772864617
        </div>
        
        <div style="text-align: center; font-size: 12px; margin-bottom: 8px; font-weight: 700;">
            ${dateLabel} — N°${ticketNum}
        </div>
        
        <div style="text-align: center; font-size: 11px; margin-bottom: 10px;">
            👤 ${client.name}
        </div>
        
        <hr style="border: none; border-top: 1px dashed #000; margin: 10px 0;">
        
        <div style="margin-bottom: 8px;">
    `;

    items.forEach(item => {
        content += `
            <div style="margin-bottom: 10px;">
                <div style="font-weight: 700; font-size: 12px; margin-bottom: 2px;">${item.name}</div>
                <div style="display: flex; justify-content: space-between; font-size: 11px;">
                    <span>${item.quantity} x ${(item.origPrice > 0 && item.price !== item.origPrice) ? `<s style="opacity: 0.7;">${formatPriceNoSymbol(item.origPrice)}</s> ` : ''}${formatPrice(item.price)} ${item.itemDiscount > 0 ? `(-${formatPrice(item.itemDiscount)})` : ''}</span>
                    <span style="font-weight: 700;">${formatPrice(item.total)}</span>
                </div>
            </div>
        `;
    });

    content += `
        </div>
        
        <hr style="border: none; border-top: 2px dashed #000; margin: 10px 0;">
        
        <div style="display: flex; justify-content: space-between; font-weight: 900; font-size: 14px; margin-bottom: 8px;">
            <span>TOTAL</span>
            <span>${formatPrice(grandTotal)}</span>
        </div>
    `;

    if (order.payment) {
        content += `
        <hr style="border: none; border-top: 1px solid #000; margin: 8px 0;">
        
        <div style="font-size: 11px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span>Montant reçu:</span>
                <strong>${formatPrice(order.payment.received)}</strong>
            </div>
            <div style="display: flex; justify-content: space-between;">
                <span>Montant rendu:</span>
                <strong>${formatPrice(order.payment.change)}</strong>
            </div>
        </div>
        `;
    }

    if (settings.contact) {
        content += `
        <hr style="border: none; border-top: 1px dashed #000; margin: 8px 0;">
        <div style="text-align: center; font-size: 11px; font-weight: 700;">
            ${settings.contact}
        </div>
        `;
    }

    content += `
        <hr style="border: none; border-top: 1px dashed #000; margin: 8px 0;">
        
        <div style="text-align: center; font-size: 11px; font-weight: 700; margin-top: 8px;">
            Merci pour votre visite!
        </div>
    </div>
    `;

    return content;
}

// ==========================================
// Customer Orders Page
// ==========================================

const CUSTOMER_ORDER_STATUSES = {
    nouvelle: { label: 'Nouvelle', tone: 'info' },
    confirmee: { label: 'Confirmee', tone: 'primary' },
    preparation: { label: 'En preparation', tone: 'warning' },
    prete: { label: 'Prete', tone: 'success' },
    livree: { label: 'Livree', tone: 'success' },
    annulee: { label: 'Annulee', tone: 'danger' }
};

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeCustomerPhone(phone) {
    return String(phone || '').replace(/\s+/g, '').trim();
}

function getCustomerOrderMeta(status) {
    return CUSTOMER_ORDER_STATUSES[status] || CUSTOMER_ORDER_STATUSES.nouvelle;
}

function getCustomerOrderDate(order) {
    return order.createdAt || order.date || new Date().toISOString();
}

function getCustomerOrdersFiltered() {
    const statusFilter = document.getElementById('customerOrderStatusFilter')?.value || 'all';
    const search = (document.getElementById('customerOrderSearch')?.value || '').toLowerCase().trim();
    let orders = [...(db.customerOrders || [])];

    if (statusFilter !== 'all') {
        orders = orders.filter(order => (order.status || 'nouvelle') === statusFilter);
    }

    if (search) {
        orders = orders.filter(order => {
            const haystack = [
                order.code,
                order.customer?.name,
                order.customer?.phone,
                order.customer?.address,
                ...(order.items || []).map(item => item.name)
            ].join(' ').toLowerCase();
            return haystack.includes(search);
        });
    }

    return orders.sort((a, b) => new Date(getCustomerOrderDate(b)) - new Date(getCustomerOrderDate(a)));
}

function renderCustomerOrderStats() {
    const orders = db.customerOrders || [];
    const counts = {
        all: orders.length,
        nouvelle: orders.filter(o => (o.status || 'nouvelle') === 'nouvelle').length,
        preparation: orders.filter(o => (o.status || 'nouvelle') === 'preparation').length,
        prete: orders.filter(o => (o.status || 'nouvelle') === 'prete').length,
        livree: orders.filter(o => (o.status || 'nouvelle') === 'livree').length
    };

    Object.entries(counts).forEach(([key, value]) => {
        const el = document.getElementById(`customerOrdersStat-${key}`);
        if (el) el.textContent = value;
    });
}

function renderCustomerOrdersPage() {
    const container = document.getElementById('customerOrdersList');
    if (!container) return;

    renderCustomerOrderStats();
    const orders = getCustomerOrdersFiltered();

    if (!orders.length) {
        container.innerHTML = `
            <div class="customer-orders-empty">
                <h3>Aucune commande client</h3>
                <p>Les commandes envoyees depuis la sous-app client apparaitront ici.</p>
                <a class="btn btn-primary" href="client.html" target="_blank">Ouvrir la sous-app client</a>
            </div>
        `;
        return;
    }

    container.innerHTML = orders.map(order => {
        const status = order.status || 'nouvelle';
        const meta = getCustomerOrderMeta(status);
        const disabledSale = status === 'livree' || status === 'annulee';
        const dateLabel = new Date(getCustomerOrderDate(order)).toLocaleString('fr-FR');
        const itemsHtml = (order.items || []).map(item => `
            <div class="customer-order-item">
                <span>${escapeHtml(item.name)}</span>
                <strong>${item.quantity} x ${formatPrice(item.price)}</strong>
            </div>
        `).join('');

        return `
            <article class="customer-order-card status-${meta.tone}">
                <div class="customer-order-card-head">
                    <div>
                        <div class="customer-order-code">${escapeHtml(order.code || `CMD-${order.id}`)}</div>
                        <h3 class="customer-order-client-name">${escapeHtml(order.customer?.name || 'Client')}</h3>
                        <p>${escapeHtml(order.customer?.phone || '-')} ${order.customer?.address ? ' - ' + escapeHtml(order.customer.address) : ''}</p>
                    </div>
                    <span class="customer-order-status status-${meta.tone}">${meta.label}</span>
                </div>

                <div class="customer-order-items">${itemsHtml}</div>

                ${order.note ? `<div class="customer-order-note">${escapeHtml(order.note)}</div>` : ''}

                <div class="customer-order-footer">
                    <div>
                        <span class="customer-order-date">${dateLabel}</span>
                        <strong class="customer-order-total">${formatPrice(order.total || 0)}</strong>
                    </div>
                    <div class="customer-order-actions">
                        <select class="input customer-order-select" onchange="updateCustomerOrderStatus(${order.id}, this.value)">
                            ${Object.entries(CUSTOMER_ORDER_STATUSES).map(([key, value]) => `
                                <option value="${key}" ${key === status ? 'selected' : ''}>${value.label}</option>
                            `).join('')}
                        </select>
                        <button class="btn btn-primary btn-sm" ${disabledSale ? 'disabled' : ''} onclick="convertCustomerOrderToSale(${order.id})">Valider en vente</button>
                        <button class="btn btn-outline btn-sm text-danger" ${status === 'annulee' ? 'disabled' : ''} onclick="cancelCustomerOrder(${order.id})">Annuler</button>
                    </div>
                </div>
            </article>
        `;
    }).join('');
}

function updateCustomerOrderStatus(orderId, nextStatus) {
    const order = (db.customerOrders || []).find(o => String(o.id) === String(orderId));
    if (!order || !CUSTOMER_ORDER_STATUSES[nextStatus]) return;

    const now = new Date().toISOString();
    order.status = nextStatus;
    order.updatedAt = now;
    if (!Array.isArray(order.history)) order.history = [];
    order.history.push({ status: nextStatus, date: now, note: CUSTOMER_ORDER_STATUSES[nextStatus].label });
    saveDataImmediate();
    renderCustomerOrdersPage();
    showToast('Statut de commande mis a jour', 'success');
}

function cancelCustomerOrder(orderId) {
    if (!confirm('Annuler cette commande client ?')) return;
    updateCustomerOrderStatus(orderId, 'annulee');
}

function findOrCreateCustomerOrderClient(order) {
    if (!db.clients) db.clients = [];
    const phone = normalizeCustomerPhone(order.customer?.phone);
    let client = db.clients.find(c => normalizeCustomerPhone(c.phone) === phone && phone);

    if (!client) {
        client = {
            id: `client-${Date.now()}`,
            name: order.customer?.name || 'Client',
            phone: order.customer?.phone || '-',
            email: '',
            address: order.customer?.address || '',
            orderCount: 0,
            totalRevenue: 0
        };
        db.clients.push(client);
    }

    return client;
}

function convertCustomerOrderToSale(orderId) {
    const order = (db.customerOrders || []).find(o => String(o.id) === String(orderId));
    if (!order || order.status === 'livree' || order.status === 'annulee') return;
    if (!confirm('Valider cette commande comme vente et decrementer le stock ?')) return;

    if (!db.orders) db.orders = [];
    if (!db.adjustments) db.adjustments = [];
    const client = findOrCreateCustomerOrderClient(order);
    const saleItems = (order.items || []).map(item => {
        const product = getProductById(item.productId);
        const quantity = parseInt(item.quantity, 10) || 1;

        if (product) {
            product.stock = (parseFloat(product.stock) || 0) - quantity;
            db.adjustments.unshift({
                id: Date.now() + Math.random(),
                productId: product.id,
                quantity: -quantity,
                reason: `Commande client ${order.code || order.id}`,
                date: new Date().toISOString(),
                user: 'Commandes'
            });
        }

        return {
            productId: item.productId,
            quantity,
            price: Number(item.price) || 0,
            origUnitPrice: Number(item.price) || 0,
            itemDiscount: 0,
            unitCost: product ? getSaleUnitCost({ productId: product.id }, product) : 0
        };
    });

    const total = Number(order.total) || saleItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const newOrder = {
        id: Date.now(),
        ticketNum: (db.orders || []).filter(o => new Date(o.date).toDateString() === new Date().toDateString()).length + 1,
        clientId: client.id,
        items: saleItems,
        total,
        discount: 0,
        originalTotal: total,
        date: new Date().toISOString(),
        payment: null,
        paymentStatus: 'unpaid',
        source: 'client-order',
        customerOrderId: order.id,
        customerOrderCode: order.code
    };

    db.orders.push(newOrder);
    const invoice = createInvoiceFromSale(newOrder, client.id, {
        title: `Commande client ${order.code || order.id}`,
        source: 'client-order'
    });
    if (invoice) {
        newOrder.invoiceId = invoice.id;
        newOrder.invoiceNumber = invoice.number;
        order.invoiceId = invoice.id;
    }
    client.orderCount = (client.orderCount || 0) + 1;
    client.totalRevenue = (client.totalRevenue || 0) + total;

    order.status = 'livree';
    order.processedAt = new Date().toISOString();
    order.updatedAt = order.processedAt;
    if (!Array.isArray(order.history)) order.history = [];
    order.history.push({ status: 'livree', date: order.processedAt, note: 'Validee en vente' });

    saveDataImmediate();
    renderCustomerOrdersPage();
    showToast('Commande validee en vente', 'success');
    generateTicket(newOrder);
}

function initCustomerOrdersPage() {
    loadData().then(() => {
        initTheme();
        fillDbDefaults();
        renderCustomerOrdersPage();
        document.getElementById('customerOrderStatusFilter')?.addEventListener('change', renderCustomerOrdersPage);
        document.getElementById('customerOrderSearch')?.addEventListener('input', renderCustomerOrdersPage);
    });
}

// ==========================================
// Init
// ==========================================

function initDashboard() {
    loadData().then(() => {
        try {
            initTheme();
            renderCategories();
            renderProducts();
            updateCart();
            initClientSelector();
            renderParallelOrderTabs();
            initBarcodeScanner();

            // Restore lost UI listeners
            const checkoutBtn = document.getElementById('checkoutBtn');
            if (checkoutBtn) checkoutBtn.addEventListener('click', checkout);

            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.addEventListener('input', () => {
                    renderProducts();
                });
            }
        } catch (e) {
            console.error('Dashboard Init Error:', e);
            showToast('Erreur lors du chargement du tableau de bord', 'error');
        }
    });
}

function ensureFinanceNavLink() {
    const nav = document.querySelector('.navbar-nav');
    if (!nav || nav.querySelector('[href="finances.html"]')) return;

    const link = document.createElement('a');
    link.href = 'finances.html';
    link.className = `navbar-link ${window.location.pathname.includes('finances') ? 'active' : ''}`;
    link.title = 'Finances';
    link.setAttribute('aria-label', 'Finances');
    link.innerHTML = `
        <svg class="navbar-icon" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>
        <span>Finances</span>
    `;

    const commandesLink = nav.querySelector('[href="commandes.html"]');
    if (commandesLink && commandesLink.nextSibling) {
        nav.insertBefore(link, commandesLink.nextSibling);
    } else {
        nav.appendChild(link);
    }
}

document.addEventListener('DOMContentLoaded', function () {
    ensureFinanceNavLink();
    const path = window.location.pathname;

    if (path.includes('inventory')) {
        // Inline script
    } else if (path.includes('stats')) {
        // Inline script
    } else if (path.includes('categories')) {
        // Inline script
    } else if (path.includes('settings')) {
        loadData();
    } else if (path.includes('commandes')) {
        initCustomerOrdersPage();
    } else if (path.includes('finances')) {
        initFinancePage();
    } else if (path.includes('withdrawals')) {
        initWithdrawalsPage();
    } else {
        initDashboard();
    }
});
// ==========================================
// THRESHOLD TOUCH/POINTER SYSTEM (HOLD TO CLICK)
// ==========================================
let cardPressTimer = null;
let activePressEl = null;
let activePressId = null;
let activePressType = null; // 'cart' or 'inventory'
let pressStartPos = { x: 0, y: 0 };
let pressHasMoved = false;
let lastTapTime = 0;

function onCardDown(e, id, el, type) {
    // Basic right-click prevention
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    // If the pointerdown started on an interactive control (input, button, qty controls),
    // don't treat it as a card press to avoid triggering add-to-cart and re-rendering.
    if (e.target && e.target.closest) {
        const ignoreSelector = 'input, textarea, button, select, .card-qty-input, .cart-qty-input, .cart-qty-btn, .cart-qty-value';
        if (e.target.closest(ignoreSelector)) return;
    }

    // Handle Double Tap for Inventory (specifically for Edit)
    if (type === 'inventory' || type === 'component') {
        const now = Date.now();
        if (now - lastTapTime < 300) {
            cancelCardPress();
            if (type === 'inventory') {
                editProduct(id);
            } else {
                if (typeof handleComponentEdit === 'function') handleComponentEdit(id);
            }
            lastTapTime = 0;
            return;
        }
        lastTapTime = now;
    }

    cancelCardPress();

    activePressEl = el;
    activePressId = id;
    activePressType = type;
    pressStartPos = { x: e.clientX, y: e.clientY };
    pressHasMoved = false;

    el.classList.add('pressing');

    // HOLD TO CLICK: Required for all modules EXCEPT 'cart' (Vente)
    if (type !== 'cart') {
        cardPressTimer = setTimeout(() => {
            triggerCardAction();
        }, 300); // 300ms hold for Management/Stock actions
    }
}

function onCardMove(e) {
    if (!activePressEl) return;
    const dist = Math.sqrt(Math.pow(e.clientX - pressStartPos.x, 2) + Math.pow(e.clientY - pressStartPos.y, 2));
    if (dist > 10) { // More sensitive to prevent accidental fire during scroll
        pressHasMoved = true;
        cancelCardPress();
    }
}

// Global protection: cancel any card press if ANY container scrolls
document.addEventListener('scroll', () => {
    if (activePressEl) cancelCardPress();
}, true);

function onCardUp(e) {
    // Instant click ONLY for 'cart' (Vente). Others use the Hold timer.
    if (activePressEl && !pressHasMoved && activePressType === 'cart') {
        triggerCardAction();
    }
    cancelCardPress();
}

function triggerCardAction() {
    if (!activePressEl) return;

    const el = activePressEl;
    const id = activePressId;
    const type = activePressType;

    cancelCardPress();

    el.classList.add('press-fired');
    setTimeout(() => el.classList.remove('press-fired'), 300);

    if (navigator.vibrate) navigator.vibrate(15);

    if (type === 'cart') {
        addToCartAnimated(id, el);
    } else if (type === 'inventory') {
        handleQuickAddStock(id);
    } else if (type === 'component') {
        // Long click for component = History
        if (typeof showComponentHistory === 'function') {
            showComponentHistory(id);
        } else if (typeof handleComponentEdit === 'function') {
            handleComponentEdit(id);
        }
    }
}

function cancelCardPress() {
    if (cardPressTimer) clearTimeout(cardPressTimer);
    if (activePressEl) activePressEl.classList.remove('pressing');
    cardPressTimer = null;
    activePressEl = null;
}
