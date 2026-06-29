import jsPDF from 'jspdf'

export interface SessionReport {
  title: string
  subtitle: string
  source: 'replay' | 'elevate'
  metadata: { label: string; value: string }[]
  /** Short narrative: how the conversation went + where the user stands on Progress Pulse. */
  summary?: string | null
  overallScore?: number | null
  skillScores?: {
    scores: Record<string, number | null>
    components?: Record<string, Record<string, number>>
  } | null
  coachingInsights?: {
    topStrength?: string
    primaryImprovement?: string
    actionableAdvice?: string
    practiceExercise?: string
    practicePlan?: { title: string; description: string; focusSkill: string }[]
    overallNarrative?: string
    decisionClarity?: { decisionsDetected: number; actionItemsDetected: number; decisions?: string[]; actionItems?: string[]; summary: string }
    meetingSummary?: { topicsDiscussed: string[]; keyOutcomes: string[]; openQuestions: string[] } | null
    error?: string
  } | null
  meetingImpact?: {
    score: number
    label: string
    decisionScore: number
    participationScore: number
    engagementScore: number
  } | null
  legacyScores?: { label: string; score: number }[]
  metrics?: {
    section: string
    description?: string
    items: {
      label: string
      value: string
      unit?: string
      /** Verdict tone — colors the value + optional bar to match the on-screen badges. */
      tone?: 'good' | 'ok' | 'bad'
      /** 0–10 score; when present a progress bar is drawn under the value. */
      score?: number
      /** Short "good / how to improve" line under the metric. */
      hint?: string
    }[]
  }[]
  paceTrend?: { points: { label: string | number; wpm: number }[]; idealMin?: number; idealMax?: number } | null
  progressPulse?: { skill: string; label: string; currentScore: number; delta?: number | null }[] | null
  /** Recommended practice sessions with deep links into Elevate. */
  nextSteps?: { title: string; description: string; url: string }[] | null
  contextSpecificFeedback?: { label: string; detail: string; rating?: string }[]
  keyMoments?: { text: string; type: string }[]
  strengths?: { point: string; example?: string }[]
  improvements?: { point: string; suggestion?: string }[]
  recommendations?: string[]
  transcript?: string
  structuredTranscript?: { speaker: string; text: string }[]
}

const COLORS = {
  primary: [34, 54, 90] as [number, number, number],
  accent: [59, 130, 246] as [number, number, number],
  green: [34, 197, 94] as [number, number, number],
  amber: [245, 158, 11] as [number, number, number],
  red: [239, 68, 68] as [number, number, number],
  gray: [107, 114, 128] as [number, number, number],
  lightGray: [243, 244, 246] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  text: [17, 24, 39] as [number, number, number],
  muted: [107, 114, 128] as [number, number, number],
}

function scoreColor(score: number): [number, number, number] {
  if (score >= 8) return COLORS.green
  if (score >= 6) return COLORS.accent
  if (score >= 4) return COLORS.amber
  return COLORS.red
}

function toneColor(tone?: 'good' | 'ok' | 'bad'): [number, number, number] {
  if (tone === 'good') return COLORS.green
  if (tone === 'ok') return COLORS.amber
  if (tone === 'bad') return COLORS.red
  return COLORS.text
}

function toneLabel(tone?: 'good' | 'ok' | 'bad'): string | null {
  if (tone === 'good') return 'Good'
  if (tone === 'ok') return 'OK'
  if (tone === 'bad') return 'Needs work'
  return null
}

/**
 * Pace-variation line chart drawn with jsPDF primitives so the PDF matches the
 * on-screen green chart (ideal band shaded, average dashed line, WPM per turn).
 */
