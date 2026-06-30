import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Progress } from '../ui/progress'
import {
  Brain,
  Lightbulb,
  Target,
  TrendingUp,
  Mic,
  MessageSquare,
  Zap,
  Activity,
  Award,
  Loader2,
  AlertCircle,
  Play,
} from 'lucide-react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion'
import { getAuthHeaders } from '@/lib/api-client'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

interface SkillScoresCardProps {
  sessionId: string
  isSessionEnded?: boolean
  initialSkillData?: SkillScoresData | null
  /** When provided, shows a "Hear it" link on skills backed by per-turn evidence
   *  (pacing, conciseness, confidence) that jumps the Playback tab to that moment. */
  onHearMoment?: (skillKey: string) => void
}

// Only skills we can map to a concrete per-turn moment get a "Hear it" link.
const HEARABLE_SKILLS = new Set(['pacing', 'conciseness', 'confidence'])

interface SkillScoresData {
  scores: {
    clarity: number
    conciseness: number
    confidence: number
    structure: number
    engagement: number
    pacing: number
    delivery: number | null
    emotionalControl: number | null
  }
  components: Record<string, Record<string, number>>
}

const SKILL_CONFIG: {
  key: string
  label: string
  icon: typeof Brain
  description: string
}[] = [
  {
    key: 'clarity',
    label: 'Clarity',
    icon: Lightbulb,
    description:
      'How easy your message is to follow — clear wording, logical phrasing, and vocabulary that matches your audience.',
  },
  {
    key: 'confidence',
    label: 'Confidence',
    icon: Zap,
    description:
      'How assertive and assured you sound — fewer hedges (“I think”, “maybe”), steady tone, and direct statements.',
  },
  {
    key: 'conciseness',
    label: 'Conciseness',
    icon: Target,
    description:
      'How efficiently you express ideas — low filler rate, focused sentences, and no unnecessary repetition.',
  },
  {
    key: 'structure',
    label: 'Structure',
    icon: Brain,
    description:
      'How well your points are organized — clear opening, logical flow between ideas, and a sense of progression.',
  },
  {
    key: 'engagement',
    label: 'Engagement',
    icon: MessageSquare,
    description:
      'How much you draw others in — questions, check-ins, examples, and signals that you are speaking with the room, not at it.',
  },
  {
    key: 'pacing',
    label: 'Pacing',
    icon: Activity,
    description:
      'How well you control speaking speed and rhythm — WPM in a listenable range, pauses at the right moments, not rushing.',
  },
  {
    key: 'delivery',
    label: 'Delivery',
    icon: Mic,
    description:
      'How you sound, not just what you say — pitch variation, energy, pauses, and vocal quality from audio analysis.',
  },
  {
    key: 'emotionalControl',
    label: 'Emotional Control',
    icon: TrendingUp,
    description:
      'How steady you stay under pressure — even tone when challenged, no sharp spikes in nerves or frustration.',
  },
]

function getScoreColor(score: number): string {
  if (score >= 8) return 'text-green-600'
  if (score >= 6) return 'text-blue-600'
  if (score >= 4) return 'text-yellow-600'
  return 'text-red-600'
}

function getProgressColor(score: number): string {
  if (score >= 8) return '[&>div]:bg-green-500'
  if (score >= 6) return '[&>div]:bg-blue-500'
  if (score >= 4) return '[&>div]:bg-yellow-500'
  return '[&>div]:bg-red-500'
}

