import cors from 'cors'
import bcrypt from 'bcryptjs'
import Database from 'better-sqlite3'
import express from 'express'
import jwt from 'jsonwebtoken'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.API_PORT || 3001)
const jwtSecret = process.env.JWT_SECRET || 'dream-cafe-development-secret'
const database = new Database(path.join(__dirname, 'dream-cafe.sqlite'))
database.pragma('foreign_keys = ON')
database.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'))

const profileColumns = database.prepare("PRAGMA table_info('customer_profiles')").all()
if (!profileColumns.some((column) => column.name === 'is_active')) {
  database.exec('ALTER TABLE customer_profiles ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))')
}
const userColumns = database.prepare("PRAGMA table_info('users')").all()
if (!userColumns.some((column) => column.name === 'phone')) {
  database.exec("ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT ''")
}

const tierRuleColumns = database.prepare("PRAGMA table_info('tier_rules')").all()
if (tierRuleColumns.some((column) => column.name === 'points_per_dollar')) {
  database.pragma('foreign_keys = OFF')
  database.exec(`
    ALTER TABLE tier_rules RENAME TO tier_rules_legacy;
    CREATE TABLE tier_rules (
      tier TEXT PRIMARY KEY CHECK (tier IN ('bronze', 'silver', 'gold', 'platinum')),
      points_per_rupee REAL NOT NULL CHECK (points_per_rupee > 0),
      minimum_lifetime_points INTEGER NOT NULL DEFAULT 0 CHECK (minimum_lifetime_points >= 0)
    );
    INSERT INTO tier_rules (tier, points_per_rupee, minimum_lifetime_points)
      SELECT tier, points_per_dollar, minimum_lifetime_points FROM tier_rules_legacy;
    INSERT OR IGNORE INTO tier_rules VALUES ('platinum', 0.3, 5000);
    DROP TABLE tier_rules_legacy;
  `)
  database.pragma('foreign_keys = ON')
} else {
  database.prepare("INSERT OR IGNORE INTO tier_rules (tier, points_per_rupee, minimum_lifetime_points) VALUES ('platinum', 0.3, 5000)").run()
}

const customerTableSql = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'customer_profiles'").get()?.sql || ''
if (!customerTableSql.includes("'platinum'")) {
  database.pragma('foreign_keys = OFF')
  database.exec(`
    ALTER TABLE customer_profiles RENAME TO customer_profiles_legacy;
    CREATE TABLE customer_profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      tier TEXT NOT NULL DEFAULT 'bronze' CHECK (tier IN ('bronze', 'silver', 'gold', 'platinum')),
      credit_balance REAL NOT NULL DEFAULT 0 CHECK (credit_balance >= 0),
      lifetime_credits REAL NOT NULL DEFAULT 0 CHECK (lifetime_credits >= 0),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO customer_profiles SELECT user_id, tier, credit_balance, lifetime_credits, is_active, updated_at FROM customer_profiles_legacy;
    DROP TABLE customer_profiles_legacy;
  `)
  database.pragma('foreign_keys = ON')
}

const ledgerTableSql = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'points_ledger'").get()?.sql || ''
if (!ledgerTableSql.includes("'expiration'")) {
  database.pragma('foreign_keys = OFF')
  database.exec(`
    ALTER TABLE points_ledger RENAME TO points_ledger_legacy;
    CREATE TABLE points_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customer_profiles(user_id) ON DELETE CASCADE,
      purchase_id INTEGER REFERENCES purchases(id) ON DELETE SET NULL,
      reward_id INTEGER REFERENCES rewards(id) ON DELETE SET NULL,
      points REAL NOT NULL CHECK (points != 0),
      type TEXT NOT NULL CHECK (type IN ('purchase', 'redemption', 'adjustment', 'expiration')),
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO points_ledger (id, customer_id, purchase_id, reward_id, points, type, created_at)
      SELECT id, customer_id, purchase_id, reward_id, points, type, created_at FROM points_ledger_legacy;
    DROP TABLE points_ledger_legacy;
  `)
  database.pragma('foreign_keys = ON')
}