function drawPaceChart(
  doc: jsPDF,
  points: { label: string | number; wpm: number }[],
  x: number,
  y: number,
  w: number,
  h: number,
  idealMin = 120,
  idealMax = 160,
): void {
  const wpms = points.map((p) => p.wpm).filter((v) => Number.isFinite(v) && v > 0)
  if (wpms.length < 2) return
  const avg = wpms.reduce((s, v) => s + v, 0) / wpms.length
  const dataMax = Math.max(...wpms)
  const dataMin = Math.min(...wpms)
  const yMax = Math.max(200, Math.ceil((dataMax + 20) / 20) * 20)
  const yMin = Math.max(0, Math.min(60, Math.floor((dataMin - 20) / 20) * 20))
  const range = yMax - yMin || 1

  const padL = 12
  const innerX = x + padL
  const innerW = w - padL - 2
  const innerY = y
  const innerH = h
  const px = (i: number) => innerX + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW)
  const py = (v: number) => innerY + innerH - ((Math.max(yMin, Math.min(yMax, v)) - yMin) / range) * innerH

  // Ideal band
  const bandTop = py(Math.min(idealMax, yMax))
  const bandBottom = py(Math.max(idealMin, yMin))
  doc.setFillColor(220, 245, 228)
  doc.rect(innerX, bandTop, innerW, Math.max(0, bandBottom - bandTop), 'F')

  // Y labels + faint gridlines
  const gridVals = [yMin, idealMin, idealMax, yMax].filter((v, i, a) => a.indexOf(v) === i)
  doc.setFontSize(6)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...COLORS.muted)
  for (const v of gridVals) {
    doc.text(String(v), x + padL - 2, py(v) + 1.5, { align: 'right' })
  }

  // Average dashed line
  doc.setDrawColor(120, 130, 145)
  doc.setLineWidth(0.3)
  doc.setLineDashPattern([1, 1], 0)
  doc.line(innerX, py(avg), innerX + innerW, py(avg))
  doc.setLineDashPattern([], 0)

  // Pace polyline
  doc.setDrawColor(...COLORS.green)
  doc.setLineWidth(0.8)
  for (let i = 1; i < points.length; i++) {
    doc.line(px(i - 1), py(points[i - 1].wpm), px(i), py(points[i].wpm))
  }
  doc.setFillColor(...COLORS.green)
  for (let i = 0; i < points.length; i++) {
    doc.circle(px(i), py(points[i].wpm), 0.7, 'F')
  }

  // Legend
  const legendY = y + h + 5
  doc.setFontSize(7)
  doc.setTextColor(...COLORS.muted)
  doc.setDrawColor(...COLORS.green)
  doc.setLineWidth(0.8)
  doc.line(x, legendY - 1, x + 6, legendY - 1)
  doc.text('Your pace', x + 8, legendY)
  doc.setFillColor(220, 245, 228)
  doc.rect(x + 32, legendY - 2.5, 6, 2.5, 'F')
  doc.text(`Ideal ${idealMin}-${idealMax} WPM`, x + 40, legendY)
  doc.setDrawColor(120, 130, 145)
  doc.setLineDashPattern([1, 1], 0)
  doc.line(x + 92, legendY - 1, x + 98, legendY - 1)
  doc.setLineDashPattern([], 0)
  doc.text(`Average ${Math.round(avg)} WPM`, x + 100, legendY)
}

const SKILL_LABELS: Record<string, string> = {
  clarity: 'Clarity',
  conciseness: 'Conciseness',
  confidence: 'Confidence',
  structure: 'Structure',
  engagement: 'Engagement',
  pacing: 'Pacing',
  delivery: 'Delivery',
  emotionalControl: 'Emotional Control',
}

const PAGE_W = 210
const PAGE_H = 297
const MARGIN = 18
const CONTENT_W = PAGE_W - MARGIN * 2

// Content on pages 2+ must clear the running header (rule at y≈13.5).
const CONTENT_TOP = 22

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > PAGE_H - MARGIN) {
    doc.addPage()
    return CONTENT_TOP
  }
  return y
}

// Vertical breathing room added above every section so sections don't crowd
// each other.
const SECTION_GAP = 9

// Auto-incrementing top-level section number (Gartner-style "1. …, 2. …").
// Reset at the start of every report.
let sectionNumber = 0

function drawSectionTitle(doc: jsPDF, title: string, y: number): number {
  y += SECTION_GAP
  y = ensureSpace(doc, y, 16)
  sectionNumber += 1
  const heading = `${sectionNumber}.  ${title}`
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...COLORS.primary)
  doc.text(heading, MARGIN, y)
  y += 2.5
  doc.setDrawColor(...COLORS.accent)
  doc.setLineWidth(0.6)
  doc.line(MARGIN, y, MARGIN + CONTENT_W, y)
  return y + 7
}

/** A muted, wrapped intro line shown directly under a section title. */
function drawSectionIntro(doc: jsPDF, text: string, y: number): number {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...COLORS.muted)
  y = drawWrappedText(doc, text, MARGIN, y, CONTENT_W, 4.5)
  return y + 3
}

/** Truncate a string to fit a max width at the current font, adding an ellipsis. */
function truncateToWidth(doc: jsPDF, text: string, maxWidth: number): string {
  if (doc.getTextWidth(text) <= maxWidth) return text
  let t = text
  while (t.length > 1 && doc.getTextWidth(`${t}\u2026`) > maxWidth) {
    t = t.slice(0, -1)
  }
  return `${t.trim()}\u2026`
}

