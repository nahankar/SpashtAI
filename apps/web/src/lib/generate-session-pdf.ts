import jsPDF from 'jspdf'

export interface SessionReport {
  title: string
  subtitle: string
  source: 'replay' | 'elevate'
  metadata: { label: string; value: string }[]
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
  metrics?: { section: string; items: { label: string; value: string; unit?: string }[] }[]
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

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > PAGE_H - MARGIN) {
    doc.addPage()
    return MARGIN
  }
  return y
}

function drawSectionTitle(doc: jsPDF, title: string, y: number): number {
  y = ensureSpace(doc, y, 14)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...COLORS.primary)
  doc.text(title, MARGIN, y)
  y += 2
  doc.setDrawColor(...COLORS.accent)
  doc.setLineWidth(0.6)
  doc.line(MARGIN, y, MARGIN + CONTENT_W, y)
  return y + 8
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
  let y = MARGIN

  // ── Page 1: Cover ──
  doc.setFillColor(...COLORS.primary)
  doc.rect(0, 0, PAGE_W, 52, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(26)
  doc.setTextColor(...COLORS.white)
  doc.text('SpashtAI', MARGIN, 22)

  doc.setFontSize(12)
  doc.setFont('helvetica', 'normal')
  doc.text('Communication Session Report', MARGIN, 32)

  doc.setFontSize(10)
  doc.text(`Generated ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`, MARGIN, 42)

  y = 62

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...COLORS.text)
  doc.text(report.title || 'Untitled Session', MARGIN, y)
  y += 8

  if (report.subtitle) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    doc.setTextColor(...COLORS.muted)
    doc.text(report.subtitle, MARGIN, y)
    y += 6
  }

  // Metadata
  y += 4
  doc.setFontSize(10)
  for (const m of report.metadata) {
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...COLORS.muted)
    doc.text(`${m.label}:`, MARGIN, y)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...COLORS.text)
    doc.text(m.value, MARGIN + 40, y)
    y += 6
  }

  // Overall Score
  if (report.overallScore != null) {
    y += 6
    doc.setFillColor(...COLORS.lightGray)
    doc.roundedRect(MARGIN, y - 5, CONTENT_W, 24, 3, 3, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...COLORS.muted)
    doc.text('Overall Communication Score', MARGIN + 6, y + 3)
    doc.setFontSize(28)
    doc.setTextColor(...scoreColor(report.overallScore))
    doc.text(`${report.overallScore.toFixed(1)}`, MARGIN + 6, y + 16)
    doc.setFontSize(11)
    doc.setTextColor(...COLORS.muted)
    doc.text('/ 10', MARGIN + 32, y + 16)
    y += 28
  }

  // Skill Scores
  if (report.skillScores?.scores) {
    y = drawSectionTitle(doc, 'Skill Scores', y + 4)
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
    y = MARGIN
    y = drawSectionTitle(doc, 'Coaching Insights', y)

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
    y = MARGIN
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
    y = MARGIN

    for (const section of report.metrics) {
      y = drawSectionTitle(doc, section.section, y)
      const colW = CONTENT_W / 3
      let col = 0

      for (const item of section.items) {
        const x = MARGIN + col * colW
        y = ensureSpace(doc, y, 18)

        doc.setFillColor(...COLORS.lightGray)
        doc.roundedRect(x, y - 4, colW - 3, 16, 2, 2, 'F')

        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7.5)
        doc.setTextColor(...COLORS.muted)
        doc.text(item.label, x + 3, y)

        doc.setFont('helvetica', 'bold')
        doc.setFontSize(12)
        doc.setTextColor(...COLORS.text)
        doc.text(item.value, x + 3, y + 8)

        if (item.unit) {
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(7)
          doc.setTextColor(...COLORS.muted)
          doc.text(item.unit, x + 3 + doc.getTextWidth(item.value) + 1, y + 8)
        }

        col++
        if (col >= 3) {
          col = 0
          y += 20
        }
      }
      if (col > 0) y += 20
      y += 4
    }
  }

  // ── Strengths / Improvements / Recommendations ──
  const hasList = (report.strengths?.length || 0) + (report.improvements?.length || 0) + (report.recommendations?.length || 0) > 0
  if (hasList) {
    doc.addPage()
    y = MARGIN

    if (report.strengths?.length) {
      y = drawSectionTitle(doc, 'Strengths', y)
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

  // ── Transcript ──
  if (report.structuredTranscript?.length || report.transcript) {
    doc.addPage()
    y = MARGIN
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

  // ── Footer on all pages ──
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...COLORS.muted)
    doc.text(`SpashtAI — ${report.title}`, MARGIN, PAGE_H - 8)
    doc.text(`Page ${i} of ${pageCount}`, PAGE_W - MARGIN - 20, PAGE_H - 8)
  }

  const filename = `${report.title?.replace(/[^a-zA-Z0-9]/g, '-') || 'session'}-report.pdf`
  doc.save(filename)
}
