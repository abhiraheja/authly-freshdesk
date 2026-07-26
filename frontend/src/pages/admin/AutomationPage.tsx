import { Box, Button, Chip, IconButton, MenuItem, Paper, Stack, Switch, TextField, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  createAutomationRule,
  deleteAutomationRule,
  listAutomationRules,
  updateAutomationRule,
  type ActionDef,
  type AutomationRule,
  type Condition,
} from '../../api/automation'
import { listCategories } from '../../api/tickets'
import { listTeams } from '../../api/teams'
import { AppShell } from '../../components/AppShell'
import { shadows } from '../../theme'

const FIELDS = ['priority', 'status', 'channel', 'subject', 'category']
const OPS = [
  { value: 'equals', label: 'is' },
  { value: 'not_equals', label: 'is not' },
  { value: 'contains', label: 'contains' },
]
const ACTIONS = [
  { value: 'set_priority', label: 'Set priority' },
  { value: 'set_status', label: 'Set status' },
  { value: 'assign_team', label: 'Assign team' },
  { value: 'add_tag', label: 'Add tag' },
  { value: 'add_note', label: 'Add internal note' },
]
const PRIORITIES = ['low', 'medium', 'high', 'urgent']
const STATUSES = ['open', 'pending', 'resolved', 'closed']

const empty = (): Omit<AutomationRule, 'id'> => ({
  name: '',
  trigger: 'on_create',
  conditions: [],
  actions: [],
  enabled: true,
  sortOrder: 0,
})

