import { zodResolver } from '@hookform/resolvers/zod'
import { Alert, Box, Button, TextField, Typography } from '@mui/material'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { Navigate } from 'react-router-dom'
import { z } from 'zod'
import { signup } from '../api/auth'
import { ApiError } from '../api/client'
import { AuthCard } from '../components/AuthCard'
import { loadPendingAuth } from '../lib/pendingAuth'
import { useAuthCompletion } from './useAuthCompletion'

const schema = z.object({
  workspaceName: z.string().trim().min(2, 'Company name is required'),
  workspaceSlug: z
    .string()
    .regex(
      /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/,
      'Lowercase letters, digits and hyphens only',
    ),
  name: z.string().trim().max(120).optional(),
})

type FormValues = z.infer<typeof schema>

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
}

// Onboarding step 2: the email was verified on step 1; POST /api/signup
// consumes the token and creates the workspace with this user as admin.
export function OnboardingWorkspacePage() {
  const [pending] = useState(loadPendingAuth)
  const [error, setError] = useState<string | null>(null)
  const completeAuth = useAuthCompletion()
  const [slugEdited, setSlugEdited] = useState(false)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { workspaceName: '', workspaceSlug: '', name: '' },
  })

  const create = useMutation({
    mutationFn: (values: FormValues) =>
      signup({
        email: pending!.email,
        token: pending!.token,
        code: pending!.code,
        workspaceName: values.workspaceName,
        workspaceSlug: values.workspaceSlug,
        name: values.name || undefined,
      }),
    onSuccess: (res) => completeAuth(res.user),
    onError: (e: Error) => {
      if (e instanceof ApiError && e.status === 409) {
        form.setError('workspaceSlug', { message: e.message })
      } else {
        setError(e.message)
      }
    },
  })

  if (!pending) return <Navigate to="/signup" replace />

  return (
    <AuthCard
      title="Create your workspace"
      subtitle="This is where your team manages tickets."
      stepsDone={2}
    >
      <form onSubmit={form.handleSubmit((values) => create.mutate(values))} noValidate>
        <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: '#334155', mb: 0.75 }}>Your name</Typography>
        <Controller
          name="name"
          control={form.control}
          render={({ field, fieldState }) => (
            <TextField
              {...field}
              fullWidth
              placeholder="Ada Lovelace"
              error={!!fieldState.error}
              helperText={fieldState.error?.message}
            />
          )}
        />
        <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: '#334155', mb: 0.75, mt: 2 }}>
          Company name
        </Typography>
        <Controller
          name="workspaceName"
          control={form.control}
          render={({ field, fieldState }) => (
            <TextField
              {...field}
              onChange={(e) => {
                field.onChange(e)
                if (!slugEdited) form.setValue('workspaceSlug', slugify(e.target.value))
              }}
              fullWidth
              placeholder="Acme Corporation"
              error={!!fieldState.error}
              helperText={fieldState.error?.message}
            />
          )}
        />
        <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: '#334155', mb: 0.75, mt: 2 }}>
          Workspace URL
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'flex-start' }}>
          <Controller
            name="workspaceSlug"
            control={form.control}
            render={({ field, fieldState }) => (
              <TextField
                {...field}
                onChange={(e) => {
                  setSlugEdited(true)
                  field.onChange(slugify(e.target.value))
                }}
                fullWidth
                placeholder="acme"
                error={!!fieldState.error}
                helperText={fieldState.error?.message}
                sx={{ '& .MuiOutlinedInput-root': { borderTopRightRadius: 0, borderBottomRightRadius: 0 } }}
              />
            )}
          />
          <Box
            sx={{
              px: 1.75,
              py: '15.5px',
              bgcolor: '#F8FAFC',
              border: '1px solid',
              borderColor: 'divider',
              borderLeft: 'none',
              borderRadius: '0 10px 10px 0',
              color: 'text.secondary',
              fontSize: 15,
              whiteSpace: 'nowrap',
            }}
          >
            .trackly.com
          </Box>
        </Box>
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        <Button fullWidth size="large" variant="contained" type="submit" sx={{ mt: 3 }} disabled={create.isPending}>
          Continue →
        </Button>
      </form>
    </AuthCard>
  )
}