const dependentTables = ['purchases', 'purchase_items', 'points_ledger', 'credit_transactions']
const hasLegacyReference = dependentTables.some((table) => database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)?.sql?.includes('customer_profiles_legacy'))
if (hasLegacyReference) {
  database.pragma('foreign_keys = OFF')
  database.exec(`
    DROP INDEX IF EXISTS idx_purchases_customer_date;
    DROP INDEX IF EXISTS idx_points_customer_date;
    DROP INDEX IF EXISTS idx_transactions_customer;
    ALTER TABLE credit_transactions RENAME TO credit_transactions_legacy;
    ALTER TABLE purchase_items RENAME TO purchase_items_legacy;
    ALTER TABLE points_ledger RENAME TO points_ledger_legacy;
    ALTER TABLE purchases RENAME TO purchases_legacy;
    CREATE TABLE purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customer_profiles(user_id) ON DELETE CASCADE,
      staff_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      total_cents INTEGER NOT NULL CHECK (total_cents > 0),
      purchased_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO purchases SELECT id, customer_id, staff_id, total_cents, purchased_at FROM purchases_legacy;
    CREATE TABLE purchase_items (
      purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
      menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
      PRIMARY KEY (purchase_id, menu_item_id)
    );
    INSERT INTO purchase_items SELECT purchase_id, menu_item_id, quantity, unit_price_cents FROM purchase_items_legacy;
    CREATE TABLE points_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customer_profiles(user_id) ON DELETE CASCADE,
      purchase_id INTEGER REFERENCES purchases(id) ON DELETE SET NULL,
      reward_id INTEGER REFERENCES rewards(id) ON DELETE SET NULL,
      points REAL NOT NULL CHECK (points != 0),
      type TEXT NOT NULL CHECK (type IN ('purchase', 'redemption', 'adjustment', 'expiration')),
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO points_ledger SELECT id, customer_id, purchase_id, reward_id, points, type, expires_at, created_at FROM points_ledger_legacy;
    CREATE TABLE credit_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customer_profiles(user_id) ON DELETE CASCADE,
      staff_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      amount INTEGER NOT NULL CHECK (amount != 0),
      type TEXT NOT NULL CHECK (type IN ('visit', 'redemption', 'adjustment')),
      reward_id INTEGER REFERENCES rewards(id) ON DELETE SET NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO credit_transactions SELECT id, customer_id, staff_id, amount, type, reward_id, note, created_at FROM credit_transactions_legacy;
    DROP TABLE purchases_legacy;
    DROP TABLE purchase_items_legacy;
    DROP TABLE points_ledger_legacy;
    DROP TABLE credit_transactions_legacy;
    CREATE INDEX idx_purchases_customer_date ON purchases(customer_id, purchased_at DESC);
    CREATE INDEX idx_points_customer_date ON points_ledger(customer_id, created_at DESC);
    CREATE INDEX idx_transactions_customer ON credit_transactions(customer_id, created_at DESC);
  `)
  database.pragma('foreign_keys = ON')
}

const purchaseItemsSql = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'purchase_items'").get()?.sql || ''
if (!purchaseItemsSql.includes('ON DELETE SET NULL') || !purchaseItemsSql.includes('item_name')) {
  database.pragma('foreign_keys = OFF')
  database.exec(`
    ALTER TABLE purchase_items RENAME TO purchase_items_legacy;
    CREATE TABLE purchase_items (
      purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
      menu_item_id INTEGER REFERENCES menu_items(id) ON DELETE SET NULL,
      item_name TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
      PRIMARY KEY (purchase_id, menu_item_id)
    );
    INSERT INTO purchase_items (purchase_id, menu_item_id, item_name, quantity, unit_price_cents)
      SELECT pi.purchase_id, pi.menu_item_id, COALESCE(mi.name, 'Removed menu item'), pi.quantity, pi.unit_price_cents
      FROM purchase_items_legacy pi LEFT JOIN menu_items mi ON mi.id = pi.menu_item_id;
    DROP TABLE purchase_items_legacy;
  `)
  database.pragma('foreign_keys = ON')
}

