import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import { PipelineProvider } from './context/PipelineContext'
import { PageLayout } from './components/layout/PageLayout'
import { HomePage } from './pages/HomePage'
import { DashboardPage } from './pages/DashboardPage'
import { PipelinePage } from './pages/PipelinePage'
import { VideoProjectPage } from './pages/VideoProjectPage'
import { TimelineEditorPage } from './pages/TimelineEditorPage'
import { SchedulePage } from './pages/SchedulePage'
import { QueuePage } from './pages/QueuePage'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { TeamListPage } from './pages/TeamListPage'
import { TeamDetailPage } from './pages/TeamDetailPage'
import { useAuth } from './hooks/useAuth'

// Protected route wrapper - redirects to login if not authenticated
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-[var(--ctp-subtext)]">Loading...</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname)}`} replace />
  }

  return <>{children}</>
}

// Public route wrapper - redirects to dashboard if already authenticated
function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  const location = useLocation()
  const redirectPath = location.pathname === '/login' || location.pathname === '/register'
    ? '/dashboard'
    : location.pathname

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-[var(--ctp-subtext)]">Loading...</div>
      </div>
    )
  }

  if (isAuthenticated) {
    return <Navigate to={redirectPath} replace />
  }

  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <PipelineProvider>
          <Routes>
            {/* Public routes - auth pages without PageLayout */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />

            {/* Protected routes with PageLayout */}
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <PageLayout>
                    <DashboardPage />
                  </PageLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Navigate to="/dashboard" replace />
                </ProtectedRoute>
              }
            />
            <Route
              path="/pipeline"
              element={
                <ProtectedRoute>
                  <PageLayout>
                    <PipelinePage />
                  </PageLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/video/:projectId"
              element={
                <ProtectedRoute>
                  <PageLayout>
                    <VideoProjectPage />
                  </PageLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/video/:projectId/timeline/:clipId"
              element={
                <ProtectedRoute>
                  <PageLayout>
                    <TimelineEditorPage />
                  </PageLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/schedule"
              element={
                <ProtectedRoute>
                  <PageLayout>
                    <SchedulePage />
                  </PageLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/queue"
              element={
                <ProtectedRoute>
                  <PageLayout>
                    <QueuePage />
                  </PageLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/teams"
              element={
                <ProtectedRoute>
                  <PageLayout>
                    <TeamListPage />
                  </PageLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/teams/:teamId"
              element={
                <ProtectedRoute>
                  <PageLayout>
                    <TeamDetailPage />
                  </PageLayout>
                </ProtectedRoute>
              }
            />
          </Routes>
        </PipelineProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}
