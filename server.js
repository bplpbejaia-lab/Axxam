const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'axxam.sqlite');
const SEED_FILE = path.join(DATA_DIR, 'database.json');
const PORT = Number(process.env.PORT) || 5173;

fs.mkdirSync(DATA_DIR, { recursive: true });

const sqlite = new DatabaseSync(DB_FILE);
sqlite.exec(`
    CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
`);

const getStateStmt = sqlite.prepare('SELECT value FROM app_state WHERE key = ?');
const upsertStateStmt = sqlite.prepare(`
    INSERT INTO app_state (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = datetime('now')
`);
const clearStateStmt = sqlite.prepare('DELETE FROM app_state');

function defaultDb() {
    return {
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
}

function readJson(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        console.warn(`Impossible de lire ${filePath}:`, error.message);
        return fallback;
    }
}

function seedState() {
    const seededDb = readJson(SEED_FILE, defaultDb());
    upsertStateStmt.run('db', JSON.stringify(seededDb));
    upsertStateStmt.run('parallelOrders', '[]');
    return {
        db: seededDb,
        parallelOrders: [],
        source: 'sqlite'
    };
}

function parseStateValue(key, fallback) {
    const row = getStateStmt.get(key);
    if (!row || !row.value) return fallback;

    try {
        return JSON.parse(row.value);
    } catch (error) {
        console.warn(`Etat SQLite invalide pour ${key}:`, error.message);
        return fallback;
    }
}

function readState() {
    const dbRow = getStateStmt.get('db');
    if (!dbRow) return seedState();

    return {
        db: parseStateValue('db', defaultDb()),
        parallelOrders: parseStateValue('parallelOrders', []),
        source: 'sqlite'
    };
}

function writeState(payload) {
    if (!payload || typeof payload !== 'object' || !payload.db || typeof payload.db !== 'object') {
        const error = new Error('Payload invalide: { db, parallelOrders } attendu');
        error.statusCode = 400;
        throw error;
    }

    const parallelOrders = Array.isArray(payload.parallelOrders) ? payload.parallelOrders : [];
    upsertStateStmt.run('db', JSON.stringify(payload.db));
    upsertStateStmt.run('parallelOrders', JSON.stringify(parallelOrders));
    return readState();
}

function normalizePhone(phone) {
    return String(phone || '').replace(/\s+/g, '').trim();
}

function normalizeLogin(login) {
    return String(login || '').trim().toLowerCase();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const hash = crypto.scryptSync(String(password), salt, 32).toString('hex');
    return { salt, hash };
}

function verifyPassword(password, account) {
    if (!account || !account.passwordHash || !account.passwordSalt) return false;
    const { hash } = hashPassword(password, account.passwordSalt);
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(account.passwordHash, 'hex'));
}

function publicAccount(account) {
    if (!account) return null;
    return {
        id: account.id,
        login: account.login,
        name: account.name,
        phone: account.phone,
        address: account.address || '',
        createdAt: account.createdAt
    };
}

function ensureClientAccounts(currentDb) {
    if (!Array.isArray(currentDb.clientAccounts)) currentDb.clientAccounts = [];
    return currentDb.clientAccounts;
}

function registerClientAccount(payload) {
    const state = readState();
    const currentDb = state.db || defaultDb();
    const accounts = ensureClientAccounts(currentDb);
    const login = normalizeLogin(payload.login);
    const password = String(payload.password || '');
    const name = String(payload.name || '').trim();
    const phone = normalizePhone(payload.phone);
    const address = String(payload.address || '').trim();
    const now = new Date().toISOString();

    if (!login || !password || !name || !phone) {
        const error = new Error('Login, mot de passe, nom et telephone obligatoires');
        error.statusCode = 400;
        throw error;
    }

    if (password.length < 4) {
        const error = new Error('Mot de passe trop court');
        error.statusCode = 400;
        throw error;
    }

    if (accounts.some(account => normalizeLogin(account.login) === login)) {
        const error = new Error('Ce login existe deja');
        error.statusCode = 409;
        throw error;
    }

    const passwordData = hashPassword(password);
    const account = {
        id: `acct-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`,
        login,
        name,
        phone,
        address,
        passwordHash: passwordData.hash,
        passwordSalt: passwordData.salt,
        createdAt: now,
        updatedAt: now
    };

    accounts.push(account);
    writeState({ db: currentDb, parallelOrders: state.parallelOrders || [] });
    return publicAccount(account);
}