if (database.prepare('SELECT COUNT(*) AS count FROM menu_items').get().count === 0) {
  database.exec(fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8'))
}

const additionalMenuItems = [
  ['Maple cortado', 'double espresso · steamed milk · maple', 500, 'drink'],
  ['Rosemary focaccia', 'olive oil · sea salt · fresh rosemary', 525, 'pastry'],
  ['Seasonal fruit bowl', 'citrus · berries · mint', 600, 'food'],
  ['Dark chocolate cookie', 'brown butter · dark chocolate · sea salt', 350, 'pastry'],
  ['Vanilla bean iced tea', 'black tea · vanilla · lemon', 400, 'drink'],
]
const addMenuItem = database.prepare('INSERT OR IGNORE INTO menu_items (name, description, price_cents, category) VALUES (?, ?, ?, ?)')
additionalMenuItems.forEach((item) => addMenuItem.run(...item))

const app = express()
app.use(cors())
app.use(express.json())

const publicUser = (user) => ({ id: user.id, name: user.name, email: user.email, phone: user.phone || '', role: user.role })
const signToken = (user) => jwt.sign(publicUser(user), jwtSecret, { expiresIn: '7d' })

function auth(requiredRoles = []) {
  return (request, response, next) => {
    const header = request.headers.authorization
    if (!header?.startsWith('Bearer ')) return response.status(401).json({ error: 'Authentication required' })
    try {
      request.user = jwt.verify(header.slice(7), jwtSecret)
      if (request.user.role === 'customer' && !database.prepare('SELECT is_active FROM customer_profiles WHERE user_id = ?').get(request.user.id)?.is_active) {
        return response.status(403).json({ error: 'This membership is inactive' })
      }
      if (requiredRoles.length > 0 && !requiredRoles.includes(request.user.role)) {
        return response.status(403).json({ error: 'You do not have access to this resource' })
      }
      next()
    } catch {
      response.status(401).json({ error: 'Invalid or expired session' })
    }
  }
}

function profileFor(userId) {
  return database.prepare(`
    SELECT u.id, u.name, u.email, u.phone, u.role, cp.tier, cp.credit_balance AS points,
      cp.lifetime_credits AS lifetime_points, cp.is_active,
      (SELECT COUNT(DISTINCT date(purchased_at)) FROM purchases WHERE customer_id = cp.user_id) AS visit_days
    FROM users u JOIN customer_profiles cp ON cp.user_id = u.id WHERE u.id = ?
  `).get(userId)
}

function calculateTier(lifetimePoints) {
  const rules = database.prepare('SELECT tier, minimum_lifetime_points FROM tier_rules ORDER BY minimum_lifetime_points DESC').all()
  return rules.find((rule) => lifetimePoints >= rule.minimum_lifetime_points)?.tier || 'bronze'
}

const tierRank = { bronze: 0, silver: 1, gold: 2, platinum: 3 }
const notificationService = {
  enqueueTierChange(customerId, name, fromTier, toTier) {
    const payload = {
      customerId,
      name,
      fromTier,
      toTier,
      message: `Congratulations ${name}, you are now a ${toTier[0].toUpperCase()}${toTier.slice(1)} member of Dream cafe.`,
    }
    database.prepare('INSERT INTO notification_outbox (customer_id, event_type, payload) VALUES (?, ?, ?)').run(customerId, 'tier.changed', JSON.stringify(payload))
  },
}
function promoteQualifiedMembers() {
  const members = database.prepare('SELECT user_id, tier, lifetime_credits FROM customer_profiles WHERE is_active = 1').all()
  const update = database.prepare('UPDATE customer_profiles SET tier = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
  members.forEach((member) => {
    const qualifiedTier = calculateTier(member.lifetime_credits)
    if (tierRank[qualifiedTier] > tierRank[member.tier]) update.run(qualifiedTier, member.user_id)
  })
}

function clockDate(value) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) throw new Error('Invalid clock value')
  return date
}

