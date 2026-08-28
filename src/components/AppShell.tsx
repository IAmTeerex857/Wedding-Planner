import { useState } from 'react'
import {
  CalendarDays,
  ChartNoAxesCombined,
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  FolderLock,
  Gift,
  HeartHandshake,
  LayoutDashboard,
  MapPin,
  Menu,
  PackageCheck,
  Plane,
  Settings,
  Shirt,
  Store,
  Trash2,
  UserRound,
  Users,
  Utensils,
  Armchair,
  X,
} from './KoboyoIcon'
import { NavLink, Outlet } from 'react-router-dom'
import { isSupabaseConfigured } from '../lib/supabase'
import { BrandMark } from './BrandMark'
import { useWorkspace } from '../lib/workspace-context'

const primaryNavigation = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/ceremonies', label: 'Ceremonies', icon: HeartHandshake },
  { to: '/tasks', label: 'Tasks', icon: ClipboardCheck },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/guests', label: 'Guests', icon: Users },
  { to: '/seating', label: 'Seating', icon: Armchair },
  { to: '/budget', label: 'Budget', icon: CircleDollarSign },
]

const planningNavigation = [
  { to: '/vendors', label: 'Vendors', icon: Store },
  { to: '/venues', label: 'Venues', icon: MapPin },
  { to: '/food-drinks', label: 'Food & drinks', icon: Utensils },
  { to: '/attire', label: 'Attire & aso-ebi', icon: Shirt },
  { to: '/traditional-requirements', label: 'Trad requirements', icon: PackageCheck },
  { to: '/itineraries', label: 'Itineraries', icon: Clock3 },
  { to: '/gifts', label: 'Gifts', icon: Gift },
  { to: '/files', label: 'Photos & files', icon: FolderLock },
  { to: '/honeymoon', label: 'Honeymoon', icon: Plane },
  { to: '/reports', label: 'Reports', icon: ChartNoAxesCombined },
]

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { displayName } = useWorkspace()
  const initials = displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()

  const navigation = (
    <>
      <div className="nav-section">
        <p className="nav-label">Workspace</p>
        {primaryNavigation.map((item) => (
          <NavItem key={item.to} {...item} onClick={() => setMenuOpen(false)} />
        ))}
      </div>
      <div className="nav-section">
        <p className="nav-label">Planning</p>
        {planningNavigation.map((item) => (
          <NavItem key={item.to} {...item} onClick={() => setMenuOpen(false)} />
        ))}
      </div>
    </>
  )

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="sidebar-brand"><BrandMark /></div>
        <nav className="sidebar-nav" aria-label="Main navigation">{navigation}</nav>
        <div className="sidebar-footer">
          <NavItem to="/settings" label="Settings" icon={Settings} />
          <NavItem to="/recycle-bin" label="Recycle bin" icon={Trash2} />
          <button className="profile-button" type="button">
            <span className="avatar"><UserRound size={20} /><span className="sr-only">{initials || 'TB'}</span></span>
            <span><strong>{displayName}</strong><small>Owner</small></span>
            <ChevronDown size={15} />
          </button>
        </div>
      </aside>

      <header className="mobile-header">
        <BrandMark compact />
        <button className="icon-button" type="button" onClick={() => setMenuOpen(true)} aria-label="Open navigation">
          <Menu size={20} />
        </button>
      </header>

      {menuOpen && (
        <div className="mobile-drawer" role="dialog" aria-modal="true">
          <div className="drawer-backdrop" onClick={() => setMenuOpen(false)} />
          <div className="drawer-panel">
            <div className="drawer-header">
              <BrandMark />
              <button className="icon-button" type="button" onClick={() => setMenuOpen(false)} aria-label="Close navigation">
                <X size={20} />
              </button>
            </div>
            <nav className="drawer-navigation" aria-label="Mobile navigation">
              {navigation}
              <div className="nav-section">
                <p className="nav-label">Account</p>
                <NavItem to="/settings" label="Settings" icon={Settings} onClick={() => setMenuOpen(false)} />
                <NavItem to="/recycle-bin" label="Recycle bin" icon={Trash2} onClick={() => setMenuOpen(false)} />
              </div>
            </nav>
          </div>
        </div>
      )}

      <main className="main-content">
        {!isSupabaseConfigured && (
          <div className="setup-banner">
            <span className="status-dot" />
            Preview mode. Add Supabase environment variables to enable accounts and storage.
          </div>
        )}
        <Outlet />
      </main>
    </div>
  )
}

type NavItemProps = {
  to: string
  label: string
  icon: typeof LayoutDashboard
  onClick?: () => void
}

function NavItem({ to, label, icon: Icon, onClick }: NavItemProps) {
  return (
    <NavLink className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} to={to} onClick={onClick} end={to === '/'}>
      <Icon size={17} strokeWidth={1.8} />
      <span>{label}</span>
    </NavLink>
  )
}
