/** Remove model chain-of-thought tags from displayed / stored coach text. */
export function stripThinkingBlocks(text: string): string {
  if (!text) return ''
  return text
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<thinking>[\s\S]*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}
