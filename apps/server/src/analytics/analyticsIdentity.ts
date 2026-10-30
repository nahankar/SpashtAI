import { prisma } from '../lib/prisma'
import { type LearnerSummary, resolveLearner, resolveLearnerByEmail } from './learnerReport'

/**
 * Binds identity text in an AI Analytics question to a learner account before the model sees it. Emails resolve
 * exactly; a full name resolves only when it names exactly one learner; an explicit admin selection wins. Every bound
 * identity is replaced with a placeholder (LEARNER_1), so the model can reference a learner but never name an id.
 */

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
export const PLACEHOLDER = 'LEARNER_1'

export type IdentityBinding =
  | { status: 'bound'; text: string; learner: LearnerSummary | null }
  | { status: 'no_match'; reason: string }
  | { status: 'choose_learner'; reason: string; candidates: LearnerSummary[] }
  | { status: 'unsupported'; reason: string }

type NameRow = { id: string; full: string }

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Replace each identity string (email or full name) with the placeholder, case-insensitively and on word bounds. */
export function replaceIdentity(text: string, identities: string[], replacement = PLACEHOLDER) {
  let out = text
  for (const value of identities.filter(Boolean).sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`(?<![\\p{L}0-9@.])${escapeRegExp(value)}(?![\\p{L}0-9])`, 'giu'), replacement)
  }
  return out
}

/** Two- and three-word phrases of the question, lowercased, that could be a learner's full name. */
export function namePhrases(text: string) {
  const words = text.replace(EMAIL, ' ').match(/[\p{L}][\p{L}'.-]*/gu) ?? []
  const phrases = new Set<string>()
  for (let i = 0; i < words.length; i++) {
    for (const size of [2, 3]) {
      if (i + size <= words.length) phrases.add(words.slice(i, i + size).join(' ').toLowerCase())
    }
  }
  return [...phrases].slice(0, 400)
}

async function learnersNamed(phrases: string[]) {
  if (!phrases.length) return []
  return prisma.$queryRaw<NameRow[]>`
    SELECT u.id, lower(trim(COALESCE(u."firstName", '') || ' ' || COALESCE(u."lastName", ''))) AS full
    FROM "User" u
    WHERE u.role = 'USER' AND lower(trim(COALESCE(u."firstName", '') || ' ' || COALESCE(u."lastName", ''))) = ANY(${phrases})
    LIMIT 25`
}

export async function bindLearnerIdentity(question: string, selectedLearnerId?: string | null): Promise<IdentityBinding> {
  const emails = [...new Set((question.match(EMAIL) ?? []).map((email) => email.toLowerCase()))]
  const bound = new Map<string, LearnerSummary>()
  const identityText: string[] = []

  if (selectedLearnerId) {
    const selected = await resolveLearner(selectedLearnerId)
    if (!selected) return { status: 'no_match', reason: 'The selected learner account was not found.' }
    bound.set(selected.id, selected)
    identityText.push(selected.email, selected.name)
  }
  for (const email of emails) {
    const learner = await resolveLearnerByEmail(email)
    // Unknown emails stop here: the address is never sent to the model.
    if (!learner) return { status: 'no_match', reason: 'No learner account matches that email address.' }
    bound.set(learner.id, learner)
    identityText.push(email, learner.name)
  }

  const named = await learnersNamed(namePhrases(question))
  const byName = new Map<string, string[]>()
  for (const row of named) byName.set(row.full, [...(byName.get(row.full) ?? []), row.id])
  for (const [name, ids] of byName) {
    if (ids.some((id) => bound.has(id))) { identityText.push(name); continue }
    // An email or explicit selection already identifies the learner; other name-like phrases are not identities.
    if (emails.length || selectedLearnerId) continue
    if (ids.length > 1) {
      const candidates = (await Promise.all(ids.map((id) => resolveLearner(id)))).filter((l): l is LearnerSummary => Boolean(l))
      return { status: 'choose_learner', reason: `${ids.length} learners share that name. Choose one, or ask again with their email.`, candidates }
    }
    const learner = await resolveLearner(ids[0])
    if (learner) { bound.set(learner.id, learner); identityText.push(name) }
  }

  if (bound.size > 1) return { status: 'unsupported', reason: 'Individual reports cover one learner at a time.' }
  const learner = bound.size ? [...bound.values()][0] : null
  return { status: 'bound', text: learner ? replaceIdentity(question, identityText) : question, learner }
}

/** The question as stored in saved-query history: bound identity text replaced with a neutral marker. */
export function redactQuestion(question: string, learner: LearnerSummary | null) {
  const emails = question.match(EMAIL) ?? []
  return replaceIdentity(question, [...emails, ...(learner ? [learner.email, learner.name] : [])], '[learner]')
}
