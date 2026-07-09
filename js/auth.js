
/**
 * Authentication Service for Axxam
 * Handles user login, logout, role management, and session checks.
 */

const USERS_KEY = 'cafe_users';
const CURRENT_USER_KEY = 'cafe_current_user';
const ADMIN_HOME_PAGE = 'stats.html';
const LEGACY_ADMIN_HOME_PAGE = 'index.html';
const USER_HOME_PAGE = 'index.html';
const ADMIN_BLOCKED_PAGES = ['index.html'];
const LEGACY_ADMIN_ROLE = 'legacy_admin';

// Default users if none exist
const DEFAULT_USERS = [
    { username: 'admin', password: 'admin', role: 'admin', name: 'Administrateur' },
    { username: 'user', password: 'user123', role: 'user', name: 'Serveur' },
    { username: 'zz', password: 'zz', role: 'user', name: 'Administrateur' }
];

class AuthService {
    constructor() {
        this.initUsers();
    }

    initUsers() {
        if (!localStorage.getItem(USERS_KEY)) {
            localStorage.setItem(USERS_KEY, JSON.stringify(DEFAULT_USERS));
            return;
        }

        const users = this.getUsers();
        const admin = users.find(u => u.username === 'admin');

        // Migrate old local installs from admin/password to admin/admin.
        if (admin && admin.role === 'admin' && admin.password === 'password') {
            admin.password = 'admin';
            localStorage.setItem(USERS_KEY, JSON.stringify(users));
        }
    }

    getUsers() {
        return JSON.parse(localStorage.getItem(USERS_KEY));
    }

    login(username, password) {
        if (username === 'admin' && password === 'password') {
            const sessionUser = {
                username: 'admin',
                role: LEGACY_ADMIN_ROLE,
                name: 'Administrateur',
                permissions: []
            };
            localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(sessionUser));
            return { success: true, user: sessionUser };
        }

        const users = this.getUsers();
        const user = users.find(u => u.username === username && u.password === password);

