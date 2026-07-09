
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
                nav.querySelectorAll('a[href="index.html"]').forEach(link => link.remove());
            }
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', apply);
        } else {
            apply();
        }
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
