import { NavLink } from 'react-router'
import { t } from '../i18n'
import { useAppState } from '../state/context'
import styles from './BottomNav.module.css'

const items = [
  { to: '/today', label: () => t('nav.today'), icon: 'M4 6h16M4 12h16M4 18h10' },
  { to: '/stack', label: () => t('nav.stack'), icon: 'M4 7h16v4H4zM4 13h16v4H4z' },
  { to: '/add', label: () => t('nav.add'), icon: 'M12 5v14M5 12h14' },
  {
    to: '/shopping',
    label: () => t('nav.shopping'),
    icon: 'M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6.2M9 20h.01M17 20h.01',
  },
  {
    to: '/profile',
    label: () => t('nav.profile'),
    icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c0-3.3 3.6-6 8-6s8 2.7 8 6',
  },
] as const

export function BottomNav() {
  const { state } = useAppState()
  const count = state.shopping.length
  return (
    <nav className={styles.nav} aria-label={t('nav.label')}>
      {items.map((item) => {
        const badge = item.to === '/shopping' && count > 0
        return (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ''}`}
            {...(badge
              ? { 'aria-label': t(`nav.shoppingCount.${count === 1 ? 'one' : 'other'}`, { count }) }
              : {})}
          >
            <span className={styles.iconWrap}>
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
              {badge && (
                <span className={styles.badge} aria-hidden="true">
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </span>
            <span>{item.label()}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}
