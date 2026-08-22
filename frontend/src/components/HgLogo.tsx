type HgLogoProps = {
  compact?: boolean
}

export function HgLogo({ compact = false }: HgLogoProps) {
  return (
    <div className={compact ? 'hg-logo hg-logo--compact' : 'hg-logo'} aria-label="HackerGuardian">
      <svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <path
          d="M32 5.5c8.8 5.8 17.6 6.2 25.5 7.1v20.1c0 15.6-10.7 23.8-25.5 29C17.2 56.5 6.5 48.3 6.5 32.7V12.6C14.4 11.7 23.2 11.3 32 5.5Z"
          stroke="currentColor"
          strokeWidth="2.1"
        />
        <path
          d="M15.5 32.8S21.9 22.7 32 22.7s16.5 10.1 16.5 10.1S42.1 42.9 32 42.9 15.5 32.8 15.5 32.8Z"
          stroke="currentColor"
          strokeWidth="2.1"
        />
        <circle cx="32" cy="32.8" r="6.4" stroke="currentColor" strokeWidth="2.1" />
        <circle cx="32" cy="32.8" r="2.7" fill="currentColor" />
      </svg>
    </div>
  )
}
