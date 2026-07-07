import { Stack } from '@mui/material'
import { useRef } from 'react'

interface CodeInputProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

// Six single-digit boxes per the onboarding mockup (step 1b).
export function CodeInput({ value, onChange, disabled }: CodeInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([])

  const setDigit = (index: number, digit: string) => {
    const digits = value.padEnd(6, ' ').split('')
    digits[index] = digit || ' '
    onChange(digits.join('').trimEnd().replace(/ /g, ''))
  }

  const handleChange = (index: number, raw: string) => {
    const text = raw.replace(/\D/g, '')
    if (text.length > 1) {
      // Paste: fill from this box onward.
      onChange((value.slice(0, index) + text).slice(0, 6))
      refs.current[Math.min(index + text.length, 5)]?.focus()
      return
    }
    setDigit(index, text)
    if (text) refs.current[index + 1]?.focus()
  }

  const handleKeyDown = (index: number, event: React.KeyboardEvent) => {
    if (event.key === 'Backspace' && !value[index] && index > 0) {
      refs.current[index - 1]?.focus()
    }
  }

  return (
    <Stack direction="row" spacing={1} sx={{ justifyContent: 'center' }}>
      {Array.from({ length: 6 }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          value={value[i] ?? ''}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${i + 1}`}
          style={{
            width: 46,
            height: 54,
            textAlign: 'center',
            fontSize: 22,
            fontWeight: 700,
            border: '1.5px solid #CBD5E1',
            borderRadius: 10,
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />
      ))}
    </Stack>
  )
}
