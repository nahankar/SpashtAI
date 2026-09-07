const BULLET_PREFIX = /^(?:[-*•–—]+|\d+[.)])\s*/

export const MAX_QUESTIONS_PER_LOG = 40
export const MAX_QUESTIONS_PER_JOURNEY = 200
export const MAX_QUESTION_TEXT = 2_000

export function parseInterviewQuestions(text: string | null | undefined): string[] {
  if (!text) return []
  const seen = new Set<string>()
  const questions: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim()
    if (!line) continue
    line = line.replace(BULLET_PREFIX, '').trim()
    if (!line) continue
    if (line.length > MAX_QUESTION_TEXT) {
      line = line.slice(0, MAX_QUESTION_TEXT)
    }
    const key = line.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    questions.push(line)
    if (questions.length >= MAX_QUESTIONS_PER_LOG) break
  }
  return questions
}

export function uniqueNewQuestions(incoming: string[], existing: string[]): string[] {
  const seen = new Set(existing.map((text) => text.trim().toLowerCase()).filter(Boolean))
  const fresh: string[] = []
  for (const question of incoming) {
    const key = question.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    fresh.push(question)
  }
  return fresh
}
