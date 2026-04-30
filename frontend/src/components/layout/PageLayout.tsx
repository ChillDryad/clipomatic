import type { ReactNode } from 'react'
import { Navbar } from './Navbar'

interface PageLayoutProps {
  children: ReactNode
}

export function PageLayout({ children }: PageLayoutProps) {
  return (
    <div className="min-h-screen bg-[var(--ctp-base)]">
      <Navbar />
      <main className="pt-11 min-h-screen">
        <div className="px-4 py-5">
          <div className="pb-8 animate-fadeIn">
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}
