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
}: {
  dateOfBirth: string
  onDateOfBirthChange: (v: string) => void
  gender: ProfileGender
  onGenderChange: (g: 'MALE' | 'FEMALE') => void
  pincode: string
  onPincodeChange: (v: string) => void
}) {
  return (
    <div className="grid grid-cols-3 gap-2 items-end">
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor="dob" className="text-xs">
          Date of birth
        </Label>
        <Input
          id="dob"
          type="date"
          value={dateOfBirth}
          onChange={(e) => onDateOfBirthChange(e.target.value)}
          required
          className="px-2 text-xs"
        />
      </div>
      <div className="min-w-0 space-y-1.5">
        <Label className="text-xs">Gender</Label>
        <GenderSelect value={gender} onChange={onGenderChange} compact />
      </div>
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor="pincode" className="text-xs">
          Pincode
        </Label>
        <Input
          id="pincode"
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