function sqliteDate(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

function expireStalePoints(value) {
  const now = clockDate(value)
  const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
  const customers = database.prepare('SELECT user_id FROM customer_profiles WHERE is_active = 1').all()
  const purchaseLots = database.prepare("SELECT id, points, created_at FROM points_ledger WHERE customer_id = ? AND type = 'purchase' AND points > 0 ORDER BY created_at, id")
  const deductions = database.prepare('SELECT points FROM points_ledger WHERE customer_id = ? AND points < 0 ORDER BY created_at, id')
  const insertExpiry = database.prepare("INSERT INTO points_ledger (customer_id, points, type, expires_at, created_at) VALUES (?, ?, 'expiration', ?, ?)")
  const updateBalance = database.prepare('UPDATE customer_profiles SET credit_balance = MAX(0, credit_balance - ?), updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
  let expiredTotal = 0
  const expireCustomer = database.transaction((customerId) => {
    const lots = purchaseLots.all(customerId).map((lot) => ({ ...lot, remaining: Number(lot.points) }))
    let deductionsRemaining = deductions.all(customerId).reduce((total, row) => total + Math.abs(Number(row.points)), 0)
    lots.forEach((lot) => {
      if (deductionsRemaining <= 0) return
      const used = Math.min(lot.remaining, deductionsRemaining)
      lot.remaining -= used
      deductionsRemaining -= used
    })
    const staleLots = lots.filter((lot) => new Date(`${lot.created_at.replace(' ', 'T')}Z`) <= cutoff && lot.remaining > 0)
    const stalePoints = staleLots.reduce((total, lot) => total + lot.remaining, 0)
    if (stalePoints > 0) {
      staleLots.forEach((lot) => insertExpiry.run(customerId, -lot.remaining, sqliteDate(cutoff), sqliteDate(now)))
      updateBalance.run(stalePoints, customerId)
      expiredTotal += stalePoints
    }
  })
  customers.forEach((customer) => expireCustomer(customer.user_id))
  return { expiredPoints: expiredTotal, evaluatedAt: sqliteDate(now) }
}

promoteQualifiedMembers()

app.get('/api/health', (_request, response) => response.json({ ok: true }))

app.get(['/outbox', '/api/outbox'], (_request, response) => {
  const events = database.prepare(`
    SELECT id, customer_id, event_type, payload, created_at, delivered_at
    FROM notification_outbox ORDER BY id ASC
  `).all().map((event) => ({ ...event, payload: JSON.parse(event.payload) }))
  response.json(events)
})

app.post(['/clock', '/api/clock'], (request, response) => {
  try {
    response.json(expireStalePoints(request.body?.now || request.body?.at))
  } catch (error) {
    response.status(400).json({ error: error.message })
  }
})

app.post('/api/auth/register', (request, response) => {
  const { name, email, phone = '', password } = request.body
  if (!name || !email || !password || password.length < 8) return response.status(400).json({ error: 'Name, email, and an 8-character password are required' })
  try {
    const create = database.transaction(() => {
      const result = database.prepare('INSERT INTO users (name, email, phone, password_hash) VALUES (?, ?, ?, ?)').run(name.trim(), email.trim().toLowerCase(), phone.trim(), bcrypt.hashSync(password, 10))
      database.prepare('INSERT INTO customer_profiles (user_id) VALUES (?)').run(result.lastInsertRowid)
      return database.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid)
    })()
    response.status(201).json({ user: publicUser(create), token: signToken(create) })
  } catch (error) {
    response.status(error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 409 : 500).json({ error: error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'Email is already registered' : 'Could not create account' })
  }
})

app.post('/api/auth/login', (request, response) => {
  const { email, password } = request.body
  const user = database.prepare('SELECT * FROM users WHERE email = ?').get(email?.trim().toLowerCase())
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) return response.status(401).json({ error: 'Email or password is incorrect' })
  if (user.role === 'customer' && !database.prepare('SELECT is_active FROM customer_profiles WHERE user_id = ?').get(user.id)?.is_active) return response.status(403).json({ error: 'This membership is inactive' })
  response.json({ user: publicUser(user), token: signToken(user) })
})

app.get('/api/auth/me', auth(), (request, response) => response.json({ user: publicUser(request.user), profile: request.user.role === 'customer' ? profileFor(request.user.id) : null }))

app.get('/api/menu', (_request, response) => response.json({ items: database.prepare('SELECT id, name, description, price_cents AS price_paise, category, available FROM menu_items WHERE available = 1 ORDER BY category, name').all() }))

app.post('/api/menu', auth(['staff', 'admin']), (request, response) => {
  const { name, description = '', pricePaise, priceCents, category = 'drink' } = request.body
  const price = Number.isInteger(pricePaise) ? pricePaise : priceCents
  if (!name || !Number.isInteger(price) || price <= 0) return response.status(400).json({ error: 'Name and a positive price in paise are required' })
  const result = database.prepare('INSERT INTO menu_items (name, description, price_cents, category) VALUES (?, ?, ?, ?)').run(name.trim(), description, price, category)
  response.status(201).json({ item: database.prepare('SELECT * FROM menu_items WHERE id = ?').get(result.lastInsertRowid) })
})