function loginClientAccount(payload) {
    const state = readState();
    const currentDb = state.db || defaultDb();
    const accounts = ensureClientAccounts(currentDb);
    const login = normalizeLogin(payload.login);
    const account = accounts.find(item => normalizeLogin(item.login) === login);

    if (!verifyPassword(payload.password || '', account)) {
        const error = new Error('Login ou mot de passe incorrect');
        error.statusCode = 401;
        throw error;
    }

    return publicAccount(account);
}

function publicCatalog() {
    const state = readState();
    const currentDb = state.db || defaultDb();
    const products = Array.isArray(currentDb.products) ? currentDb.products : [];
    const categories = Array.isArray(currentDb.categories) ? currentDb.categories : [];

    return {
        categories,
        products: products.map(product => ({
            id: product.id,
            name: product.name,
            category: product.category,
            price: Number(product.price) || 0,
            image: product.image || '',
            stock: Number(product.stock) || 0,
            minStock: Number(product.minStock) || 0,
            isFavorite: !!product.isFavorite
        }))
    };
}

function buildClientOrder(payload) {
    const state = readState();
    const currentDb = state.db || defaultDb();
    const products = Array.isArray(currentDb.products) ? currentDb.products : [];
    const accounts = ensureClientAccounts(currentDb);
    const accountId = String(payload.accountId || '').trim();
    const account = accounts.find(item => String(item.id) === accountId);
    const customer = payload.customer || {};
    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    const now = new Date().toISOString();

    if (!account) {
        const error = new Error('Connexion client obligatoire');
        error.statusCode = 401;
        throw error;
    }

    const name = String(account?.name || customer.name || '').trim();
    const phone = normalizePhone(account?.phone || customer.phone);
    const address = String(payload.address || customer.address || account?.address || '').trim();
    if (!name || !phone) {
        const error = new Error('Compte client invalide');
        error.statusCode = 400;
        throw error;
    }

    const items = rawItems.map(item => {
        const product = products.find(p => String(p.id) === String(item.productId));
        const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);
        if (!product) return null;
        return {
            productId: product.id,
            name: product.name,
            quantity,
            price: Number(product.price) || 0,
            image: product.image || ''
        };
    }).filter(Boolean);

    if (!items.length) {
        const error = new Error('Commande vide');
        error.statusCode = 400;
        throw error;
    }

    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const code = `CMD-${Date.now().toString(36).toUpperCase()}`;
    const order = {
        id: Date.now(),
        code,
        source: 'client-app',
        accountId: account ? account.id : null,
        accountLogin: account ? account.login : null,
        status: 'nouvelle',
        paymentStatus: 'a_regler',
        customer: {
            name,
            phone,
            address
        },
        note: String(payload.note || '').trim(),
        items,
        total,
        createdAt: now,
        updatedAt: now,
        history: [
            { status: 'nouvelle', date: now, note: 'Commande recue' }
        ]
    };

    if (!Array.isArray(currentDb.customerOrders)) currentDb.customerOrders = [];
    currentDb.customerOrders.unshift(order);
    writeState({ db: currentDb, parallelOrders: state.parallelOrders || [] });
    return order;
}

