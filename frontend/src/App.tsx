import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './components/RequireAuth'
import { RequireRole } from './components/RequireRole'
import { DashboardPage } from './pages/DashboardPage'
import { EmailAuthPage } from './pages/EmailAuthPage'
import { OnboardingWorkspacePage } from './pages/OnboardingWorkspacePage'
import { VerifyPage } from './pages/VerifyPage'
import { AgentWorkspacePage } from './pages/agent/AgentWorkspacePage'
import { CannedResponsesPage } from './pages/agent/CannedResponsesPage'
import { ProblemsPage } from './pages/agent/ProblemsPage'
import { AnnouncementsPage } from './pages/admin/AnnouncementsPage'
import { AutomationPage } from './pages/admin/AutomationPage'
import { BrandingSettingsPage } from './pages/admin/BrandingSettingsPage'
import { DomainsPage } from './pages/admin/DomainsPage'
import { EmailSettingsPage } from './pages/admin/EmailSettingsPage'
import { SlaSettingsPage } from './pages/admin/SlaSettingsPage'
import { SsoSettingsPage } from './pages/admin/SsoSettingsPage'
import { TeamsPage } from './pages/admin/TeamsPage'
import { UsersPage } from './pages/admin/UsersPage'
import { WidgetPage } from './pages/admin/WidgetPage'
import { SsoCompletePage } from './pages/auth/SsoCompletePage'
import { NewTicketPage } from './pages/portal/NewTicketPage'
import { PortalTicketDetailPage } from './pages/portal/PortalTicketDetailPage'
import { PortalTicketsPage } from './pages/portal/PortalTicketsPage'
import { GuestTicketPage } from './pages/public/GuestTicketPage'
import { InviteAcceptPage } from './pages/public/InviteAcceptPage'
import { PublicKbPage } from './pages/public/PublicKbPage'
import { SubmitPage } from './pages/public/SubmitPage'
import { KbPage } from './pages/admin/KbPage'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<EmailAuthPage mode="login" />} />
      <Route path="/signup" element={<EmailAuthPage mode="signup" />} />
      <Route path="/auth/verify" element={<VerifyPage />} />
      <Route path="/auth/sso/complete" element={<SsoCompletePage />} />
      <Route path="/onboarding/workspace" element={<OnboardingWorkspacePage />} />
      {/* Public, workspace-branded surfaces */}
      <Route path="/submit" element={<SubmitPage />} />
      <Route path="/kb" element={<PublicKbPage />} />
      <Route path="/tickets/:id" element={<GuestTicketPage />} />
      <Route path="/invite/:token" element={<InviteAcceptPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/portal" element={<PortalTicketsPage />} />
        <Route path="/portal/tickets" element={<Navigate to="/portal" replace />} />
        <Route path="/portal/tickets/new" element={<NewTicketPage />} />
        <Route path="/portal/tickets/:id" element={<PortalTicketDetailPage />} />
        <Route element={<RequireRole roles={['agent', 'admin']} />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/dashboard/tickets" element={<AgentWorkspacePage />} />
          <Route path="/dashboard/tickets/:id" element={<AgentWorkspacePage />} />
          <Route path="/dashboard/problems" element={<ProblemsPage />} />
          <Route path="/dashboard/kb" element={<KbPage />} />
          <Route path="/dashboard/canned" element={<CannedResponsesPage />} />
        </Route>
        <Route element={<RequireRole roles={['admin']} />}>
          <Route path="/admin/users" element={<UsersPage />} />
          <Route path="/admin/teams" element={<TeamsPage />} />
          <Route path="/admin/automation" element={<AutomationPage />} />
          <Route path="/admin/announcements" element={<AnnouncementsPage />} />
          <Route path="/admin/settings/branding" element={<BrandingSettingsPage />} />
          <Route path="/admin/settings/email" element={<EmailSettingsPage />} />
          <Route path="/admin/settings/sla" element={<SlaSettingsPage />} />
          <Route path="/admin/settings/sso" element={<SsoSettingsPage />} />
          <Route path="/admin/settings/domains" element={<DomainsPage />} />
          <Route path="/admin/widget" element={<WidgetPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

export default App