app.patch('/api/menu/:id', auth(['staff', 'admin']), (request, response) => {
  const { name, description, pricePaise, priceCents, available, category } = request.body
  const price = pricePaise ?? priceCents
  const result = database.prepare(`UPDATE menu_items SET name = COALESCE(?, name), description = COALESCE(?, description), price_cents = COALESCE(?, price_cents), available = COALESCE(?, available), category = COALESCE(?, category) WHERE id = ?`).run(name, description, price, available === undefined ? null : Number(Boolean(available)), category, request.params.id)
  if (result.changes === 0) return response.status(404).json({ error: 'Menu item not found' })
  response.json({ item: database.prepare('SELECT * FROM menu_items WHERE id = ?').get(request.params.id) })
})

app.delete('/api/menu/:id', auth(['staff', 'admin']), (request, response) => {
  const item = database.prepare('SELECT id FROM menu_items WHERE id = ?').get(request.params.id)
  if (!item) return response.status(404).json({ error: 'Menu item not found' })
  database.prepare('DELETE FROM menu_items WHERE id = ?').run(request.params.id)
  response.json({ ok: true })
})

app.get('/api/rewards', (_request, response) => response.json({ rewards: database.prepare('SELECT id, name, description, credit_cost, active FROM rewards WHERE active = 1 ORDER BY credit_cost').all() }))

app.get('/api/customers/me', auth(['customer']), (request, response) => response.json({ profile: profileFor(request.user.id) }))

app.get('/api/customers/me/activity', auth(['customer']), (request, response) => {
  const activity = database.prepare(`
    SELECT p.id, p.total_cents, p.purchased_at, pl.points, 'purchase' AS type
    FROM purchases p JOIN points_ledger pl ON pl.purchase_id = p.id
    WHERE p.customer_id = ? ORDER BY p.purchased_at DESC LIMIT 30
  `).all(request.user.id)
  response.json({ activity })
})

app.get('/api/staff/customers', auth(['staff', 'admin']), (_request, response) => {
  const customers = database.prepare(`
    SELECT u.id, u.name, cp.tier, cp.credit_balance AS points,
      cp.lifetime_credits AS lifetime_points,
      (SELECT COUNT(DISTINCT date(purchased_at)) FROM purchases WHERE customer_id = cp.user_id) AS purchase_days,
      (SELECT MAX(purchased_at) FROM purchases WHERE customer_id = cp.user_id) AS last_purchase_at
    FROM users u JOIN customer_profiles cp ON cp.user_id = u.id
    WHERE u.role = 'customer' AND cp.is_active = 1
    ORDER BY last_purchase_at DESC, u.name ASC
  `).all()
  response.json({ customers })
})

