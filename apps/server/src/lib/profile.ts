import type { Gender } from '@prisma/client'
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

export async function resolveProfileLocation(pincode: string) {
  return resolvePincodeLocation(pincode)
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
  hideTranscriptText?: boolean
  hideTranscriptJsonExport?: boolean
  hideAudioDownload?: boolean
  enableTxtExport?: boolean
  enableJsonExport?: boolean
  enableAudioExport?: boolean
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
    profileComplete: isProfileComplete(user),
    needsProfileCompletion: needsProfileCompletion(user),
    hideTranscriptText: user.hideTranscriptText ?? false,
    hideTranscriptJsonExport: user.hideTranscriptJsonExport ?? false,
    hideAudioDownload: user.hideAudioDownload ?? false,
    enableTxtExport: user.enableTxtExport ?? false,
    enableJsonExport: user.enableJsonExport ?? false,
    enableAudioExport: user.enableAudioExport ?? false,
    enableReprocess: user.enableReprocess ?? false,
    enablePro: user.enablePro ?? false,
    enableUltra: user.enableUltra ?? false,
  }
}
