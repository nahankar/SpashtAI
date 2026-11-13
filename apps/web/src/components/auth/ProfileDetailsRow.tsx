import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type ProfileGender = 'MALE' | 'FEMALE' | ''

export function GenderSelect({
  value,
  onChange,
  compact = false,
}: {
  value: ProfileGender
  onChange: (gender: 'MALE' | 'FEMALE') => void
  compact?: boolean
}) {
  return (
    <div className="grid w-full grid-cols-2 gap-1" role="group" aria-label="Gender">
      <button
        type="button"
        aria-pressed={value === 'MALE'}
        onClick={() => onChange('MALE')}
        className={cn(
          'h-9 rounded-md border font-medium transition-colors',
          compact ? 'px-1 text-[11px]' : 'text-xs',
          value === 'MALE'
            ? 'border-primary bg-primary text-primary-foreground shadow-sm'
            : 'border-input bg-background text-foreground hover:bg-muted',
        )}
      >
        Male
      </button>
      <button
        type="button"
        aria-pressed={value === 'FEMALE'}
        onClick={() => onChange('FEMALE')}
        className={cn(
          'h-9 rounded-md border font-medium transition-colors',
          compact ? 'px-1 text-[11px]' : 'text-xs',
          value === 'FEMALE'
            ? 'border-primary bg-primary text-primary-foreground shadow-sm'
            : 'border-input bg-background text-foreground hover:bg-muted',
        )}
      >
        Female
      </button>
    </div>
  )
}

/** @deprecated Use GenderSelect — kept as alias for any stale imports. */
export const GenderToggle = GenderSelect

export function ProfileDetailsRow({
  dateOfBirth,
  onDateOfBirthChange,
  gender,
  onGenderChange,
  pincode,
  onPincodeChange,
  idPrefix = '',
}: {
  dateOfBirth: string
  onDateOfBirthChange: (v: string) => void
  gender: ProfileGender
  onGenderChange: (g: 'MALE' | 'FEMALE') => void
  idPrefix?: string
  pincode: string
  onPincodeChange: (v: string) => void
}) {
  const [dateFocused, setDateFocused] = useState(false)
  const showDatePlaceholder = !dateOfBirth && !dateFocused
  return (
    <div className="grid grid-cols-3 gap-2 items-end">
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={`${idPrefix}dob`} className="text-xs">
          Date of birth
        </Label>
        <div className="relative">
        <Input
          id={`${idPrefix}dob`}
          type="date"
          value={dateOfBirth}
          onFocus={() => setDateFocused(true)}
          onBlur={() => setDateFocused(false)}
          onChange={(e) => onDateOfBirthChange(e.target.value)}
          required
          className={cn('px-2 text-xs', showDatePlaceholder && '[&::-webkit-datetime-edit]:opacity-0 [&::-webkit-date-and-time-value]:opacity-0')}
        />
        {/* Safari paints today's date even when the native input value is empty. */}
        {showDatePlaceholder && <span aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">dd/mm/yyyy</span>}
        </div>
      </div>
      <div className="min-w-0 space-y-1.5">
        <Label className="text-xs">Gender</Label>
        <GenderSelect value={gender} onChange={onGenderChange} compact />
      </div>
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={`${idPrefix}pincode`} className="text-xs">
          Pincode
        </Label>
        <Input
          id={`${idPrefix}pincode`}
          placeholder="110001"
          value={pincode}
          onChange={(e) => onPincodeChange(e.target.value.toUpperCase())}
          required
          maxLength={12}
          autoComplete="postal-code"
          className="px-2 text-xs"
        />
      </div>
    </div>
  )
}
