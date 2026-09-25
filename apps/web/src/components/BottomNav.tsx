import { NavLink } from 'react-router'
import { t } from '../i18n'
import styles from './BottomNav.module.css'

const items = [
  { to: '/today', label: () => t('nav.today'), icon: 'M4 6h16M4 12h16M4 18h10' },
  { to: '/stack', label: () => t('nav.stack'), icon: 'M4 7h16v4H4zM4 13h16v4H4z' },
  { to: '/add', label: () => t('nav.add'), icon: 'M12 5v14M5 12h14' },
  {
    to: '/reminders',
    label: () => t('nav.reminders'),
    icon: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20h4',
  },
  {
    to: '/settings',
    label: () => t('nav.settings'),
    icon: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM4 12h2m12 0h2M12 4v2m0 12v2',
  },
] as const

export function BottomNav() {
  return (
    <nav className={styles.nav} aria-label={t('nav.label')}>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ''}`}
        >
          <svg
            className={styles.icon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d={item.icon} />
          </svg>
          <span>{item.label()}</span>
        </NavLink>
      ))}
    </nav>
  )
}
