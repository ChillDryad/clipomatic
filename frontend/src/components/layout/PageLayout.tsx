import type { ReactNode } from 'react'
import { Navbar } from './Navbar'
import { BreadcrumbSteppers } from './BreadcrumbSteppers'

interface PageLayoutProps {
  children: ReactNode
}

export function PageLayout({ children }: PageLayoutProps) {
  return (
    <div className="min-h-screen bg-[var(--ctp-base)]">
      <Navbar />
      <main className="pt-11 min-h-screen">
        <div className="px-4 py-5">
          <div className="mb-3">
            <BreadcrumbSteppers />
          </div>
          <div className="pb-8 animate-fadeIn">
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}
