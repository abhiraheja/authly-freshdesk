import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './components/RequireAuth'
import { RequireRole } from './components/RequireRole'
import { DashboardPage } from './pages/DashboardPage'
import { EmailAuthPage } from './pages/EmailAuthPage'
import { OnboardingWorkspacePage } from './pages/OnboardingWorkspacePage'
import { VerifyPage } from './pages/VerifyPage'
import { AgentWorkspacePage } from './pages/agent/AgentWorkspacePage'
import { NewTicketPage } from './pages/portal/NewTicketPage'
import { PortalTicketDetailPage } from './pages/portal/PortalTicketDetailPage'
import { PortalTicketsPage } from './pages/portal/PortalTicketsPage'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<EmailAuthPage mode="login" />} />
      <Route path="/signup" element={<EmailAuthPage mode="signup" />} />
      <Route path="/auth/verify" element={<VerifyPage />} />
      <Route path="/onboarding/workspace" element={<OnboardingWorkspacePage />} />
      <Route element={<RequireAuth />}>
        <Route path="/portal" element={<PortalTicketsPage />} />
        <Route path="/portal/tickets" element={<Navigate to="/portal" replace />} />
        <Route path="/portal/tickets/new" element={<NewTicketPage />} />
        <Route path="/portal/tickets/:id" element={<PortalTicketDetailPage />} />
        <Route element={<RequireRole roles={['agent', 'admin']} />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/dashboard/tickets" element={<AgentWorkspacePage />} />
          <Route path="/dashboard/tickets/:id" element={<AgentWorkspacePage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

export default App