        if (user) {
            // Store minimal user info (excluding password), include permissions
            const sessionUser = {
                username: user.username,
                role: user.role,
                name: user.name,
                permissions: user.permissions || []
            };
            localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(sessionUser));
            return { success: true, user: sessionUser };
        }
        return { success: false, message: 'Identifiants incorrects' };
    }

    logout() {
        localStorage.removeItem(CURRENT_USER_KEY);
        window.location.href = 'login.html';
    }

    getCurrentUser() {
        const userStr = localStorage.getItem(CURRENT_USER_KEY);
        return userStr ? JSON.parse(userStr) : null;
    }

    getHomePage(user = this.getCurrentUser()) {
        if (user && user.role === LEGACY_ADMIN_ROLE) return LEGACY_ADMIN_HOME_PAGE;
        return user && user.role === 'admin' ? ADMIN_HOME_PAGE : USER_HOME_PAGE;
    }

    isAdminLike(user) {
        return user && (user.role === 'admin' || user.role === LEGACY_ADMIN_ROLE);
    }

    applyRoleShell(user = this.getCurrentUser()) {
        if (!user || typeof document === 'undefined') return;

        document.documentElement.classList.toggle('role-admin', user.role === 'admin');
        document.documentElement.classList.toggle('role-user', user.role !== 'admin');

        const applyBodyClass = () => {
            if (!document.body) return;
            document.body.classList.toggle('role-admin', user.role === 'admin');
            document.body.classList.toggle('role-user', user.role !== 'admin');
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', applyBodyClass, { once: true });
        } else {
            applyBodyClass();
        }
    }

    applyNavigationForRole(user = this.getCurrentUser()) {
        if (!user || typeof document === 'undefined') return;

        const apply = () => {
            const nav = document.querySelector('.navbar-nav');
            if (!nav) return;

            if (user.role === 'admin') {
                this.applyAdminPublicShell(user);
            }
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', apply);
        } else {
            apply();
        }
    }

    applyAdminPublicShell(user) {
        const navbar = document.querySelector('.top-navbar');
        const nav = document.querySelector('.navbar-nav');
        const brand = document.querySelector('.navbar-brand');
        if (!navbar || !nav) return;
        if (navbar.dataset.adminPublicShell === 'true') return;
        navbar.dataset.adminPublicShell = 'true';

        const page = (window.location.pathname.split('/').pop() || 'stats.html').toLowerCase();
        const activeFor = (targets) => targets.includes(page) ? ' active' : '';
        const navItems = [
            { href: 'stats.html', label: 'Dashboard', icon: 'M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z', pages: ['stats.html'] },
            { href: 'finances.html', label: 'Clients', icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75', pages: ['finances.html'] },
            { href: 'inventory.html', label: 'Produits', icon: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16ZM3.3 7 12 12l8.7-5M12 22V12', pages: ['inventory.html'] },
            { href: 'commandes.html', label: 'Commandes', icon: 'M9 11h6M9 15h6M8 3h8l2 3v15H6V6zM8 3v3h10', pages: ['commandes.html'] },
            { href: 'achats.html', label: 'Achats', icon: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4H6ZM3 6h18M16 10a4 4 0 0 1-8 0', pages: ['achats.html'] },
            { href: 'withdrawals.html', label: 'Caisse', icon: 'M2 6h20v12H2zM6 12h.01M18 12h.01M12 12h.01', pages: ['withdrawals.html'] },
            { href: 'categories.html', label: 'Categories', icon: 'M15 5 21.3 11.3a2.8 2.8 0 0 1 0 4L15 21M7 5l6.3 6.3a2.8 2.8 0 0 1 0 4L7 21M2 13.5V5a3 3 0 0 1 3-3h8.5M7 7h.01', pages: ['categories.html'] },
            { href: 'settings.html', label: 'Utilisateurs', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75', pages: ['settings.html'] }
        ];

        if (brand) {
            brand.innerHTML = `
                <div class="admin-public-brand">
                    <div class="admin-public-logo">
                        <span class="admin-public-book"></span>
                    </div>
                    <div>
                        <strong>Axxam</strong>
                        <span>Administration</span>
                    </div>
                </div>
            `;
        }

        nav.innerHTML = navItems.map(item => `
            <a href="${item.href}" class="navbar-link${activeFor(item.pages)}" title="${item.label}" aria-label="${item.label}">
                <svg class="navbar-icon" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="${item.icon}"/></svg>
                <span>${item.label}</span>
            </a>
        `).join('') + `
            <button type="button" class="navbar-link admin-logout-link" onclick="authService.logout()">
                <svg class="navbar-icon" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
                <span>Deconnexion</span>
            </button>
        `;

        this.injectAdminTopbar(page);

        const oldInfo = navbar.querySelector('.admin-info');
        if (oldInfo) oldInfo.remove();
        navbar.insertAdjacentHTML('beforeend', `
            <div class="admin-info">
                <div class="admin-profile">
                    <div class="admin-avatar">${(user.name || user.username || 'A').charAt(0).toUpperCase()}</div>
                    <div class="admin-details">
                        <h4>${this.escapeHtml(user.name || 'Administrateur')}</h4>
                        <p>${this.escapeHtml(user.username || 'admin')}@axxam.dz</p>
                    </div>
                </div>
            </div>
        `);
    }

    injectAdminTopbar(page) {
        const mainArea = document.querySelector('.main-area');
        if (!mainArea || mainArea.querySelector('.admin-public-topbar')) return;

        const titles = {
            'stats.html': ['Tableau de bord', "Vue d'ensemble de l'activite"],
            'finances.html': ['Clients / Fournisseurs', 'Soldes, factures et etats'],
            'inventory.html': ['Produits', 'Catalogue et stock'],
            'commandes.html': ['Commandes', 'Suivi des commandes clients'],
            'achats.html': ['Achats', 'Bons, factures et retours fournisseurs'],
            'withdrawals.html': ['Caisse', 'Retraits et mouvements'],
            'categories.html': ['Categories', 'Organisation du catalogue'],
            'settings.html': ['Utilisateurs', 'Parametres et acces']
        };
        const [title, subtitle] = titles[page] || ['Dashboard', 'Administration'];
        const sourceActions = document.querySelector('.top-navbar > .navbar-actions');

        const topbar = document.createElement('section');
        topbar.className = 'admin-public-topbar';
        topbar.innerHTML = `
            <div class="admin-public-title">
                <h1>${title}</h1>
                <p>${subtitle}</p>
            </div>
            <div class="admin-public-actions"></div>
        `;

        const actions = topbar.querySelector('.admin-public-actions');
        const hasOnlyThemeToggle = sourceActions
            && sourceActions.children.length === 1
            && sourceActions.querySelector('#themeToggle');

        if (sourceActions && sourceActions.children.length && !hasOnlyThemeToggle) {
            while (sourceActions.firstChild) actions.appendChild(sourceActions.firstChild);
        } else {
            actions.innerHTML = `
                <div class="admin-public-search">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                    <input type="search" placeholder="Rechercher...">
                </div>
            `;
        }

        mainArea.insertBefore(topbar, mainArea.firstChild);
    }

    escapeHtml(value) {
        return String(value || '').replace(/[&<>"']/g, char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[char]));
    }

    checkAuth(requiredRole = null) {
        const user = this.getCurrentUser();
        const path = window.location.pathname;
        const pageName = path.split('/').pop() || 'index.html';
        const isLoginPage = pageName.toLowerCase() === 'login.html';

        // 1. User NOT Logged In
        if (!user) {
            if (!isLoginPage) {
                document.documentElement.style.visibility = 'hidden';
                document.documentElement.style.display = 'none';
                window.location.replace('login.html');
                return null;
            }
            return null;
        }

        // 2. User IS Logged In
        this.applyRoleShell(user);
        this.applyNavigationForRole(user);

        if (isLoginPage) {
            window.location.replace(this.getHomePage(user));
            return user;
        }

        // 3. Admin uses management pages only, not the sales page.
        if (user.role === 'admin' && ADMIN_BLOCKED_PAGES.includes(pageName.toLowerCase())) {
            window.location.replace(ADMIN_HOME_PAGE);
            return null;
        }

        // 4. Admin-like accounts have access to management pages.
        if (this.isAdminLike(user)) return user;

        // 5. Role verification (legacy/hardcoded)
        if (requiredRole && user.role !== requiredRole) {
            window.location.replace('access-denied.html?page=' + encodeURIComponent(pageName));
            return null;
        }

        // 6. Granular Page Permission Check
        // Get full user data to see permissions (session user might be limited)
        const allUsers = this.getUsers();
        const fullUser = allUsers.find(u => u.username === user.username);

        if (fullUser && fullUser.permissions) {
            // If the user has a specific list of allowed pages
            const isAllowed = fullUser.permissions.some(p => pageName.toLowerCase().indexOf(p.toLowerCase()) !== -1);
            if (!isAllowed) {
                window.location.replace('access-denied.html?page=' + encodeURIComponent(pageName));
                return null;
            }
        }

        return user;
    }

    updateUserPermissions(username, permissions) {
        const users = this.getUsers();
        const index = users.findIndex(u => u.username === username);
        if (index !== -1) {
            users[index].permissions = permissions;
            localStorage.setItem(USERS_KEY, JSON.stringify(users));
            return { success: true, message: 'Permissions mises à jour' };
        }
        return { success: false, message: 'Utilisateur non trouvé' };
    }

    addUser(username, password, role, name) {
        if (!username || !password || !role || !name) return { success: false, message: 'Tous les champs sont requis' };

        const users = this.getUsers();
        if (users.find(u => u.username === username)) {
            return { success: false, message: 'Nom d\'utilisateur déjà pris' };
        }

        // Default permissions for new users: just the main page
        const permissions = role === 'admin' ? [] : ['index.html'];
        users.push({ username, password, role, name, permissions });
        localStorage.setItem(USERS_KEY, JSON.stringify(users));
        return { success: true, message: 'Utilisateur ajouté avec succès' };
    }

    deleteUser(username) {
        let users = this.getUsers();
        const currentUser = this.getCurrentUser();

        if (username === currentUser.username) {
            return { success: false, message: 'Vous ne pouvez pas supprimer votre propre compte' };
        }

        // Cannot delete the last admin
        const admins = users.filter(u => u.role === 'admin');
        if (admins.length === 1 && admins[0].username === username) {
            return { success: false, message: 'Impossible de supprimer le dernier administrateur' };
        }

        const initialLength = users.length;
        users = users.filter(u => u.username !== username);

        if (users.length === initialLength) {
            return { success: false, message: 'Utilisateur non trouvé' };
        }

        localStorage.setItem(USERS_KEY, JSON.stringify(users));
        return { success: true, message: 'Utilisateur supprimé' };
    }

    changePassword(username, oldPassword, newPassword) {
        const users = this.getUsers();
        const userIndex = users.findIndex(u => u.username === username);

        if (userIndex === -1) return { success: false, message: 'Utilisateur non trouvé' };

        if (users[userIndex].password !== oldPassword) {
            return { success: false, message: 'Ancien mot de passe incorrect' };
        }

        users[userIndex].password = newPassword;
        localStorage.setItem(USERS_KEY, JSON.stringify(users));
        return { success: true, message: 'Mot de passe modifié avec succès' };
    }
}

// Global instance
const authService = new AuthService();
