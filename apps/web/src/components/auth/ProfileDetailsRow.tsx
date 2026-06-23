import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type ProfileGender = 'MALE' | 'FEMALE' | ''

export function GenderToggle({
  value,
  onChange,
}: {
  value: ProfileGender
  onChange: (gender: 'MALE' | 'FEMALE') => void
}) {
  const isFemale = value === 'FEMALE'
  const isMale = value === 'MALE'

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isFemale}
      aria-label="Gender"
      onClick={() => onChange(isFemale ? 'MALE' : 'FEMALE')}
      className={cn(
        'relative h-9 w-[4.25rem] shrink-0 rounded-full border transition-colors',
        value ? 'border-primary/40 bg-primary/5' : 'border-input bg-muted/40',
      )}
    >
      <span className="absolute inset-0 flex items-center justify-between px-2.5 text-[11px] font-semibold">
        <span className={isMale ? 'text-primary' : 'text-muted-foreground'}>M</span>
        <span className={isFemale ? 'text-primary' : 'text-muted-foreground'}>F</span>
      </span>
      <span
        className={cn(
          'absolute top-0.5 left-0.5 h-8 w-8 rounded-full bg-background shadow-sm transition-transform',
          isFemale && 'translate-x-[1.85rem]',
          !value && 'opacity-60',
        )}
      />
    </button>
  )
}

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
      <div className="space-y-1.5 min-w-0">
        <Label htmlFor="dob" className="text-xs">
          Date of birth
        </Label>
        <Input
          id="dob"
          type="date"
          value={dateOfBirth}
          onChange={(e) => onDateOfBirthChange(e.target.value)}
          required
          className="text-xs px-2"
        />
      </div>
      <div className="space-y-1.5 flex flex-col items-center">
        <Label className="text-xs">Gender</Label>
        <GenderToggle value={gender} onChange={onGenderChange} />
      </div>
      <div className="space-y-1.5 min-w-0">
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
          className="text-xs px-2"
        />
      </div>
    </div>
  )
}
