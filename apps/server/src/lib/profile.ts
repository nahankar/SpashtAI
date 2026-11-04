import type { Gender } from '@prisma/client'
import { areRewardPointsEnabled } from './platformSettings'
import { resolvePincodeLocation, isValidPincodeFormat, isValidPhone } from './pincode'

export const PROFILE_GENDERS: Gender[] = ['MALE', 'FEMALE']

export function isProfileComplete(user: {
  phone?: string | null
  dateOfBirth?: Date | null
  gender?: Gender | null
  pincode?: string | null
}): boolean {
  return Boolean(user.phone && user.dateOfBirth && user.gender && user.pincode)
}

/** Google sign-ups must finish phone/DOB/gender/pincode; legacy email users are grandfathered. */
export function needsProfileCompletion(user: {
  googleId?: string | null
  phone?: string | null
  dateOfBirth?: Date | null
  gender?: Gender | null
  pincode?: string | null
}): boolean {
  if (isProfileComplete(user)) return false
  return Boolean(user.googleId)
}

export function validateProfileFields(body: {
  phone?: string
  dateOfBirth?: string
  gender?: string
  pincode?: string
}): { error?: string; data?: { phone: string; dateOfBirth: Date; gender: Gender; pincode: string; city: string | null; state: string | null; country: string | null } } {
  const { phone, dateOfBirth, gender, pincode } = body

  if (!phone || !dateOfBirth || !gender || !pincode) {
    return { error: 'Phone, date of birth, gender, and pincode are required' }
  }

  if (!isValidPhone(phone)) {
    return { error: 'Please enter a valid phone number (10–15 digits)' }
  }

  if (!isValidPincodeFormat(pincode)) {
    return { error: 'Please enter a valid pincode or postal code' }
  }

  if (!PROFILE_GENDERS.includes(gender as Gender)) {
    return { error: 'Please select Male or Female' }
  }

  const dob = new Date(dateOfBirth)
  if (Number.isNaN(dob.getTime())) {
    return { error: 'Please enter a valid date of birth' }
  }

  return {
    data: {
      phone: phone.replace(/\D/g, ''),
      dateOfBirth: dob,
      gender: gender as Gender,
      pincode: pincode.trim().toUpperCase(),
      city: null,
      state: null,
      country: null,
    },
  }
}

export type SignupProfile = NonNullable<ReturnType<typeof validateProfileFields>['data']>

/** Missing profile is allowed for existing-account sign-in. A new account must send every field. */
export function readSignupProfile(body: unknown): { ok: true; data: SignupProfile | null } | { ok: false; error: string } {
  const source = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const provided = ['phone', 'dateOfBirth', 'gender', 'pincode'].some((key) => {
    const value = source[key]
    return value != null && String(value).trim() !== ''
  })
  if (!provided) return { ok: true, data: null }
  const result = validateProfileFields({
    phone: String(source.phone ?? ''),
    dateOfBirth: String(source.dateOfBirth ?? ''),
    gender: String(source.gender ?? ''),
    pincode: String(source.pincode ?? ''),
  })
  if (result.error || !result.data) return { ok: false, error: result.error || 'Phone, date of birth, gender, and pincode are required' }
  return { ok: true, data: result.data }
}

export async function resolveProfileLocation(pincode: string) {
  return resolvePincodeLocation(pincode)
}

export function mergeResolvedLocation(
  incoming: { city: string | null; state: string | null; country: string | null },
  lookedUp: { city: string | null; state: string | null; country: string | null },
  existing?: { city?: string | null; state?: string | null; country?: string | null } | null,
) {
  return {
    city: lookedUp.city ?? existing?.city ?? incoming.city,
    state: lookedUp.state ?? existing?.state ?? incoming.state,
    country: lookedUp.country ?? existing?.country ?? incoming.country,
  }
}

/** External pincode lookup. Call this before any locked signup/acceptance transaction. */
export async function attachSignupLocation(profile: SignupProfile, existing?: { city?: string | null; state?: string | null; country?: string | null } | null): Promise<SignupProfile> {
  const lookedUp = await resolveProfileLocation(profile.pincode)
  return { ...profile, ...mergeResolvedLocation(profile, lookedUp, existing) }
}

export function toAuthUser(user: {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  avatar: string | null
  role: string
  emailVerified?: boolean
  lastLoginAt?: Date | null
  createdAt?: Date
  rewardPoints?: number
  googleId?: string | null
  phone?: string | null
  dateOfBirth?: Date | null
  gender?: Gender | null
  pincode?: string | null
  speakerAliases?: string[]
  hideTranscriptText?: boolean
  hideTranscriptJsonExport?: boolean
  hideAudioDownload?: boolean
  enableTxtExport?: boolean
  enableJsonExport?: boolean
  enableAudioExport?: boolean
  enableReplayAudioUpload?: boolean
  enableReprocess?: boolean
  enablePro?: boolean
  enableUltra?: boolean
}) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    avatar: user.avatar,
    role: user.role,
    emailVerified: user.emailVerified ?? false,
    lastLoginAt: user.lastLoginAt ?? null,
    createdAt: user.createdAt,
    rewardPoints: user.rewardPoints,
    speakerAliases: user.speakerAliases ?? [],
    profileComplete: isProfileComplete(user),
    needsProfileCompletion: needsProfileCompletion(user),
    hideTranscriptText: user.hideTranscriptText ?? false,
    hideTranscriptJsonExport: user.hideTranscriptJsonExport ?? false,
    hideAudioDownload: user.hideAudioDownload ?? false,
    enableTxtExport: user.enableTxtExport ?? false,
    enableJsonExport: user.enableJsonExport ?? false,
    enableAudioExport: user.enableAudioExport ?? false,
    enableReplayAudioUpload: user.enableReplayAudioUpload ?? false,
    enableReprocess: user.enableReprocess ?? false,
    enablePro: user.enablePro ?? true,
    enableUltra: user.enableUltra ?? true,
  }
}

/** Hide the points balance unless an admin has turned the points system on. */
export async function authUserForClient(user: Parameters<typeof toAuthUser>[0]) {
  const presented = toAuthUser(user)
  if (await areRewardPointsEnabled()) return presented
  const { rewardPoints: _rewardPoints, ...withoutPoints } = presented
  return withoutPoints
}