/** Running header on every content page (page 2+): brand left, report title right. */
function drawRunningHeader(doc: jsPDF, title: string): void {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...COLORS.primary)
  doc.text('SpashtAI', MARGIN, 11)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...COLORS.muted)
  const right = truncateToWidth(doc, title, CONTENT_W - 30)
  doc.text(right, PAGE_W - MARGIN, 11, { align: 'right' })

  doc.setDrawColor(...COLORS.accent)
  doc.setLineWidth(0.4)
  doc.line(MARGIN, 13.5, PAGE_W - MARGIN, 13.5)
}

/** Standardized footer on every page: confidentiality left, page number right. */
function drawFooter(doc: jsPDF, pageNo: number, pageCount: number): void {
  doc.setDrawColor(...COLORS.lightGray)
  doc.setLineWidth(0.4)
  doc.line(MARGIN, PAGE_H - 12, PAGE_W - MARGIN, PAGE_H - 12)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...COLORS.muted)
  doc.text('SpashtAI · Communication Session Report · Confidential', MARGIN, PAGE_H - 7.5)
  doc.text(`Page ${pageNo} of ${pageCount}`, PAGE_W - MARGIN, PAGE_H - 7.5, { align: 'right' })
}

function drawWrappedText(doc: jsPDF, text: string, x: number, y: number, maxWidth: number, lineHeight: number): number {
  const lines = doc.splitTextToSize(text, maxWidth)
  for (const line of lines) {
    y = ensureSpace(doc, y, lineHeight)
    doc.text(line, x, y)
    y += lineHeight
  }
  return y
}

