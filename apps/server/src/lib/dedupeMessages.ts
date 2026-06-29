/**
 * Collapse duplicate conversation messages that arise when two writers persist
 * the same turn (historically the agent's conversation_logger AND the browser's
 * addMessage both wrote user turns, producing every user message twice).
 *
 * For each message we look a few entries ahead (same role) and DROP THE LATER
 * copy when it is:
 *   • identical (whitespace-normalized) text — the plain double-write, or
 *   • a "stitched" restatement that begins with this message's text — e.g. the
 *     agent commits a fragment "One of the projects..." and a later writer
 *     re-logs the full "One of the projects... within budget." version.
 *
 * Keeping the EARLIER copy preserves conversational order (the duplicate is
 * usually re-logged after the coach's reply). The proximity window + length
 * guard keep legitimate repeats ("yes" said twice, or an elaboration much later)
 * intact — double-write duplicates are always within a couple of messages.
 */
const PROXIMITY = 4
const PREFIX_MIN_LEN = 20

interface ConvMsg {
  role?: string
  speaker?: string
  content?: string
  text?: string
  [k: string]: any
}

function roleOf(m: ConvMsg): string {
  return (m.role || m.speaker || '').toString()
}

function textOf(m: ConvMsg): string {
  return (m.content ?? m.text ?? '').toString().replace(/\s+/g, ' ').trim()
}

export function dedupeConversationMessages<T extends ConvMsg>(messages: T[]): T[] {
  if (!Array.isArray(messages) || messages.length < 2) return messages
  const drop = new Set<number>()

  for (let i = 0; i < messages.length; i++) {
    if (drop.has(i)) continue
    const ri = roleOf(messages[i])
    const ti = textOf(messages[i])
    if (!ti) continue

    const limit = Math.min(messages.length, i + 1 + PROXIMITY)
    for (let j = i + 1; j < limit; j++) {
      if (drop.has(j)) continue
      if (roleOf(messages[j]) !== ri) continue
      const tj = textOf(messages[j])
      if (!tj) continue
      const isExact = tj === ti
      const isRestatement = ti.length >= PREFIX_MIN_LEN && tj.startsWith(ti)
      if (isExact || isRestatement) {
        drop.add(j) // keep the earlier copy to preserve order
      }
    }
  }

  if (drop.size === 0) return messages
  return messages.filter((_, idx) => !drop.has(idx))
}