export function SkillScoresCard({
  sessionId,
  isSessionEnded = false,
  initialSkillData,
  onHearMoment,
}: SkillScoresCardProps) {
  const [skillData, setSkillData] = useState<SkillScoresData | null>(initialSkillData ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (initialSkillData) setSkillData(initialSkillData)
  }, [initialSkillData])

  useEffect(() => {
    if (isSessionEnded && sessionId && !initialSkillData) {
      fetchData()
    }
  }, [sessionId, isSessionEnded, initialSkillData])

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const scoresRes = await fetch(`${API_BASE_URL}/sessions/${sessionId}/skill-scores`, {
        headers: getAuthHeaders(),
      })

      if (scoresRes.ok) {
        const data = await scoresRes.json()
        setSkillData(data)
      } else {
        setError('Skill analysis not available yet')
      }
    } catch (err) {
      console.error('Error fetching skill scores:', err)
      setError('Failed to load skill analysis')
    } finally {
      setLoading(false)
    }
  }

  if (!isSessionEnded) return null

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="h-5 w-5 animate-pulse" />
            Analyzing Communication Skills...
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <div className="text-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Running skill analysis with AI...</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error && !skillData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-yellow-600" />
            Skill Analysis
          </CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardContent>
          <button
            onClick={fetchData}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm"
          >
            Retry
          </button>
        </CardContent>
      </Card>
    )
  }

  if (!skillData) return null

  const { scores, components } = skillData
  const availableSkills = SKILL_CONFIG.filter((s) => {
    const val = scores[s.key as keyof typeof scores]
    return val !== null && val !== undefined
  })

  const avgScore =
    availableSkills.reduce((sum, s) => sum + (scores[s.key as keyof typeof scores] as number), 0) /
    availableSkills.length

  const hasComponents = components && Object.keys(components).length > 0

  return (
    <div className="space-y-6">
      {/* Communication Score — overall + per-skill rows. Each skill row is a
          dropdown that expands to show what contributes to its score, so we no
          longer need a separate "Skill Breakdown" card. */}
      <Card className="border-2 border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="h-6 w-6 text-yellow-600" />
            Communication Score
          </CardTitle>
          <CardDescription>Click any skill to see what contributes to the score</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-8">
            <div className="shrink-0 text-center">
              <div className={`text-5xl font-bold ${getScoreColor(avgScore)}`}>
                {avgScore.toFixed(1)}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">out of 10</div>
            </div>
            <div className="min-w-0 flex-1">
              <Accordion type="single" collapsible className="space-y-0">
                {availableSkills.map((skill) => {
                  const val = scores[skill.key as keyof typeof scores] as number
                  const comp = components?.[skill.key]
                  const Icon = skill.icon
                  return (
                    <AccordionItem key={skill.key} value={skill.key} className="border-b-0">
                      <div className="space-y-1.5 py-1.5">
                        <div className="flex items-center gap-2">
                          <div className="flex min-w-0 flex-1 items-center justify-between gap-3 text-sm">
                            <span className="flex min-w-0 items-center gap-1.5 font-medium">
                              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              {skill.label}
                            </span>
                            <span className={`shrink-0 text-sm font-bold ${getScoreColor(val)}`}>
                              {val.toFixed(1)}
                            </span>
                          </div>
                          {onHearMoment && HEARABLE_SKILLS.has(skill.key) && (
                            <button
                              type="button"
                              onClick={() => onHearMoment(skill.key)}
                              title="Jump to a moment in Playback that shaped this score"
                              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/30 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
                            >
                              <Play className="h-3 w-3" /> Hear it
                            </button>
                          )}
                          {comp ? (
                            <AccordionTrigger className="flex-none shrink-0 py-0 pl-1 pr-0 hover:no-underline">
                              <span className="sr-only">Show {skill.label} breakdown</span>
                            </AccordionTrigger>
                          ) : (
                            <span className="w-4 shrink-0" aria-hidden />
                          )}
                        </div>
                        <Progress value={val * 10} className={`h-2 w-full ${getProgressColor(val)}`} />
                      </div>
                      {comp && (
                        <AccordionContent className="pb-2 pl-2 pt-0">
                          <p className="mb-2 text-xs text-muted-foreground">{skill.description}</p>
                          <div className="grid gap-1.5 rounded-md bg-muted/40 p-2.5">
                            {Object.entries(comp).map(([name, value]) => (
                              <div key={name} className="flex items-center justify-between text-xs">
                                <span className="capitalize text-muted-foreground">
                                  {name.replace(/([A-Z])/g, ' $1').trim()}
                                </span>
                                <span className={getScoreColor(value)}>{value.toFixed(1)}/10</span>
                              </div>
                            ))}
                          </div>
                        </AccordionContent>
                      )}
                    </AccordionItem>
                  )
                })}
              </Accordion>
              {!hasComponents && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Per-skill breakdown isn&apos;t available for this session.
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