export async function generateSessionPdf(report: SessionReport): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  sectionNumber = 0
  let y = MARGIN

  // ── Page 1: Cover ──────────────────────────────────────────────────────
  // Top brand band with a thin accent stripe underneath.
  doc.setFillColor(...COLORS.primary)
  doc.rect(0, 0, PAGE_W, 60, 'F')
  doc.setFillColor(...COLORS.accent)
  doc.rect(0, 60, PAGE_W, 1.5, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(26)
  doc.setTextColor(...COLORS.white)
  doc.text('SpashtAI', MARGIN, 28)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(12)
  doc.text('Communication Session Report', MARGIN, 39)

  // "CONFIDENTIAL" tag, top-right of the band.
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(220, 228, 240)
  doc.text('C O N F I D E N T I A L', PAGE_W - MARGIN, 20, { align: 'right' })

  // Title block (lower third of the cover).
  y = 110
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(24)
  doc.setTextColor(...COLORS.text)
  const titleLines = doc.splitTextToSize(report.title || 'Untitled Session', CONTENT_W)
  for (const line of titleLines.slice(0, 3)) {
    doc.text(line, MARGIN, y)
    y += 11
  }

  if (report.subtitle) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(12)
    doc.setTextColor(...COLORS.muted)
    doc.text(report.subtitle, MARGIN, y)
    y += 8
  }

  // Accent rule under the title.
  doc.setDrawColor(...COLORS.accent)
  doc.setLineWidth(0.8)
  doc.line(MARGIN, y, MARGIN + 60, y)
  y += 12

  // Metadata table.
  doc.setFontSize(10)
  for (const m of report.metadata) {
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...COLORS.muted)
    doc.text(`${m.label}`, MARGIN, y)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...COLORS.text)
    doc.text(truncateToWidth(doc, m.value, CONTENT_W - 42), MARGIN + 42, y)
    y += 6.5
  }

  // Overall Score badge.
  if (report.overallScore != null) {
    y += 8
    doc.setFillColor(...COLORS.lightGray)
    doc.roundedRect(MARGIN, y - 5, CONTENT_W, 26, 3, 3, 'F')
    doc.setFillColor(...scoreColor(report.overallScore))
    doc.roundedRect(MARGIN, y - 5, 2, 26, 1, 1, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...COLORS.muted)
    doc.text('Overall Communication Score', MARGIN + 8, y + 3)
    doc.setFontSize(30)
    doc.setTextColor(...scoreColor(report.overallScore))
    doc.text(`${report.overallScore.toFixed(1)}`, MARGIN + 8, y + 17)
    doc.setFontSize(11)
    doc.setTextColor(...COLORS.muted)
    doc.text('/ 10', MARGIN + 34, y + 17)
    y += 30
  }

  // ── Content starts on a fresh page (keeps the cover clean & standardized) ──
  doc.addPage()
  y = CONTENT_TOP

  // Summary — how the conversation went + where they stand on Progress Pulse
  if (report.summary) {
    y = drawSectionTitle(doc, 'Summary', y)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(...COLORS.text)
    y = drawWrappedText(doc, report.summary, MARGIN, y, CONTENT_W, 5)
    y += 4
  }

  // Skill Scores
  if (report.skillScores?.scores) {
    y = drawSectionTitle(doc, 'Skill Scores', y)
    y = drawSectionIntro(
      doc,
      'How you performed across the core communication skills this session, each rated 0\u201310. Longer, greener bars are stronger.',
      y,
    )
    const scores = report.skillScores.scores
    for (const [key, label] of Object.entries(SKILL_LABELS)) {
      const val = scores[key]
      if (val == null) continue
      y = ensureSpace(doc, y, 10)

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(...COLORS.text)
      doc.text(label, MARGIN, y)

      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...scoreColor(val))
      doc.text(val.toFixed(1), MARGIN + 42, y)

      const barX = MARGIN + 52
      const barW = CONTENT_W - 52
      doc.setFillColor(...COLORS.lightGray)
      doc.roundedRect(barX, y - 3, barW, 4, 1.5, 1.5, 'F')
      doc.setFillColor(...scoreColor(val))
      doc.roundedRect(barX, y - 3, barW * (val / 10), 4, 1.5, 1.5, 'F')

      y += 8
    }
  }

  // Legacy Scores
  if (report.legacyScores?.length) {
    y = drawSectionTitle(doc, 'Assessment Scores', y + 2)
    for (const s of report.legacyScores) {
      y = ensureSpace(doc, y, 10)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(...COLORS.text)
      doc.text(s.label, MARGIN, y)

      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...scoreColor(s.score))
      doc.text(s.score.toFixed(1), MARGIN + 42, y)

      const barX = MARGIN + 52
      const barW = CONTENT_W - 52
      doc.setFillColor(...COLORS.lightGray)
      doc.roundedRect(barX, y - 3, barW, 4, 1.5, 1.5, 'F')
      doc.setFillColor(...scoreColor(s.score))
      doc.roundedRect(barX, y - 3, barW * (s.score / 10), 4, 1.5, 1.5, 'F')

      y += 8
    }
  }

  // ── Page 2: Coaching Insights ──
  if (report.coachingInsights && !report.coachingInsights.error) {
    doc.addPage()
    y = CONTENT_TOP
    y = drawSectionTitle(doc, 'Coaching Insights', y)
    y = drawSectionIntro(
      doc,
      'Personalized feedback from your session \u2014 what worked, the single biggest thing to focus on next, and how to practice it.',
      y,
    )

    const ci = report.coachingInsights
    const blocks: { title: string; text: string; color: [number, number, number] }[] = []
    if (ci.overallNarrative) blocks.push({ title: 'Overall', text: ci.overallNarrative, color: COLORS.primary })
    if (ci.topStrength) blocks.push({ title: 'Top Strength', text: ci.topStrength, color: COLORS.green })
    if (ci.primaryImprovement) blocks.push({ title: 'Focus Area', text: ci.primaryImprovement, color: COLORS.amber })
    if (ci.actionableAdvice) blocks.push({ title: 'Actionable Advice', text: ci.actionableAdvice, color: COLORS.accent })
    if (ci.practiceExercise) blocks.push({ title: 'Practice Exercise', text: ci.practiceExercise, color: COLORS.accent })

    for (const b of blocks) {
      y = ensureSpace(doc, y, 20)
      doc.setDrawColor(...b.color)
      doc.setLineWidth(0.8)
      doc.line(MARGIN, y - 2, MARGIN, y + 10)

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      doc.setTextColor(...b.color)
      doc.text(b.title, MARGIN + 3, y)
      y += 5

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(...COLORS.text)
      y = drawWrappedText(doc, b.text, MARGIN + 3, y, CONTENT_W - 6, 4.5)
      y += 4
    }

    if (ci.practicePlan?.length) {
      y = ensureSpace(doc, y, 20)
      y = drawSectionTitle(doc, 'Practice Plan', y)
      for (let i = 0; i < ci.practicePlan.length; i++) {
        const ex = ci.practicePlan[i]
        y = ensureSpace(doc, y, 16)
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(9)
        doc.setTextColor(...COLORS.accent)
        doc.text(`${i + 1}. ${ex.title}`, MARGIN + 3, y)
        y += 4.5
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8.5)
        doc.setTextColor(...COLORS.text)
        y = drawWrappedText(doc, ex.description, MARGIN + 3, y, CONTENT_W - 8, 4)
        if (ex.focusSkill) {
          doc.setFont('helvetica', 'italic')
          doc.setFontSize(7.5)
          doc.setTextColor(...COLORS.muted)
          doc.text(`Focus: ${ex.focusSkill}`, MARGIN + 3, y)
          y += 4
        }
        y += 3
      }
    }

    if (ci.decisionClarity) {
      y = ensureSpace(doc, y, 18)
      y = drawSectionTitle(doc, 'Meeting Effectiveness', y)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(...COLORS.text)
      y = drawWrappedText(doc, ci.decisionClarity.summary, MARGIN, y, CONTENT_W, 4.5)
      y += 3
      doc.text(`Decisions: ${ci.decisionClarity.decisionsDetected}   |   Action items: ${ci.decisionClarity.actionItemsDetected}`, MARGIN, y)
      y += 6

      if (ci.decisionClarity.decisions?.length) {
        for (const d of ci.decisionClarity.decisions) {
          y = ensureSpace(doc, y, 6)
          doc.setFillColor(...COLORS.green)
          doc.circle(MARGIN + 2, y - 1, 1, 'F')
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(8)
          doc.setTextColor(...COLORS.text)
          y = drawWrappedText(doc, d, MARGIN + 5, y, CONTENT_W - 8, 3.8)
          y += 1.5
        }
        y += 2
      }
      if (ci.decisionClarity.actionItems?.length) {
        for (const a of ci.decisionClarity.actionItems) {
          y = ensureSpace(doc, y, 6)
          doc.setTextColor(...COLORS.accent)
          doc.text('\u2192', MARGIN + 1, y)
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(8)
          doc.setTextColor(...COLORS.text)
          y = drawWrappedText(doc, a, MARGIN + 5, y, CONTENT_W - 8, 3.8)
          y += 1.5
        }
        y += 2
      }
    }

    if (ci.meetingSummary) {
      const ms = ci.meetingSummary
      const hasContent = ms.topicsDiscussed?.length || ms.keyOutcomes?.length || ms.openQuestions?.length
      if (hasContent) {
        y = ensureSpace(doc, y, 20)
        y = drawSectionTitle(doc, 'Meeting Summary', y)

        if (ms.topicsDiscussed?.length) {
          doc.setFont('helvetica', 'bold')
          doc.setFontSize(9)
          doc.setTextColor(...COLORS.muted)
          doc.text('Topics Discussed', MARGIN, y)
          y += 5
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(8.5)
          doc.setTextColor(...COLORS.text)
          for (const t of ms.topicsDiscussed) {
            y = ensureSpace(doc, y, 5)
            doc.text('\u2022', MARGIN + 2, y)
            y = drawWrappedText(doc, t, MARGIN + 6, y, CONTENT_W - 8, 4)
            y += 1
          }
          y += 3
        }
        if (ms.keyOutcomes?.length) {
          doc.setFont('helvetica', 'bold')
          doc.setFontSize(9)
          doc.setTextColor(...COLORS.green)
          doc.text('Key Outcomes', MARGIN, y)
          y += 5
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(8.5)
          doc.setTextColor(...COLORS.text)
          for (const o of ms.keyOutcomes) {
            y = ensureSpace(doc, y, 5)
            doc.setFillColor(...COLORS.green)
            doc.circle(MARGIN + 2, y - 1, 1, 'F')
            y = drawWrappedText(doc, o, MARGIN + 6, y, CONTENT_W - 8, 4)
            y += 1
          }
          y += 3
        }
        if (ms.openQuestions?.length) {
          doc.setFont('helvetica', 'bold')
          doc.setFontSize(9)
          doc.setTextColor(...COLORS.amber)
          doc.text('Open Questions', MARGIN, y)
          y += 5
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(8.5)
          doc.setTextColor(...COLORS.text)
          for (const q of ms.openQuestions) {
            y = ensureSpace(doc, y, 5)
            doc.text('?', MARGIN + 2, y)
            y = drawWrappedText(doc, q, MARGIN + 6, y, CONTENT_W - 8, 4)
            y += 1
          }
          y += 3
        }
      }
    }
  }

  // ── Meeting Impact Score ──
  if (report.meetingImpact) {
    y = ensureSpace(doc, y, 30)
    y = drawSectionTitle(doc, 'Meeting Impact Score', y)
    const mi = report.meetingImpact

    doc.setFillColor(...COLORS.lightGray)
    doc.roundedRect(MARGIN, y - 4, CONTENT_W, 18, 3, 3, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(20)
    doc.setTextColor(...scoreColor(mi.score))
    doc.text(mi.score.toFixed(1), MARGIN + 6, y + 8)
    doc.setFontSize(9)
    doc.setTextColor(...COLORS.muted)
    doc.text(`/ 10  —  ${mi.label}`, MARGIN + 24, y + 8)
    y += 22

    const dims = [
      { label: 'Decision Clarity', score: mi.decisionScore },
      { label: 'Conversation Participation', score: mi.participationScore },
      { label: 'Conversation Engagement', score: mi.engagementScore },
    ]
    for (const d of dims) {
      y = ensureSpace(doc, y, 8)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      doc.setTextColor(...COLORS.text)
      doc.text(d.label, MARGIN, y)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...scoreColor(d.score))
      doc.text(d.score.toFixed(1), MARGIN + 50, y)

      const barX = MARGIN + 58
      const barW = CONTENT_W - 58
      doc.setFillColor(...COLORS.lightGray)
      doc.roundedRect(barX, y - 3, barW, 4, 1.5, 1.5, 'F')
      doc.setFillColor(...scoreColor(d.score))
      doc.roundedRect(barX, y - 3, barW * (d.score / 10), 4, 1.5, 1.5, 'F')
      y += 8
    }
    y += 4
  }

  // ── Context-Specific Feedback (AI Insights) ──
  if (report.contextSpecificFeedback?.length) {
    doc.addPage()
    y = CONTENT_TOP
    y = drawSectionTitle(doc, 'Context-Specific Feedback', y)

    for (const f of report.contextSpecificFeedback) {
      y = ensureSpace(doc, y, 18)

      const ratingColor: [number, number, number] =
        f.rating === 'excellent' ? COLORS.green :
        f.rating === 'good' ? COLORS.accent :
        f.rating === 'needs_work' ? COLORS.amber :
        COLORS.gray

      doc.setDrawColor(...ratingColor)
      doc.setLineWidth(0.7)
      doc.line(MARGIN, y - 2, MARGIN, y + 8)

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(...COLORS.text)
      doc.text(f.label, MARGIN + 3, y)

      if (f.rating) {
        const ratingLabel = f.rating === 'needs_work' ? 'Needs Work' : f.rating.charAt(0).toUpperCase() + f.rating.slice(1)
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7.5)
        doc.setTextColor(...ratingColor)
        doc.text(ratingLabel, MARGIN + CONTENT_W - doc.getTextWidth(ratingLabel), y)
      }

      y += 4.5
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      doc.setTextColor(...COLORS.muted)
      y = drawWrappedText(doc, f.detail, MARGIN + 3, y, CONTENT_W - 8, 4)
      y += 4
    }
  }

  // ── Key Moments ──
  if (report.keyMoments?.length) {
    y = ensureSpace(doc, y, 20)
    y = drawSectionTitle(doc, 'Key Moments', y)

    for (const m of report.keyMoments) {
      y = ensureSpace(doc, y, 8)
      const iconColor: [number, number, number] =
        m.type === 'strength' ? COLORS.green :
        m.type === 'weakness' ? COLORS.red :
        COLORS.accent

      doc.setFillColor(...iconColor)
      doc.circle(MARGIN + 2, y - 1.2, 1.2, 'F')

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      doc.setTextColor(...COLORS.text)
      y = drawWrappedText(doc, m.text, MARGIN + 6, y, CONTENT_W - 8, 4)
      y += 2
    }
    y += 4
  }

  // ── Metrics ──
  if (report.metrics?.length) {
    doc.addPage()
    y = CONTENT_TOP

    for (const section of report.metrics) {
      y = drawSectionTitle(doc, section.section, y)
      if (section.description) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8)
        doc.setTextColor(...COLORS.muted)
        doc.text(section.description, MARGIN, y)
        y += 5
      }

      const colW = CONTENT_W / 3
      // Taller boxes when any item carries a bar or verdict line, so the score
      // bar + "good/how to improve" hint fit without overlapping.
      const rich = section.items.some((it) => it.score != null || it.hint || it.tone)
      const boxH = rich ? 26 : 16
      const rowGap = boxH + 4
      let col = 0

      for (const item of section.items) {
        const x = MARGIN + col * colW
        y = ensureSpace(doc, y, boxH + 4)

        doc.setFillColor(...COLORS.lightGray)
        doc.roundedRect(x, y - 4, colW - 3, boxH, 2, 2, 'F')

        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7.5)
        doc.setTextColor(...COLORS.muted)
        doc.text(item.label, x + 3, y)

        // Value (colored by verdict tone) + unit. Measure the value width while
        // the value font is active so the unit never overlaps it.
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(12)
        doc.setTextColor(...toneColor(item.tone))
        doc.text(item.value, x + 3, y + 7)
        const valueWidth = doc.getTextWidth(item.value)

        if (item.unit) {
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(7)
          doc.setTextColor(...COLORS.muted)
          doc.text(item.unit, x + 3 + valueWidth + 1.5, y + 7)
        }

        let innerY = y + 10
        if (item.score != null) {
          const barX = x + 3
          const barW = colW - 9
          doc.setFillColor(...COLORS.white)
          doc.roundedRect(barX, innerY, barW, 2, 1, 1, 'F')
          doc.setFillColor(...(item.tone ? toneColor(item.tone) : scoreColor(item.score)))
          doc.roundedRect(barX, innerY, barW * Math.max(0, Math.min(1, item.score / 10)), 2, 1, 1, 'F')
          innerY += 4
        }

        const verdictText = toneLabel(item.tone)
        if (verdictText || item.hint) {
          doc.setFontSize(6.5)
          let lineX = x + 3
          if (verdictText) {
            doc.setFont('helvetica', 'bold')
            doc.setTextColor(...toneColor(item.tone))
            doc.text(verdictText, lineX, innerY + 1)
            lineX += doc.getTextWidth(verdictText) + 2
          }
          if (item.hint) {
            doc.setFont('helvetica', 'normal')
            doc.setTextColor(...COLORS.muted)
            const hintLines = doc.splitTextToSize(item.hint, colW - 6 - (lineX - (x + 3)))
            doc.text(hintLines[0], lineX, innerY + 1)
          }
        }

        col++
        if (col >= 3) {
          col = 0
          y += rowGap
        }
      }
      if (col > 0) y += rowGap
      y += 4
    }
  }

  // ── Pace Variation chart ──
  if (report.paceTrend && report.paceTrend.points.length >= 2) {
    y = ensureSpace(doc, y, 56)
    y = drawSectionTitle(doc, 'Pace Variation', y)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...COLORS.muted)
    doc.text('Your speaking speed (WPM) across each of your turns', MARGIN, y)
    y += 4
    drawPaceChart(
      doc,
      report.paceTrend.points,
      MARGIN,
      y,
      CONTENT_W,
      34,
      report.paceTrend.idealMin ?? 120,
      report.paceTrend.idealMax ?? 160,
    )
    y += 34 + 10
  }

  // ── Progress Pulse (cross-session skill trends) ──
  if (report.progressPulse?.length) {
    y = ensureSpace(doc, y, 24)
    y = drawSectionTitle(doc, 'Progress Pulse', y)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...COLORS.muted)
    doc.text('How your skills are trending across your sessions', MARGIN, y)
    y += 6

    for (const p of report.progressPulse) {
      y = ensureSpace(doc, y, 9)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(...COLORS.text)
      doc.text(p.label, MARGIN, y)

      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...scoreColor(p.currentScore))
      doc.text(p.currentScore.toFixed(1), MARGIN + 42, y)

      const barX = MARGIN + 52
      const barW = CONTENT_W - 78
      doc.setFillColor(...COLORS.lightGray)
      doc.roundedRect(barX, y - 3, barW, 4, 1.5, 1.5, 'F')
      doc.setFillColor(...scoreColor(p.currentScore))
      doc.roundedRect(barX, y - 3, barW * (p.currentScore / 10), 4, 1.5, 1.5, 'F')

      if (p.delta != null && Math.abs(p.delta) > 0.05) {
        const up = p.delta > 0
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(8)
        doc.setTextColor(...(up ? COLORS.green : COLORS.red))
        doc.text(`${up ? '\u25B2' : '\u25BC'} ${up ? '+' : ''}${p.delta.toFixed(1)}`, barX + barW + 4, y)
      }
      y += 8
    }
    y += 4
  }

  // ── Strengths / Improvements / Recommendations ──
  const hasList = (report.strengths?.length || 0) + (report.improvements?.length || 0) + (report.recommendations?.length || 0) > 0
  if (hasList) {
    doc.addPage()
    y = CONTENT_TOP

    if (report.strengths?.length) {
      y = drawSectionTitle(doc, 'Strengths', y)
      y = drawSectionIntro(doc, 'What you did well this session \u2014 keep doing these.', y)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(...COLORS.text)
      for (const s of report.strengths) {
        y = ensureSpace(doc, y, 8)
        doc.setFillColor(...COLORS.green)
        doc.circle(MARGIN + 2, y - 1.2, 1.2, 'F')
        y = drawWrappedText(doc, s.point, MARGIN + 6, y, CONTENT_W - 8, 4.5)
        y += 2
      }
      y += 4
    }

    if (report.improvements?.length) {
      y = drawSectionTitle(doc, 'Areas for Improvement', y)
      y = drawSectionIntro(doc, 'The highest-impact things to work on, with a tip for each.', y)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(...COLORS.text)
      for (const imp of report.improvements) {
        y = ensureSpace(doc, y, 8)
        doc.setFillColor(...COLORS.amber)
        doc.circle(MARGIN + 2, y - 1.2, 1.2, 'F')
        y = drawWrappedText(doc, imp.point, MARGIN + 6, y, CONTENT_W - 8, 4.5)
        if (imp.suggestion) {
          doc.setTextColor(...COLORS.muted)
          doc.setFont('helvetica', 'italic')
          y = drawWrappedText(doc, `Tip: ${imp.suggestion}`, MARGIN + 6, y, CONTENT_W - 8, 4.5)
          doc.setFont('helvetica', 'normal')
          doc.setTextColor(...COLORS.text)
        }
        y += 2
      }
      y += 4
    }

    if (report.recommendations?.length) {
      y = drawSectionTitle(doc, 'Recommendations', y)
      y = drawSectionIntro(doc, 'Concrete actions to apply in your next conversation.', y)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(...COLORS.text)
      for (let i = 0; i < report.recommendations.length; i++) {
        y = ensureSpace(doc, y, 8)
        doc.setFont('helvetica', 'bold')
        doc.text(`${i + 1}.`, MARGIN, y)
        doc.setFont('helvetica', 'normal')
        y = drawWrappedText(doc, report.recommendations[i], MARGIN + 6, y, CONTENT_W - 8, 4.5)
        y += 2
      }
    }
  }

  // ── Recommended Next Steps (practice sessions with links to Elevate) ──
  if (report.nextSteps?.length) {
    y = ensureSpace(doc, y, 30)
    y = drawSectionTitle(doc, 'Recommended Next Steps', y + 2)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...COLORS.muted)
    y = drawWrappedText(doc, 'Targeted practice sessions — click any link to start it in SpashtAI Elevate.', MARGIN, y, CONTENT_W, 4.5)
    y += 3

    for (let i = 0; i < report.nextSteps.length; i++) {
      const step = report.nextSteps[i]
      y = ensureSpace(doc, y, 18)

      doc.setDrawColor(...COLORS.accent)
      doc.setLineWidth(0.8)
      doc.line(MARGIN, y - 2, MARGIN, y + 8)

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9.5)
      doc.setTextColor(...COLORS.text)
      doc.text(`${i + 1}. ${step.title}`, MARGIN + 3, y)
      y += 4.5

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      doc.setTextColor(...COLORS.muted)
      y = drawWrappedText(doc, step.description, MARGIN + 3, y, CONTENT_W - 6, 4)

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.setTextColor(...COLORS.accent)
      const linkLabel = 'Start this practice in Elevate \u2192'
      doc.textWithLink(linkLabel, MARGIN + 3, y + 1, { url: step.url })
      // Underline the link for affordance.
      const lw = doc.getTextWidth(linkLabel)
      doc.setDrawColor(...COLORS.accent)
      doc.setLineWidth(0.3)
      doc.line(MARGIN + 3, y + 2, MARGIN + 3 + lw, y + 2)
      y += 7
    }
    y += 4
  }

  // ── Transcript ──
  if (report.structuredTranscript?.length || report.transcript) {
    doc.addPage()
    y = CONTENT_TOP
    y = drawSectionTitle(doc, 'Transcript', y)
    doc.setFontSize(8)

    if (report.structuredTranscript?.length) {
      for (const seg of report.structuredTranscript) {
        y = ensureSpace(doc, y, 10)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(...COLORS.accent)
        doc.text(`${seg.speaker}:`, MARGIN, y)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(...COLORS.text)
        y = drawWrappedText(doc, seg.text, MARGIN + 30, y, CONTENT_W - 32, 3.8)
        y += 2
      }
    } else if (report.transcript) {
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...COLORS.text)
      y = drawWrappedText(doc, report.transcript, MARGIN, y, CONTENT_W, 3.8)
    }
  }

  // ── Header (content pages) + footer (all pages) ──
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    if (i > 1) drawRunningHeader(doc, report.title || 'Communication Session Report')
    drawFooter(doc, i, pageCount)
  }

  const filename = `${report.title?.replace(/[^a-zA-Z0-9]/g, '-') || 'session'}-report.pdf`
  doc.save(filename)
}
