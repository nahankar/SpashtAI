export interface PincodeLocation {
  city: string | null
  state: string | null
  country: string | null
}

/** Resolve city/state/country from a postal pincode or ZIP code. */
export async function resolvePincodeLocation(pincode: string): Promise<PincodeLocation> {
  const code = pincode.trim().toUpperCase()
  if (!code) {
    return { city: null, state: null, country: null }
  }

  // India — 6-digit PIN
  if (/^\d{6}$/.test(code)) {
    try {
      const res = await fetch(`https://api.postalpincode.in/pincode/${code}`, {
        signal: AbortSignal.timeout(5000),
      })
      const data = (await res.json()) as Array<{
        Status: string
        PostOffice?: Array<{ District: string; State: string; Country: string }>
      }>
      if (data[0]?.Status === 'Success' && data[0].PostOffice?.[0]) {
        const po = data[0].PostOffice[0]
        return {
          city: po.District || null,
          state: po.State || null,
          country: po.Country || 'India',
        }
      }
    } catch (err) {
      console.warn('India pincode lookup failed:', err)
    }
    return { city: null, state: null, country: 'India' }
  }

  // US ZIP
  if (/^\d{5}(-\d{4})?$/.test(code)) {
    const zip = code.slice(0, 5)
    try {
      const res = await fetch(`https://api.zippopotam.us/us/${zip}`, {
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) {
        const data = (await res.json()) as {
          country: string
          places?: Array<{ 'place name': string; state: string }>
        }
        const place = data.places?.[0]
        return {
          city: place?.['place name'] || null,
          state: place?.state || null,
          country: data.country || 'United States',
        }
      }
    } catch (err) {
      console.warn('US ZIP lookup failed:', err)
    }
    return { city: null, state: null, country: 'United States' }
  }

  // UK / other — zippopotam (GB, etc.)
  if (/^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i.test(code)) {
    const normalized = code.replace(/\s+/g, '')
    try {
      const res = await fetch(`https://api.zippopotam.us/gb/${encodeURIComponent(normalized)}`, {
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) {
        const data = (await res.json()) as {
          country: string
          places?: Array<{ 'place name': string; state: string }>
        }
        const place = data.places?.[0]
        return {
          city: place?.['place name'] || null,
          state: place?.state || null,
          country: data.country || 'United Kingdom',
        }
      }
    } catch (err) {
      console.warn('UK postcode lookup failed:', err)
    }
  }

  return { city: null, state: null, country: null }
}

export function isValidPincodeFormat(pincode: string): boolean {
  const code = pincode.trim()
  if (code.length < 4 || code.length > 12) return false
  return /^[A-Za-z0-9\s-]+$/.test(code)
}

export function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 15
}
