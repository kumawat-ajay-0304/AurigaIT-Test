import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import './App.css'

type User = { id: number; name: string; email: string; phone: string; role: 'customer' | 'staff' | 'admin' }
type Profile = User & { tier: string; points: number; lifetime_points: number; visit_days: number; is_active: number }
type MenuItem = { id: number; name: string; description: string; price_paise: number; category: string; available: number }
type Reward = { id: number; name: string; description: string; credit_cost: number; active: number }
type StaffCustomer = { id: number; name: string; tier: string; points: number; lifetime_points: number; purchase_days: number; last_purchase_at: string | null }
type CustomerPage = 'menu' | 'rewards' | 'profile'
type StaffPage = 'members' | 'menu'
type CartLine = { item: MenuItem; quantity: number }

const API = import.meta.env.VITE_API_URL || '/api'

function titleCaseName(name: string) {
  return name.trim().toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())
}

async function api(path: string, options: RequestInit = {}) {
  const token = sessionStorage.getItem('dream_cafe_token')
  let response: Response
  try {
    response = await fetch(`${API}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } })
  } catch {
    throw new Error('We could not connect to Dream cafe. Please try again.')
  }
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Something went wrong')
  return data
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (data: { user: User; token: string }) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' })
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    try {
      const data = await api(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(form) })
      sessionStorage.setItem('dream_cafe_token', data.token); onAuthenticated(data)
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Could not connect to Dream cafe') }
  }
  return <main className="auth-shell"><div className="auth-mark">D</div><p className="eyebrow">Dream cafe membership</p><h1>{mode === 'login' ? 'Welcome back.' : 'Create your membership.'}</h1><p className="lede">{mode === 'login' ? 'Sign in to manage your rewards and points.' : 'Earn points automatically with every purchase.'}</p><form className="auth-form" onSubmit={submit}>{mode === 'register' && <label>Full name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Your full name" /></label>}{mode === 'register' && <label>Phone number<input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Your phone number" /></label>}<label>Email address<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="you@example.com" /></label><label>Password<input required minLength={8} type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="At least 8 characters" /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button" type="submit">{mode === 'login' ? 'Sign in' : 'Create membership'} <span>→</span></button></form><button className="switch-auth" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>{mode === 'login' ? 'Create a membership' : 'Back to sign in'}</button></main>
}

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [menu, setMenu] = useState<MenuItem[]>([])
  const [rewards, setRewards] = useState<Reward[]>([])
  const [customers, setCustomers] = useState<StaffCustomer[]>([])
  const [customerPage, setCustomerPage] = useState<CustomerPage>('menu')
  const [staffPage, setStaffPage] = useState<StaffPage>('members')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [showMenuForm, setShowMenuForm] = useState(false)
  const [cart, setCart] = useState<CartLine[]>([])

  const refresh = async (currentUser: User) => {
    const menuData = await api('/menu'); setMenu(menuData.items)
    if (currentUser.role === 'customer') {
      const [profileData, rewardData] = await Promise.all([api('/customers/me'), api('/rewards')])
      setProfile(profileData.profile); setRewards(rewardData.rewards)
    } else {
      const customerData = await api('/staff/customers'); setCustomers(customerData.customers)
    }
  }

  useEffect(() => {
    const token = sessionStorage.getItem('dream_cafe_token')
    if (!token) return
    api('/auth/me').then((data) => { if (data.profile && !data.profile.is_active) throw new Error('Membership inactive'); setUser(data.user); setProfile(data.profile); return refresh(data.user) }).catch(() => sessionStorage.removeItem('dream_cafe_token'))
  }, [])

  useEffect(() => {
    if (!user || user.role === 'customer') return
    const timer = window.setInterval(() => { api('/staff/customers').then((data) => setCustomers(data.customers)).catch(() => undefined) }, 3000)
    return () => window.clearInterval(timer)
  }, [user])

  const authenticated = async (data: { user: User; token: string }) => { setUser(data.user); await refresh(data.user) }
  const notify = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 2800) }
  const addToCart = (item: MenuItem) => { setCart((current) => { const existing = current.find((line) => line.item.id === item.id); return existing ? current.map((line) => line.item.id === item.id ? { ...line, quantity: line.quantity + 1 } : line) : [...current, { item, quantity: 1 }] }); notify(`${item.name} added to your order`) }
  const updateCart = (itemId: number, quantity: number) => setCart((current) => quantity < 1 ? current.filter((line) => line.item.id !== itemId) : current.map((line) => line.item.id === itemId ? { ...line, quantity } : line))
  const checkout = async () => { if (!cart.length) return; try { const data = await api('/purchases', { method: 'POST', body: JSON.stringify({ items: cart.map((line) => ({ menuItemId: line.item.id, quantity: line.quantity })) }) }); setProfile(data.profile); setCart([]); notify(`Order complete · +${data.points} points`) } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Could not complete order') } }
  const redeem = async (reward: Reward) => { try { const data = await api(`/rewards/${reward.id}/redeem`, { method: 'POST' }); setProfile(data.profile); notify(`${reward.name} is ready for collection`) } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Could not redeem reward') } }
  const cancelMembership = async () => { if (!window.confirm('Cancel your membership? Your purchase history will be kept, but your account will no longer appear in Dream cafe.')) return; try { await api('/customers/me/cancel', { method: 'POST' }); logout() } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Could not cancel membership') } }
  const resetPoints = async (customerId: number) => { if (!window.confirm('Reset this customer\'s points and tier? This cannot be undone.')) return; try { await api(`/staff/customers/${customerId}/reset-points`, { method: 'POST' }); if (user) await refresh(user); notify('Customer rewards reset') } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Could not reset customer rewards') } }
  const removeCustomer = async (customerId: number) => { if (!window.confirm('Remove this customer from active membership? Their purchase history will be kept.')) return; try { await api(`/staff/customers/${customerId}`, { method: 'DELETE' }); if (user) await refresh(user); notify('Customer membership removed') } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Could not remove customer membership') } }
  const logout = () => { sessionStorage.removeItem('dream_cafe_token'); setUser(null); setProfile(null) }

  if (!user) return <AuthScreen onAuthenticated={authenticated} />
  return <div className="app-shell"><header className="topbar"><a className="wordmark" href="#home"><span className="wordmark-mark">D</span><span>Dream cafe</span></a><div className="session-tools"><button className="session-name" onClick={() => user.role === 'customer' && setCustomerPage('profile')}>{user.name}</button><button className="logout-button" onClick={logout}>Sign out</button></div></header>{user.role === 'customer' && profile ? <MemberView profile={profile} menu={menu} rewards={rewards} cart={cart} page={customerPage} setPage={setCustomerPage} onAddToCart={addToCart} onUpdateCart={updateCart} onCheckout={checkout} onRedeem={redeem} onCancel={cancelMembership} /> : <StaffView menu={menu} customers={customers} page={staffPage} setPage={setStaffPage} onResetPoints={resetPoints} onRemoveCustomer={removeCustomer} onMenuChanged={() => refresh(user)} showForm={showMenuForm} setShowForm={setShowMenuForm} />}{notice && <div className="toast" role="status">✦ {notice}</div>}{error && <button className="error-toast" onClick={() => setError('')}>{error} ×</button>}</div>
}

function PageTabs({ items, active, onChange }: { items: { id: string; label: string; icon: string }[]; active: string; onChange: (id: string) => void }) {
  return <nav className="page-tabs" aria-label="Dashboard pages">{items.map((item) => <button key={item.id} className={active === item.id ? 'page-tab active' : 'page-tab'} onClick={() => onChange(item.id)}><span>{item.icon}</span>{item.label}</button>)}</nav>
}

function MenuPage({ menu, onBuy, staff = false, action, cart = [], onUpdateCart, onCheckout, onEdit, onRemove }: { menu: MenuItem[]; onBuy?: (item: MenuItem) => void; staff?: boolean; action?: ReactNode; cart?: CartLine[]; onUpdateCart?: (itemId: number, quantity: number) => void; onCheckout?: () => void; onEdit?: (item: MenuItem) => void; onRemove?: (item: MenuItem) => void }) {
  const cartTotal = cart.reduce((total, line) => total + line.item.price_paise * line.quantity, 0)
  return <section className="menu-page"><div className="section-heading"><div><p className="eyebrow">{staff ? 'Menu management' : "Today's selection"}</p><h2>{staff ? 'Manage menu' : 'Order and earn points'}</h2></div><div className="heading-actions">{action}<span className="open-now"><i /> {menu.length} available</span></div></div>{!staff && cart.length > 0 && <section className="cart-panel"><div className="cart-heading"><div><p className="eyebrow">Your order</p><h3>Ready when you are</h3></div><strong>₹{(cartTotal / 100).toFixed(2)}</strong></div>{cart.map((line) => <div className="cart-line" key={line.item.id}><span>{line.item.name}</span><div><button onClick={() => onUpdateCart?.(line.item.id, line.quantity - 1)}>-</button><b>{line.quantity}</b><button onClick={() => onUpdateCart?.(line.item.id, line.quantity + 1)}>+</button></div></div>)}<button className="checkout-button" onClick={onCheckout}>Checkout · ₹{(cartTotal / 100).toFixed(2)}</button></section>}<div className="menu-grid">{menu.map((item) => <article className="menu-tile" key={item.id}><div className="menu-tile-icon">{item.category === 'pastry' ? '✦' : item.category === 'food' ? '◌' : '☕'}</div><div className="menu-tile-copy"><h3>{item.name}</h3><p>{item.description}</p><span className="menu-category">{item.category}</span></div><div className="menu-tile-action"><b>₹{(item.price_paise / 100).toFixed(2)}</b>{onBuy && <button onClick={() => onBuy(item)}>Add to order</button>}{onEdit && <button onClick={() => onEdit(item)}>Edit</button>}{onRemove && <button className="danger-action" onClick={() => onRemove(item)}>Remove</button>}</div></article>)}</div></section>
}

function MemberView({ profile, menu, rewards, cart, page, setPage, onAddToCart, onUpdateCart, onCheckout, onRedeem, onCancel }: { profile: Profile; menu: MenuItem[]; rewards: Reward[]; cart: CartLine[]; page: CustomerPage; setPage: (page: CustomerPage) => void; onAddToCart: (item: MenuItem) => void; onUpdateCart: (itemId: number, quantity: number) => void; onCheckout: () => void; onRedeem: (reward: Reward) => void; onCancel: () => void }) {
  const tier = profile.tier[0].toUpperCase() + profile.tier.slice(1)
  return <main className="member-view"><section className="welcome-section" id="home"><div><p className="eyebrow">Your membership</p><h1>Good morning, {titleCaseName(profile.name.split(' ')[0])}<span className="soft-dot">.</span></h1><p className="lede">Rewards for the coffee you already love.</p></div><div className="tier-badge"><span className="tier-icon">✦</span><span><small>Current tier</small><b>{tier} member</b></span></div></section><section className="credit-card"><div className="credit-top"><span>Loyalty points</span><span className="credit-number">{profile.points}<small> pts</small></span></div><div className="progress-track"><span style={{ width: `${Math.min((profile.points / 300) * 100, 100)}%` }} /></div><div className="credit-bottom"><span>{profile.visit_days} purchase days · points earned automatically</span><span>{tier}</span></div></section><PageTabs active={page} onChange={(value) => setPage(value as CustomerPage)} items={[{ id: 'menu', label: 'Menu', icon: '☕' }, { id: 'rewards', label: 'Rewards', icon: '✦' }, { id: 'profile', label: 'Profile', icon: '◉' }]} />{page === 'profile' ? <ProfilePage profile={profile} tier={tier} onCancel={onCancel} /> : page === 'rewards' ? <section className="content-section"><div className="section-heading"><div><p className="eyebrow">Your benefits</p><h2>Redeem your points</h2></div></div><div className="reward-list">{rewards.map((reward) => <article className="reward-card" key={reward.id}><div className="reward-icon">✦</div><div className="reward-info"><h3>{reward.name}</h3><p>{reward.description}</p><span className="cost">{reward.credit_cost} points</span></div><button className="redeem-button" disabled={profile.points < reward.credit_cost} onClick={() => onRedeem(reward)}>{profile.points >= reward.credit_cost ? 'Redeem' : 'Not enough points'}</button></article>)}</div></section> : <MenuPage menu={menu} onBuy={onAddToCart} cart={cart} onUpdateCart={onUpdateCart} onCheckout={onCheckout} />}</main>
}

function ProfilePage({ profile, tier, onCancel }: { profile: Profile; tier: string; onCancel: () => void }) {
  return <section className="profile-page"><div className="section-heading"><div><p className="eyebrow">Account details</p><h2>Your profile</h2></div></div><div className="profile-card"><div className="profile-avatar">{titleCaseName(profile.name).slice(0, 1)}</div><div className="profile-details"><div><small>Name</small><b>{titleCaseName(profile.name)}</b></div><div><small>Email</small><b>{profile.email}</b></div><div><small>Phone</small><b>{profile.phone || 'Not added yet'}</b></div><div><small>Membership tier</small><b>{tier} member</b></div><div><small>Loyalty points</small><b>{profile.points} points</b></div><div><small>Purchase days</small><b>{profile.visit_days}</b></div></div></div><div className="profile-danger"><p className="eyebrow">Membership settings</p><h3>Taking a break?</h3><p>Your account history will be kept, but your membership will be hidden until you return.</p><button className="cancel-membership" onClick={onCancel}>Cancel membership</button></div></section>
}

function StaffView({ menu, customers, page, setPage, onResetPoints, onRemoveCustomer, onMenuChanged, showForm, setShowForm }: { menu: MenuItem[]; customers: StaffCustomer[]; page: StaffPage; setPage: (page: StaffPage) => void; onResetPoints: (customerId: number) => void; onRemoveCustomer: (customerId: number) => void; onMenuChanged: () => void; showForm: boolean; setShowForm: (value: boolean) => void }) {
  const [form, setForm] = useState({ name: '', description: '', price: '' })
  const [message, setMessage] = useState('')
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null)
  const saveItem = async (event: FormEvent) => { event.preventDefault(); try { const body = { name: form.name, description: form.description, pricePaise: Math.round(Number(form.price) * 100) }; await api(editingItem ? `/menu/${editingItem.id}` : '/menu', { method: editingItem ? 'PATCH' : 'POST', body: JSON.stringify(body) }); setForm({ name: '', description: '', price: '' }); setEditingItem(null); setShowForm(false); setMessage(editingItem ? 'Menu item updated' : 'Menu item added'); onMenuChanged() } catch (requestError) { setMessage(requestError instanceof Error ? requestError.message : 'Could not save menu item') } }
  const editItem = (item: MenuItem) => { setEditingItem(item); setForm({ name: item.name, description: item.description, price: (item.price_paise / 100).toFixed(2) }); setShowForm(true) }
  const removeItem = async (item: MenuItem) => { if (!window.confirm(`Remove ${item.name} from the menu?`)) return; try { await api(`/menu/${item.id}`, { method: 'DELETE' }); notifyMenu('Menu item removed') } catch (requestError) { setMessage(requestError instanceof Error ? requestError.message : 'Could not remove menu item') } }
  const notifyMenu = (messageText: string) => { setMessage(messageText); onMenuChanged() }
  return <main className="staff-view"><p className="eyebrow">Operations</p><h1>Good morning.</h1><p className="lede">Manage member rewards and the cafe menu.</p><PageTabs active={page} onChange={(value) => setPage(value as StaffPage)} items={[{ id: 'members', label: 'Members', icon: '◉' }, { id: 'menu', label: 'Menu', icon: '☕' }]} />{page === 'members' ? <section className="staff-panel member-panel"><div className="section-heading"><div><p className="eyebrow">Customer accounts</p><h2>Members and points</h2></div><span className="open-now">Updates automatically</span></div><div className="customer-list">{customers.length === 0 ? <p className="empty-state">No active members yet.</p> : customers.map((customer) => <article className="customer-row" key={customer.id}><div className="customer-avatar">{customer.name.slice(0, 1).toUpperCase()}</div><div className="customer-main"><h3>{customer.name}</h3></div><div className="customer-stat"><b>{customer.points}</b><small>points</small></div><div className={`tier-text ${customer.tier}`}><b>{customer.tier}</b><small>{customer.purchase_days} days</small></div><div className="customer-actions"><button onClick={() => onResetPoints(customer.id)}>Reset rewards</button><button onClick={() => onRemoveCustomer(customer.id)}>Remove member</button></div></article>)}</div></section> : <section className="staff-panel">{showForm && <form className="menu-form" onSubmit={saveItem}><input required placeholder="Menu item name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /><input placeholder="Item description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /><input required min="0.01" step="0.01" type="number" placeholder="Price (USD)" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /><button className="primary-button" type="submit">{editingItem ? 'Save changes' : 'Add menu item'}</button>{message && <small>{message}</small>}</form>}<MenuPage menu={menu} staff onEdit={editItem} onRemove={removeItem} action={<button className="text-button" onClick={() => { setEditingItem(null); setForm({ name: '', description: '', price: '' }); setShowForm(!showForm) }}>{showForm ? 'Close form' : '+ Add menu item'}</button>} /></section>}</main>
}

export default App
