import { Alert, Box, Button, Chip, IconButton, Paper, Stack, Switch, TextField, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  addDomain,
  deleteDomain,
  listDomains,
  setDiscoverable,
  verifyDomain,
  type WorkspaceDomain,
} from '../../api/sso'
import { AppShell } from '../../components/AppShell'
import { shadows } from '../../theme'

export function DomainsPage() {
  const queryClient = useQueryClient()
  const [newDomain, setNewDomain] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const domainsQuery = useQuery({ queryKey: ['domains'], queryFn: listDomains })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['domains'] })

  const add = useMutation({
    mutationFn: () => addDomain(newDomain.trim()),
    onSuccess: () => {
      setNewDomain('')
      setError(null)
      invalidate()
    },
    onError: (e: Error) => setError(e.message),
  })

  const verify = useMutation({
    mutationFn: verifyDomain,
    onSuccess: (r) => {
      setNotice(r.verified ? 'Domain verified.' : 'TXT record not found yet — DNS can take a few minutes to propagate.')
      invalidate()
    },
  })

  const toggle = useMutation({
    mutationFn: ({ id, discoverable }: { id: string; discoverable: boolean }) => setDiscoverable(id, discoverable),
    onSuccess: invalidate,
  })

  const remove = useMutation({ mutationFn: deleteDomain, onSuccess: invalidate })

  const domains = domainsQuery.data ?? []

  const row = (d: WorkspaceDomain) => (
    <Paper key={d.id} variant="outlined" sx={{ borderRadius: '12px', p: 2, mb: 1.5, boxShadow: shadows.soft }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5 }}>
        <Typography sx={{ fontSize: 15, fontWeight: 700, flex: 1 }}>{d.domain}</Typography>
        {d.verified ? (
          <Chip label="Verified" size="small" sx={{ bgcolor: '#DCFCE7', color: '#15803D', fontWeight: 700 }} />
        ) : (
          <Chip label="Unverified" size="small" sx={{ bgcolor: '#FEF3C7', color: '#B45309', fontWeight: 700 }} />
        )}
        <IconButton size="small" sx={{ color: 'text.secondary' }} onClick={() => remove.mutate(d.id)}>
          ✕
        </IconButton>
      </Stack>

      {!d.verified && (
        <Box sx={{ mt: 1.5, bgcolor: 'surfaceMuted', borderRadius: '10px', p: 1.75 }}>
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mb: 0.5 }}>
            Add this TXT record to <b>{d.txtRecordName}</b>, then verify:
          </Typography>
          <Typography sx={{ fontFamily: 'monospace', fontSize: 12.5, wordBreak: 'break-all' }}>
            {d.txtRecordValue}
          </Typography>
          <Button size="small" variant="contained" sx={{ mt: 1.25 }} disabled={verify.isPending} onClick={() => verify.mutate(d.id)}>
            Verify ownership
          </Button>
        </Box>
      )}

      {d.verified && (
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mt: 1 }}>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
            Discoverable — route <b>@{d.domain}</b> logins to this workspace's SSO
          </Typography>
          <Switch checked={d.discoverable} onChange={(e) => toggle.mutate({ id: d.id, discoverable: e.target.checked })} />
        </Stack>
      )}
    </Paper>
  )

  return (
    <AppShell>
      <Typography variant="h5" sx={{ mb: 0.5 }}>Domains</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Verify your email domains so people who enter an <b>@yourcompany.com</b> address are routed straight to your SSO.
      </Typography>

      <Box sx={{ maxWidth: 640 }}>
        <Paper variant="outlined" sx={{ borderRadius: '14px', p: 2.5, mb: 3, boxShadow: shadows.soft }}>
          <Typography sx={{ fontSize: 15, fontWeight: 700, mb: 1.5 }}>Add a domain</Typography>
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              fullWidth
              placeholder="acme.com"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
            />
            <Button variant="contained" disabled={!newDomain.includes('.') || add.isPending} onClick={() => add.mutate()}>
              Add
            </Button>
          </Stack>
          {error && <Alert severity="error" sx={{ mt: 1.5 }}>{error}</Alert>}
        </Paper>

        {notice && <Alert severity="info" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}
        {domains.length === 0 ? (
          <Typography color="text.secondary" sx={{ fontSize: 14 }}>No domains yet.</Typography>
        ) : (
          domains.map(row)
        )}
      </Box>
    </AppShell>
  )
}