export function AutomationPage() {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<AutomationRule | null>(null)

  const rulesQuery = useQuery({ queryKey: ['automation'], queryFn: listAutomationRules })
  const teamsQuery = useQuery({ queryKey: ['teams'], queryFn: listTeams })
  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: listCategories })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['automation'] })

  const teams = teamsQuery.data ?? []
  const categories = categoriesQuery.data ?? []

  const save = useMutation({
    mutationFn: () => {
      const { id, ...body } = draft as AutomationRule
      return id ? updateAutomationRule(id, body) : createAutomationRule(body)
    },
    onSuccess: () => {
      invalidate()
      setDraft(null)
    },
  })
  const remove = useMutation({ mutationFn: deleteAutomationRule, onSuccess: () => { invalidate(); setDraft(null) } })
  const toggle = useMutation({
    mutationFn: (rule: AutomationRule) => {
      const { id, ...body } = rule
      return updateAutomationRule(id, { ...body, enabled: !rule.enabled })
    },
    onSuccess: invalidate,
  })

  const patch = (p: Partial<AutomationRule>) => setDraft((d) => (d ? { ...d, ...p } : d))

  // Value editor that adapts to the field/action being configured.
  const valueEditor = (kind: string, value: string, onChange: (v: string) => void) => {
    if (kind === 'priority' || kind === 'set_priority')
      return <ValueSelect value={value} onChange={onChange} options={PRIORITIES} />
    if (kind === 'status' || kind === 'set_status')
      return <ValueSelect value={value} onChange={onChange} options={STATUSES} />
    if (kind === 'assign_team')
      return (
        <TextField select size="small" fullWidth value={value} onChange={(e) => onChange(e.target.value)}>
          {teams.map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
        </TextField>
      )
    if (kind === 'category')
      return (
        <TextField select size="small" fullWidth value={value} onChange={(e) => onChange(e.target.value)}>
          {categories.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
        </TextField>
      )
    return <TextField size="small" fullWidth value={value} onChange={(e) => onChange(e.target.value)} placeholder="value" />
  }

  if (draft) {
    const setCond = (i: number, c: Partial<Condition>) =>
      patch({ conditions: draft.conditions.map((x, j) => (j === i ? { ...x, ...c } : x)) })
    const setAct = (i: number, a: Partial<ActionDef>) =>
      patch({ actions: draft.actions.map((x, j) => (j === i ? { ...x, ...a } : x)) })

    return (
      <AppShell>
        <Button size="small" sx={{ mb: 2 }} onClick={() => setDraft(null)}>← Back to rules</Button>
        <Paper variant="outlined" sx={{ borderRadius: '14px', p: 3, maxWidth: 720, boxShadow: shadows.soft }}>
          <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
            <TextField fullWidth label="Rule name" value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
            <TextField select label="When" value={draft.trigger} onChange={(e) => patch({ trigger: e.target.value })} sx={{ width: 200 }}>
              <MenuItem value="on_create">Ticket created</MenuItem>
              <MenuItem value="on_update">Ticket updated</MenuItem>
            </TextField>
          </Stack>

          <Typography sx={{ fontSize: 13.5, fontWeight: 700, mt: 1, mb: 1 }}>If all of these match</Typography>
          {draft.conditions.map((c, i) => (
            <Stack key={i} direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center' }}>
              <TextField select size="small" value={c.field} onChange={(e) => setCond(i, { field: e.target.value, value: '' })} sx={{ width: 140 }}>
                {FIELDS.map((f) => <MenuItem key={f} value={f} sx={{ textTransform: 'capitalize' }}>{f}</MenuItem>)}
              </TextField>
              <TextField select size="small" value={c.op} onChange={(e) => setCond(i, { op: e.target.value })} sx={{ width: 110 }}>
                {OPS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
              </TextField>
              <Box sx={{ flex: 1 }}>{valueEditor(c.field, c.value, (v) => setCond(i, { value: v }))}</Box>
              <IconButton size="small" onClick={() => patch({ conditions: draft.conditions.filter((_, j) => j !== i) })}>✕</IconButton>
            </Stack>
          ))}
          <Button size="small" onClick={() => patch({ conditions: [...draft.conditions, { field: 'priority', op: 'equals', value: '' }] })}>
            + Add condition
          </Button>

          <Typography sx={{ fontSize: 13.5, fontWeight: 700, mt: 2.5, mb: 1 }}>Then do this</Typography>
          {draft.actions.map((a, i) => (
            <Stack key={i} direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center' }}>
              <TextField select size="small" value={a.type} onChange={(e) => setAct(i, { type: e.target.value, value: '' })} sx={{ width: 180 }}>
                {ACTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
              </TextField>
              <Box sx={{ flex: 1 }}>{valueEditor(a.type, a.value, (v) => setAct(i, { value: v }))}</Box>
              <IconButton size="small" onClick={() => patch({ actions: draft.actions.filter((_, j) => j !== i) })}>✕</IconButton>
            </Stack>
          ))}
          <Button size="small" onClick={() => patch({ actions: [...draft.actions, { type: 'set_priority', value: '' }] })}>
            + Add action
          </Button>

          <Stack direction="row" spacing={1.5} sx={{ mt: 3, alignItems: 'center' }}>
            <Button variant="contained" disabled={!draft.name.trim() || save.isPending} onClick={() => save.mutate()}>
              Save rule
            </Button>
            {draft.id && <Button color="error" onClick={() => remove.mutate(draft.id)}>Delete</Button>}
          </Stack>
        </Paper>
      </AppShell>
    )
  }

  const rules = rulesQuery.data ?? []

  return (
    <AppShell>
      <Stack direction="row" sx={{ alignItems: 'center', mb: 0.5 }}>
        <Typography variant="h5" sx={{ flex: 1 }}>Automation</Typography>
        <Button variant="contained" onClick={() => setDraft({ id: '', ...empty() })}>New rule</Button>
      </Stack>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        When a ticket is created or updated and all conditions match, run the actions automatically.
      </Typography>
      <Box sx={{ maxWidth: 640 }}>
        {rules.length === 0 ? (
          <Typography color="text.secondary" sx={{ fontSize: 14 }}>No rules yet.</Typography>
        ) : (
          rules.map((rule) => (
            <Paper key={rule.id} variant="outlined" sx={{ borderRadius: '12px', p: 2, mb: 1.25, boxShadow: shadows.soft }}>
              <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                <Box sx={{ flex: 1, cursor: 'pointer' }} onClick={() => setDraft(rule)}>
                  <Typography sx={{ fontSize: 14.5, fontWeight: 700 }}>{rule.name}</Typography>
                  <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                    {rule.trigger === 'on_create' ? 'On create' : 'On update'} · {rule.conditions.length} condition(s) · {rule.actions.length} action(s)
                  </Typography>
                </Box>
                {!rule.enabled && <Chip label="Off" size="small" sx={{ bgcolor: '#F1F5F9', color: '#64748B' }} />}
                <Switch checked={rule.enabled} onChange={() => toggle.mutate(rule)} />
              </Stack>
            </Paper>
          ))
        )}
      </Box>
    </AppShell>
  )
}

function ValueSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <TextField select size="small" fullWidth value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <MenuItem key={o} value={o} sx={{ textTransform: 'capitalize' }}>{o}</MenuItem>
      ))}
    </TextField>
  )
}
