export function getRoleBadgeClass(role: string): string {
  switch (role) {
    case 'owner': return 'bg-[var(--ctp-mauve-20)] text-[var(--ctp-mauve)] border-[var(--ctp-mauve-30)]'
    case 'admin': return 'bg-[var(--ctp-blue-20)] text-[var(--ctp-blue)] border-[var(--ctp-blue-30)]'
    case 'editor': return 'bg-[var(--ctp-green-20)] text-[var(--ctp-green)] border-[var(--ctp-green-30)]'
    case 'viewer': return 'bg-[var(--ctp-overlay-20)] text-[var(--ctp-subtext)] border-[var(--ctp-overlay-30)]'
    default: return 'bg-[var(--ctp-surface-1)] text-[var(--ctp-subtext)]'
  }
}