async function handleClientApi(req, res, url) {
    if (url.pathname === '/api/client/catalog' && req.method === 'GET') {
        sendJson(res, 200, publicCatalog());
        return true;
    }

    if (url.pathname === '/api/client/register' || url.pathname === '/api/client/login') {
        try {
            if (req.method !== 'POST') {
                sendJson(res, 405, { error: 'Methode non autorisee' });
                return true;
            }

            const body = await readBody(req);
            const payload = body ? JSON.parse(body) : {};
            const account = url.pathname.endsWith('/register')
                ? registerClientAccount(payload)
                : loginClientAccount(payload);
            sendJson(res, 200, { account });
            return true;
        } catch (error) {
            sendJson(res, error.statusCode || 500, { error: error.message || 'Erreur serveur' });
            return true;
        }
    }

    if (url.pathname === '/api/client/orders') {
        try {
            if (req.method === 'GET') {
                const accountId = String(url.searchParams.get('accountId') || '').trim();
                const phone = normalizePhone(url.searchParams.get('phone'));
                const state = readState();
                const orders = ((state.db && state.db.customerOrders) || [])
                    .filter(order => {
                        if (accountId) return String(order.accountId || '') === accountId;
                        return normalizePhone(order.customer && order.customer.phone) === phone;
                    })
                    .sort((a, b) => new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0));
                sendJson(res, 200, { orders });
                return true;
            }

            if (req.method === 'POST') {
                const body = await readBody(req);
                const order = buildClientOrder(body ? JSON.parse(body) : {});
                sendJson(res, 201, { order });
                return true;
            }

            sendJson(res, 405, { error: 'Methode non autorisee' });
            return true;
        } catch (error) {
            sendJson(res, error.statusCode || 500, { error: error.message || 'Erreur serveur' });
            return true;
        }
    }

    return false;
}

function resetState() {
    clearStateStmt.run();
    const emptyDb = defaultDb();
    upsertStateStmt.run('db', JSON.stringify(emptyDb));
    upsertStateStmt.run('parallelOrders', '[]');
    return {
        db: emptyDb,
        parallelOrders: [],
        source: 'sqlite'
    };
}

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(payload));
}

function applyClientCors(req, res) {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';

        req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 20 * 1024 * 1024) {
                reject(new Error('Payload trop volumineux'));
                req.destroy();
            }
        });

        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

async function handleApi(req, res, url) {
    if (url.pathname === '/api/health') {
        sendJson(res, 200, { ok: true, database: DB_FILE });
        return true;
    }

    if (url.pathname.startsWith('/api/client/')) {
        applyClientCors(req, res);
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return true;
        }
        return handleClientApi(req, res, url);
    }

    if (url.pathname !== '/api/db') return false;

    try {
        if (req.method === 'GET') {
            sendJson(res, 200, readState());
            return true;
        }

        if (req.method === 'PUT' || req.method === 'POST') {
            const body = await readBody(req);
            const payload = body ? JSON.parse(body) : {};
            sendJson(res, 200, writeState(payload));
            return true;
        }

        if (req.method === 'DELETE') {
            sendJson(res, 200, resetState());
            return true;
        }

        sendJson(res, 405, { error: 'Methode non autorisee' });
        return true;
    } catch (error) {
        sendJson(res, error.statusCode || 500, { error: error.message || 'Erreur serveur' });
        return true;
    }
}

const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.mp4': 'video/mp4',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
};

function staticPathFromUrl(url) {
    const decoded = decodeURIComponent(url.pathname);
    const publicClientPaths = new Set(['/client', '/client/', '/boutique', '/boutique/', '/commande-client', '/commande-client/']);
    if (publicClientPaths.has(decoded)) return path.join(ROOT, 'client.html');

    const requested = decoded === '/' ? '/index.html' : decoded;
    const absolutePath = path.resolve(ROOT, `.${requested}`);
    const relative = path.relative(ROOT, absolutePath);

    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return absolutePath;
}

function serveStatic(res, url) {
    let filePath = staticPathFromUrl(url);
    if (!filePath) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
    }

    fs.stat(filePath, (error, stats) => {
        if (error || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
            'Content-Type': contentTypes[ext] || 'application/octet-stream',
            'Content-Length': stats.size
        });
        fs.createReadStream(filePath).pipe(res);
    });
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
    const handled = await handleApi(req, res, url);
    if (!handled) serveStatic(res, url);
});

server.listen(PORT, () => {
    console.log(`Axxam lancee: http://localhost:${PORT}`);
    console.log(`Base SQLite: ${DB_FILE}`);
});
