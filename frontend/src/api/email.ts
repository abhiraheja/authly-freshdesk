import { api } from './client'

export interface EmailConfig {
  useSharedSmtp: boolean
  smtpHost: string | null
  smtpPort: number | null
  smtpUser: string | null
  smtpUseStartTls: boolean
  fromName: string | null
  fromEmail: string | null
  hasSmtpPassword: boolean
  emailMode: string
  newTicketViaEmail: boolean
  inboundConnector: string | null
  inboundProvider: string | null
  inboundReplyDomain: string | null
  hasInboundWebhookSecret: boolean
  mailboxProtocol: string | null
  mailboxAddress: string | null
  mailboxHost: string | null
  mailboxPort: number | null
  mailboxUsername: string | null
  hasMailboxPassword: boolean
  pollIntervalSeconds: number
  lastPolledAt: string | null
}

// Secret fields (smtpPassword, inboundWebhookSecret, mailboxPassword): omit/null
// keeps the stored value, "" clears it, any value sets it.
export interface SaveEmailConfig {
  useSharedSmtp: boolean
  smtpHost: string | null
  smtpPort: number | null
  smtpUser: string | null
  smtpUseStartTls: boolean
  fromName: string | null
  fromEmail: string | null
  smtpPassword: string | null
  emailMode: string
  newTicketViaEmail: boolean
  inboundConnector: string | null
  inboundProvider: string | null
  inboundReplyDomain: string | null
  inboundWebhookSecret: string | null
  mailboxProtocol: string | null
  mailboxAddress: string | null
  mailboxHost: string | null
  mailboxPort: number | null
  mailboxUsername: string | null
  mailboxPassword: string | null
  pollIntervalSeconds: number | null
}

export interface NotificationSettings {
  notifyCustomerOnCreate: boolean
  notifyCustomerOnReply: boolean
  notifyCustomerOnStatus: boolean
  notifyAgentOnAssign: boolean
  notifyAgentOnReply: boolean
  notifyAgentOnReassign: boolean
  csatEnabled: boolean
}

export function getEmailConfig() {
  return api<EmailConfig>('/api/admin/settings/email')
}

export function saveEmailConfig(body: SaveEmailConfig) {
  return api<EmailConfig>('/api/admin/settings/email', { method: 'PUT', body: JSON.stringify(body) })
}

export function getNotificationSettings() {
  return api<NotificationSettings>('/api/admin/settings/notifications')
}

export function saveNotificationSettings(body: NotificationSettings) {
  return api<NotificationSettings>('/api/admin/settings/notifications', {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}
