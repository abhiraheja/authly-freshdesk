import { Alert, Box, Button, CircularProgress, Rating, Stack, TextField, Typography } from '@mui/material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { getCsat, submitCsat } from '../../api/csat'
import { getPublicBranding } from '../../api/guest'
import { BrandedCard, BrandedFrame } from '../../components/BrandedFrame'

// Public, workspace-branded satisfaction survey reached from the resolution
// email link (/csat/:ticketId?token=...). Always light, workspace brand
// (invariant 6). The GET only reads the survey; the rating is recorded on POST.
export function CsatPage() {
  const { ticketId = '' } = useParams()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''

  const [rating, setRating] = useState<number | null>(null)
  const [comment, setComment] = useState('')

  const surveyQuery = useQuery({
    queryKey: ['csat', ticketId, token],
    queryFn: () => getCsat(ticketId, token),
    enabled: !!ticketId && !!token,
    retry: false,
  })
  const brandingQuery = useQuery({
    queryKey: ['branding', surveyQuery.data?.workspaceSlug],
    queryFn: () => getPublicBranding(surveyQuery.data!.workspaceSlug),
    enabled: !!surveyQuery.data?.workspaceSlug,
    retry: false,
  })

  const submit = useMutation({
    mutationFn: () => submitCsat(ticketId, token, rating!, comment),
    onSuccess: () => surveyQuery.refetch(),
  })

  if (surveyQuery.isPending || (surveyQuery.data && brandingQuery.isPending)) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    )
  }

  if (!surveyQuery.data || !brandingQuery.data) {
    return (
      <Box sx={{ p: 6, textAlign: 'center', color: 'text.secondary' }}>
        This rating link is invalid or has expired.
      </Box>
    )
  }

  const survey = surveyQuery.data
  const branding = brandingQuery.data
  // Thank-you view: either already rated when the page loaded, or just submitted.
  const done = survey.submitted || submit.isSuccess
  const finalRating = survey.rating ?? rating

  return (
    <BrandedFrame branding={branding}>
      <BrandedCard>
        <Typography sx={{ fontSize: 13, color: '#9CA3AF', mb: 0.5 }}>Ticket #{survey.ticketRef}</Typography>
        <Typography sx={{ fontSize: 20, fontWeight: 700, mb: 0.5, color: '#1E1B2E' }}>{survey.subject}</Typography>

        {done ? (
          <Box sx={{ textAlign: 'center', py: 2 }}>
            <Typography sx={{ fontSize: 18, fontWeight: 700, mt: 1, mb: 1, color: '#1E1B2E' }}>
              Thanks for your feedback!
            </Typography>
            {finalRating != null && (
              <Rating value={finalRating} max={5} readOnly sx={{ fontSize: 34 }} />
            )}
            <Typography sx={{ fontSize: 14, color: '#6B7280', mt: 1 }}>
              Your response has been recorded.
            </Typography>
          </Box>
        ) : (
          <Stack spacing={2.5} sx={{ mt: 2, alignItems: 'center' }}>
            <Typography sx={{ fontSize: 16, fontWeight: 600, color: '#374151' }}>
              How satisfied were you with the support you received?
            </Typography>
            <Rating value={rating} onChange={(_, v) => setRating(v)} max={5} sx={{ fontSize: 44 }} />
            <TextField
              fullWidth
              multiline
              minRows={3}
              placeholder="Tell us more (optional)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            {submit.isError && (
              <Alert severity="error" sx={{ width: '100%' }}>
                {(submit.error as Error).message}
              </Alert>
            )}
            <Button
              variant="contained"
              fullWidth
              disabled={rating == null || submit.isPending}
              onClick={() => submit.mutate()}
              sx={{ bgcolor: branding.primaryColor, '&:hover': { bgcolor: branding.primaryColor, filter: 'brightness(0.92)' } }}
            >
              {submit.isPending ? 'Submitting…' : 'Submit rating'}
            </Button>
          </Stack>
        )}
      </BrandedCard>
    </BrandedFrame>
  )
}
