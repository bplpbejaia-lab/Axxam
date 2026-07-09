
document.addEventListener('DOMContentLoaded', function () {
    initSettingsPage();

    // --- Helper to show/hide sections based on role ---
    const currentUser = authService.getCurrentUser();
    if (currentUser && currentUser.role === 'admin') {
        document.getElementById('adminSection').style.display = 'block';
        loadUserTable();
    } else {
        document.getElementById('adminSection').style.display = 'none';
    }

    // --- Logout Logic ---
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            if (confirm('Voulez-vous vraiment vous déconnecter ?')) {
                authService.logout();
            }
        });
    }

    // --- Password Change Logic ---
    document.getElementById('changePasswordBtn').addEventListener('click', () => {
        const current = document.getElementById('currentPassword').value;
        const newPwd = document.getElementById('newPassword').value;

        if (!currentUser) return;

        const result = authService.changePassword(currentUser.username, current, newPwd);
        alert(result.message);
        if (result.success) {
            document.getElementById('currentPassword').value = '';
            document.getElementById('newPassword').value = '';
        }
    });

    // --- Keyboard Toggle Logic ---
    const keyboardToggle = document.getElementById('keyboardToggle');
    const vk = window.virtualKeyboard;

    if (keyboardToggle && vk) {
        keyboardToggle.checked = vk.isEnabled;
        keyboardToggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                vk.enable();
            } else {
                vk.disable();
            }
        });
    }

    // --- Arrow Buttons Toggle Logic ---
    const scrollArrowsToggle = document.getElementById('scrollArrowsToggle');
    const arrowsEnabled = localStorage.getItem('scroll_arrows_enabled') !== 'false'; // Default to true
    if (scrollArrowsToggle) {
        scrollArrowsToggle.checked = arrowsEnabled;
        scrollArrowsToggle.addEventListener('change', (e) => {
            localStorage.setItem('scroll_arrows_enabled', e.target.checked);
            // Apply immediately to current body
            if (e.target.checked) {
                document.body.classList.remove('hide-scroll-arrows');
            } else {
                document.body.classList.add('hide-scroll-arrows');
            }
        });
    }

    // --- Branding Logic ---

    // 1. Logo
    const savedLogo = localStorage.getItem('cafe_logo');
    if (savedLogo) {
        // Update preview if exists (it doesn't yet, but generic logic)
    }

    document.getElementById('logoInput').addEventListener('change', function (e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function (event) {
            const dataUrl = event.target.result;
            localStorage.setItem('cafe_logo', dataUrl);
            alert("Logo mis à jour ! Recharger la page pour voir les changements partout.");
            // Update current page logo immediately
            document.querySelectorAll('.navbar-logo').forEach(el => {
                // Check if it's text or img. Currently text ☕. We should replace with img if custom.
                el.innerHTML = `<img src="${dataUrl}" style="width:100%; height:100%; object-fit:contain; border-radius:inherit;">`;
            });
        };
        reader.readAsDataURL(file);
    });

    // 2. Background Login
    document.getElementById('bgInput').addEventListener('change', function (e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function (event) {
            const dataUrl = event.target.result;
            localStorage.setItem('cafe_login_bg', dataUrl);
            alert("Image de fond de connexion mise à jour !");
        };
        reader.readAsDataURL(file);
    });

    document.getElementById('resetBrandingBtn').addEventListener('click', () => {
        if (confirm('Réinitialiser le logo et le fond ?')) {
            localStorage.removeItem('cafe_logo');
            localStorage.removeItem('cafe_login_bg');
            location.reload();
        }
    });

    const createEmptyDb = () => ({
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
    });

    const clearDatabaseStorageKeys = () => {
        [
            'cafegestion_db',
            'cafegestion_parallel_orders',
            'cafegestion_current_cart',
            'cafegestion_current_client',
            'use_file_db'
        ].forEach(k => localStorage.removeItem(k));
        try { sessionStorage.removeItem('cafegestion_current_cart'); } catch (e) { /* ignore */ }
    };

    const clearLegacyDbStorageKeys = () => {
        [
            'cafegestion_db',
            'cafegestion_parallel_orders',
            'use_file_db'
        ].forEach(k => localStorage.removeItem(k));
    };

    const resetServerDb = async () => {
        if (!location.protocol.startsWith('http')) return false;
        const response = await fetch('/api/db', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                db: createEmptyDb(),
                parallelOrders: []
            })
        });
        if (!response.ok) throw new Error('Reset SQLite impossible');
        return true;
    };

    const resetDatabaseToZero = async (button = null) => {
        const firstConfirm = confirm('ATTENTION: remettre toute la BDD a 0 ? Ventes, achats, produits, stock, clients, fournisseurs, commandes et soldes seront supprimes.');
        if (!firstConfirm) return;

        const secondConfirm = confirm('Derniere confirmation: cette action est definitive. Continuer ?');
        if (!secondConfirm) return;

        const originalText = button ? button.innerHTML : '';
        if (button) {
            button.disabled = true;
            button.innerHTML = 'Reset en cours...';
        }

        try {
            const emptyDb = createEmptyDb();
            if (location.protocol.startsWith('http')) {
                await resetServerDb();
            }

            clearDatabaseStorageKeys();
            localStorage.setItem('cafegestion_db', JSON.stringify(emptyDb));
            localStorage.setItem('cafegestion_parallel_orders', '[]');
            if (window.db) window.db = emptyDb;
            window.parallelOrdersCache = [];

            alert('BDD remise a 0. Rechargement...');
            location.reload();
        } catch (error) {
            console.error('Reset BDD Error:', error);
            alert('Erreur pendant la remise a zero de la BDD.');
            if (button) {
                button.disabled = false;
                button.innerHTML = originalText;
            }
        }
    };

    const topResetBtn = document.getElementById('resetDatabaseTopBtn');
    if (topResetBtn) {
        topResetBtn.addEventListener('click', () => resetDatabaseToZero(topResetBtn));
    }

    const readCurrentDb = async () => {
        if (location.protocol.startsWith('http')) {
            const response = await fetch('/api/db', { cache: 'no-store' });
            if (response.ok) {
                const state = await response.json();
                return state.db || {};
            }
        }
        return window.db || JSON.parse(localStorage.getItem('cafegestion_db') || '{}');
    };

    const clearDbBtn = document.getElementById('clearAppDbBtn');
    if (clearDbBtn) {
        clearDbBtn.addEventListener('click', async () => {
            resetDatabaseToZero(clearDbBtn);
        });
    }

    // Clear all data function (available to all users)
    window.clearAllData = async function() {
        resetDatabaseToZero();
    };

    // Export current in-memory DB as plain database.json (download)
    window.downloadDatabaseFile = async function () {
        try {
            const dataStr = JSON.stringify(await readCurrentDb(), null, 4);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'database.json';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1500);
            alert('Export termine depuis la base active.');
        } catch (e) {
            console.error('Export DB Error:', e);
            alert('Erreur lors de l\'export de la base');
        }
    };

    // Migrate: export then clear legacy localStorage
    window.migrateToFile = async function () {
        if (!confirm("Exporter la base active puis vider l'ancien stockage local du navigateur ?")) return;
        await window.downloadDatabaseFile();
        setTimeout(() => {
            clearLegacyDbStorageKeys();
            alert('Ancien LocalStorage vide. La base SQLite reste la source active.');
            location.reload();
        }, 800);
    };


    // --- User Management Logic (Admin) ---

    document.getElementById('addUserForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const u = document.getElementById('newUsername').value;
        const p = document.getElementById('newUserPwd').value;
        const n = document.getElementById('newName').value;
        const r = document.getElementById('newRole').value;

        const res = authService.addUser(u, p, r, n);
        alert(res.message);
        if (res.success) {
            document.getElementById('addUserForm').reset();
            loadUserTable();
        }
    });

    window.deleteUser = function (username) {
        if (confirm('Êtes-vous sûr de vouloir supprimer ' + username + ' ?')) {
            const res = authService.deleteUser(username);
            alert(res.message);
            if (res.success) loadUserTable();
        }
    };

    function loadUserTable() {
        const users = authService.getUsers();
        const tbody = document.getElementById('usersTableBody');
        tbody.innerHTML = '';

        const pages = [
            { id: 'index.html', label: 'Ventes' },
            { id: 'inventory.html', label: 'Stock' },
            { id: 'stats.html', label: 'Stats' },
            { id: 'categories.html', label: 'Catég.' },
            { id: 'settings.html', label: 'Param.' }
        ];

        users.forEach(u => {
            const tr = document.createElement('tr');

            // User info cell
            let html = `<td>
                <div style="font-weight:700">${u.name}</div>
                <div class="text-xs text-muted">@${u.username}</div>
                <span class="role-tag ${u.role === 'admin' ? 'role-admin' : 'role-user'}">${u.role}</span>
            </td>`;

            // Permission checkboxes
            pages.forEach(page => {
                const isChecked = (u.role === 'admin' || (u.permissions && u.permissions.includes(page.id))) ? 'checked' : '';
                const isDisabled = (u.role === 'admin' || u.username === currentUser.username) ? 'disabled' : '';

                html += `<td style="text-align:center">
                    <input type="checkbox" class="perm-checkbox" 
                        data-username="${u.username}" 
                        data-page="${page.id}" 
                        ${isChecked} ${isDisabled}>
                </td>`;
            });

            // Action cell
            html += `<td>
                ${(u.username !== currentUser.username && u.role !== 'admin') ?
                    `<button class="btn btn-sm btn-danger" onclick="deleteUser('${u.username}')">✕</button>` :
                    '<span class="text-muted text-xs">Protégé</span>'}
            </td>`;

            tr.innerHTML = html;
            tbody.appendChild(tr);
        });

        // Add event listeners for checkboxes
        document.querySelectorAll('.perm-checkbox:not(:disabled)').forEach(cb => {
            cb.addEventListener('change', function () {
                const username = this.dataset.username;
                const pageId = this.dataset.page;

                let user = authService.getUsers().find(u => u.username === username);
                let perms = user.permissions || [];

                if (this.checked) {
                    if (!perms.includes(pageId)) perms.push(pageId);
                } else {
                    perms = perms.filter(p => p !== pageId);
                }

                const res = authService.updateUserPermissions(username, perms);
                if (!res.success) {
                    alert(res.message);
                    this.checked = !this.checked; // Revert
                }
            });
        });
    }
});
