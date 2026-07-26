import { Box, CircularProgress, Link, Stack, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import { getPublicBranding } from '../../api/guest'
import { getPublicKbArticle, listPublicKb } from '../../api/kb'
import { BrandedCard, BrandedFrame } from '../../components/BrandedFrame'

// Public, workspace-branded help centre. /kb?workspace=slug lists published
// articles; &article=id shows one. Always light, workspace brand (invariant 6).
export function PublicKbPage() {
  const [params] = useSearchParams()
  const slug = params.get('workspace') ?? ''
  const articleId = params.get('article')

  const brandingQuery = useQuery({
    queryKey: ['branding', slug],
    queryFn: () => getPublicBranding(slug),
    enabled: !!slug,
    retry: false,
  })
  const listQuery = useQuery({
    queryKey: ['public-kb', slug],
    queryFn: () => listPublicKb(slug),
    enabled: !!slug && !articleId,
  })
  const articleQuery = useQuery({
    queryKey: ['public-kb', slug, articleId],
    queryFn: () => getPublicKbArticle(slug, articleId!),
    enabled: !!slug && !!articleId,
    retry: false,
  })

  if (brandingQuery.isPending) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    )
  }
  const branding = brandingQuery.data
  if (!branding) {
    return <Box sx={{ p: 6, textAlign: 'center', color: 'text.secondary' }}>Help centre not found.</Box>
  }

  return (
    <BrandedFrame
      branding={branding}
      headerRight={
        <Link component={RouterLink} to={`/submit?workspace=${slug}`}
          sx={{ color: '#fff', opacity: 0.85, fontSize: 13, textDecoration: 'none' }}>
          Contact support →
        </Link>
      }
    >
      {articleId ? (
        <BrandedCard>
          <Link component={RouterLink} to={`/kb?workspace=${slug}`} sx={{ fontSize: 13, color: branding.primaryColor }}>
            ← All articles
          </Link>
          {articleQuery.isPending ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
          ) : articleQuery.data ? (
            <>
              <Typography sx={{ fontSize: 24, fontWeight: 700, mt: 2, mb: 1 }}>{articleQuery.data.title}</Typography>
              {articleQuery.data.categoryName && (
                <Typography sx={{ fontSize: 13, color: '#9CA3AF', mb: 2 }}>{articleQuery.data.categoryName}</Typography>
              )}
              <Typography sx={{ fontSize: 15, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: '#374151' }}>
                {articleQuery.data.body}
              </Typography>
            </>
          ) : (
            <Typography sx={{ py: 4, textAlign: 'center', color: '#6B7280' }}>Article not found.</Typography>
          )}
        </BrandedCard>
      ) : (
        <BrandedCard>
          <Typography sx={{ fontSize: 24, fontWeight: 700, textAlign: 'center', mb: 3 }}>
            How can we help?
          </Typography>
          {listQuery.isPending ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
          ) : (listQuery.data?.length ?? 0) === 0 ? (
            <Typography sx={{ textAlign: 'center', color: '#6B7280', py: 3 }}>No articles yet.</Typography>
          ) : (
            <Stack spacing={1.25}>
              {listQuery.data!.map((a) => (
                <Link
                  key={a.id}
                  component={RouterLink}
                  to={`/kb?workspace=${slug}&article=${a.id}`}
                  sx={{
                    display: 'block',
                    p: 2,
                    border: '1px solid #E9E4F5',
                    borderRadius: '11px',
                    textDecoration: 'none',
                    color: 'inherit',
                    '&:hover': { borderColor: branding.primaryColor },
                  }}
                >
                  <Typography sx={{ fontSize: 15, fontWeight: 700, color: '#1E1B2E' }}>{a.title}</Typography>
                  <Typography sx={{ fontSize: 13, color: '#6B7280', mt: 0.3 }}>{a.excerpt}</Typography>
                </Link>
              ))}
            </Stack>
          )}
        </BrandedCard>
      )}
    </BrandedFrame>
  )
}