app.delete('/api/staff/customers/:id', auth(['staff', 'admin']), (request, response) => {
  const result = database.prepare('UPDATE customer_profiles SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(request.params.id)
  if (result.changes === 0) return response.status(404).json({ error: 'Customer not found' })
  response.json({ ok: true })
})

app.post('/api/staff/customers/:id/reset-points', auth(['staff', 'admin']), (request, response) => {
  const customer = database.prepare('SELECT credit_balance, lifetime_credits FROM customer_profiles WHERE user_id = ? AND is_active = 1').get(request.params.id)
  if (!customer) return response.status(404).json({ error: 'Active customer not found' })
  database.transaction(() => {
    if (customer.credit_balance > 0) database.prepare("INSERT INTO points_ledger (customer_id, points, type) VALUES (?, ?, 'adjustment')").run(request.params.id, -customer.credit_balance)
    database.prepare('UPDATE customer_profiles SET credit_balance = 0, lifetime_credits = 0, tier = \'bronze\', updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(request.params.id)
  })()
  response.json({ ok: true, profile: profileFor(request.params.id) })
})

app.post('/api/customers/me/cancel', auth(['customer']), (request, response) => {
  database.prepare('UPDATE customer_profiles SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(request.user.id)
  response.json({ ok: true })
})

app.post('/api/purchases', auth(['customer', 'staff', 'admin']), (request, response) => {
  const customerId = request.user.role === 'customer' ? request.user.id : Number(request.body.customerId)
  const items = Array.isArray(request.body.items) ? request.body.items : []
  if (!customerId || items.length === 0) return response.status(400).json({ error: 'A customer and at least one menu item are required' })
  const customer = database.prepare('SELECT cp.*, u.name, u.role FROM customer_profiles cp JOIN users u ON u.id = cp.user_id WHERE cp.user_id = ?').get(customerId)
  if (!customer) return response.status(404).json({ error: 'Customer not found' })
  if (!customer.is_active) return response.status(403).json({ error: 'Customer membership is inactive' })
  const findItem = database.prepare('SELECT id, price_cents AS price_paise FROM menu_items WHERE id = ? AND available = 1')
  const insertPurchase = database.prepare('INSERT INTO purchases (customer_id, staff_id, total_cents) VALUES (?, ?, ?)')
  const insertItem = database.prepare('INSERT INTO purchase_items (purchase_id, menu_item_id, item_name, quantity, unit_price_cents) VALUES (?, ?, ?, ?, ?)')
  const findRule = database.prepare('SELECT points_per_rupee FROM tier_rules WHERE tier = ?')
  const insertLedger = database.prepare("INSERT INTO points_ledger (customer_id, purchase_id, points, type) VALUES (?, ?, ?, 'purchase')")
  const updateBalance = database.prepare('UPDATE customer_profiles SET credit_balance = credit_balance + ?, lifetime_credits = lifetime_credits + ?, tier = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
  try {
    const result = database.transaction(() => {
      let totalPaise = 0
      const validItems = []
      for (const item of items) {
        const menuItem = findItem.get(Number(item.menuItemId))
        const quantity = Number(item.quantity)
        if (!menuItem || !Number.isInteger(quantity) || quantity < 1) throw new Error('Invalid menu item or quantity')
        totalPaise += menuItem.price_paise * quantity
        validItems.push({ ...menuItem, quantity })
      }
      const purchase = insertPurchase.run(customerId, request.user.role === 'customer' ? null : request.user.id, totalPaise)
      validItems.forEach((item) => insertItem.run(purchase.lastInsertRowid, item.id, item.name, item.quantity, item.price_paise))
      const rule = findRule.get(customer.tier)
      const points = Math.round((totalPaise / 100) * rule.points_per_rupee * 100) / 100
      const lifetimePoints = customer.lifetime_credits + points
      const nextTier = calculateTier(lifetimePoints)
      insertLedger.run(customerId, purchase.lastInsertRowid, points)
      updateBalance.run(points, points, nextTier, customerId)
      if (tierRank[nextTier] > tierRank[customer.tier]) notificationService.enqueueTierChange(customerId, customer.name, customer.tier, nextTier)
      return { purchaseId: purchase.lastInsertRowid, totalPaise, points }
    })()
    response.status(201).json({ ...result, profile: profileFor(customerId) })
  } catch (error) {
    response.status(400).json({ error: error.message || 'Could not record purchase' })
  }
})

app.post('/api/rewards/:id/redeem', auth(['customer']), (request, response) => {
  const reward = database.prepare('SELECT * FROM rewards WHERE id = ? AND active = 1').get(request.params.id)
  const profile = database.prepare('SELECT * FROM customer_profiles WHERE user_id = ?').get(request.user.id)
  if (!reward) return response.status(404).json({ error: 'Reward not found' })
  if (profile.credit_balance < reward.credit_cost) return response.status(400).json({ error: 'Not enough points for this reward' })
  const redeem = database.transaction(() => {
    database.prepare("INSERT INTO points_ledger (customer_id, reward_id, points, type) VALUES (?, ?, ?, 'redemption')").run(request.user.id, reward.id, -reward.credit_cost)
    database.prepare('INSERT INTO credit_transactions (customer_id, amount, type, reward_id, note) VALUES (?, ?, \'redemption\', ?, ?)').run(request.user.id, -reward.credit_cost, reward.id, reward.name)
    database.prepare('UPDATE customer_profiles SET credit_balance = credit_balance - ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(reward.credit_cost, request.user.id)
  })
  redeem()
  response.json({ reward, profile: profileFor(request.user.id) })
})

app.listen(port, () => console.log(`Dream cafe API running at http://localhost:${port}`))
