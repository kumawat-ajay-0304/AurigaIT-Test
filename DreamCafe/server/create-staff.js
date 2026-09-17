import bcrypt from 'bcryptjs'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const name = process.env.STAFF_NAME
const email = process.env.STAFF_EMAIL?.trim().toLowerCase()
const password = process.env.STAFF_PASSWORD

if (!name || !email || !password || password.length < 8) {
  console.error('Usage: STAFF_NAME="Cafe Staff" STAFF_EMAIL="staff@example.com" STAFF_PASSWORD="8+ chars" npm run create:staff')
  process.exit(1)
}

const database = new Database(path.join(__dirname, 'dream-cafe.sqlite'))
database.pragma('foreign_keys = ON')
database.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'))
const existing = database.prepare('SELECT id FROM users WHERE email = ?').get(email)
if (existing) {
  database.prepare('UPDATE users SET name = ?, password_hash = ?, role = ? WHERE id = ?').run(name, bcrypt.hashSync(password, 10), 'staff', existing.id)
  console.log(`Updated staff account: ${email}`)
} else {
  database.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run(name, email, bcrypt.hashSync(password, 10), 'staff')
  console.log(`Created staff account: ${email}`)
}
database.close()
