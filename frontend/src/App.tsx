import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './components/RequireAuth'
import { DashboardPage } from './pages/DashboardPage'
import { EmailAuthPage } from './pages/EmailAuthPage'
import { OnboardingWorkspacePage } from './pages/OnboardingWorkspacePage'
import { PortalPage } from './pages/PortalPage'
import { VerifyPage } from './pages/VerifyPage'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<EmailAuthPage mode="login" />} />
      <Route path="/signup" element={<EmailAuthPage mode="signup" />} />
      <Route path="/auth/verify" element={<VerifyPage />} />
      <Route path="/onboarding/workspace" element={<OnboardingWorkspacePage />} />
      <Route element={<RequireAuth />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/portal" element={<PortalPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

export default App
