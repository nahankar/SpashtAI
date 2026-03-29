import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Badge } from '../ui/badge'
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
} from 'lucide-react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion'
import { getAuthHeaders } from '@/lib/api-client'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

interface SkillScoresCardProps {
  sessionId: string
  isSessionEnded?: boolean
  initialSkillData?: SkillScoresData | null
  initialCoaching?: CoachingData | null
}

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

interface CoachingData {
  topStrength: string
  primaryImprovement: string
  actionableAdvice: string
  practiceExercise: string
  decisionClarity?: {
    decisionsDetected: number
    actionItemsDetected: number
    summary: string
  }
  topicFlow?: string
  overallNarrative: string
  error?: string
}

const SKILL_CONFIG: {
  key: string
  label: string
  icon: typeof Brain
  description: string
}[] = [
  { key: 'clarity', label: 'Clarity', icon: Lightbulb, description: 'How easy to understand' },
  { key: 'confidence', label: 'Confidence', icon: Zap, description: 'Assertiveness vs hesitation' },
  { key: 'conciseness', label: 'Conciseness', icon: Target, description: 'Efficiency of expression' },
  { key: 'structure', label: 'Structure', icon: Brain, description: 'Logical organization' },
  { key: 'engagement', label: 'Engagement', icon: MessageSquare, description: 'Interaction quality' },
  { key: 'pacing', label: 'Pacing', icon: Activity, description: 'Speaking speed control' },
  { key: 'delivery', label: 'Delivery', icon: Mic, description: 'Voice modulation' },
  { key: 'emotionalControl', label: 'Emotional Control', icon: TrendingUp, description: 'Stability under pressure' },
]

function getScoreColor(score: number): string {
  if (score >= 8) return 'text-green-600'
  if (score >= 6) return 'text-blue-600'
  if (score >= 4) return 'text-yellow-600'
  return 'text-red-600'
}

function getScoreBadgeVariant(score: number): 'default' | 'secondary' | 'destructive' {
  if (score >= 8) return 'default'
  if (score >= 6) return 'secondary'
  return 'destructive'
}

function getProgressColor(score: number): string {
  if (score >= 8) return '[&>div]:bg-green-500'
  if (score >= 6) return '[&>div]:bg-blue-500'
  if (score >= 4) return '[&>div]:bg-yellow-500'
  return '[&>div]:bg-red-500'
}

export function SkillScoresCard({ sessionId, isSessionEnded = false, initialSkillData, initialCoaching }: SkillScoresCardProps) {
  const [skillData, setSkillData] = useState<SkillScoresData | null>(initialSkillData ?? null)
  const [coaching, setCoaching] = useState<CoachingData | null>(initialCoaching ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (initialSkillData) setSkillData(initialSkillData)
    if (initialCoaching) setCoaching(initialCoaching)
  }, [initialSkillData, initialCoaching])

  useEffect(() => {
    if (isSessionEnded && sessionId && !initialSkillData) {
      fetchData()
    }
  }, [sessionId, isSessionEnded, initialSkillData])

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [scoresRes, coachingRes] = await Promise.all([
        fetch(`${API_BASE_URL}/sessions/${sessionId}/skill-scores`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE_URL}/sessions/${sessionId}/coaching-insights`, { headers: getAuthHeaders() }),
      ])

      if (scoresRes.ok) {
        const data = await scoresRes.json()
        setSkillData(data)
      }
      if (coachingRes.ok) {
        const data = await coachingRes.json()
        setCoaching(data)
      }
      if (!scoresRes.ok && !coachingRes.ok) {
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

  return (
    <div className="space-y-6">
      {/* Overall Score */}
      <Card className="border-2 border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="h-6 w-6 text-yellow-600" />
            Communication Score
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-8">
            <div className="text-center">
              <div className={`text-5xl font-bold ${getScoreColor(avgScore)}`}>
                {avgScore.toFixed(1)}
              </div>
              <div className="text-sm text-muted-foreground mt-1">out of 10</div>
            </div>
            <div className="flex-1 grid gap-3">
              {availableSkills.map((skill) => {
                const val = scores[skill.key as keyof typeof scores] as number
                const Icon = skill.icon
                return (
                  <div key={skill.key}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="flex items-center gap-1.5">
                        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                        {skill.label}
                      </span>
                      <Badge variant={getScoreBadgeVariant(val)}>{val.toFixed(1)}</Badge>
                    </div>
                    <Progress value={val * 10} className={`h-1.5 ${getProgressColor(val)}`} />
                  </div>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Coaching Insights */}
      {coaching && !coaching.error && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-blue-600" />
              Coaching Insights
            </CardTitle>
            {coaching.overallNarrative && (
              <CardDescription className="text-sm leading-relaxed">
                {coaching.overallNarrative}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {coaching.topStrength && (
              <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-3">
                <TrendingUp className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-green-800">Top Strength</p>
                  <p className="text-sm text-green-700 mt-0.5">{coaching.topStrength}</p>
                </div>
              </div>
            )}

            {coaching.primaryImprovement && (
              <div className="flex items-start gap-3 rounded-lg border border-yellow-200 bg-yellow-50 p-3">
                <Target className="h-5 w-5 text-yellow-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-yellow-800">Focus Area</p>
                  <p className="text-sm text-yellow-700 mt-0.5">{coaching.primaryImprovement}</p>
                </div>
              </div>
            )}

            {coaching.actionableAdvice && (
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <Zap className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Actionable Advice</p>
                  <p className="text-sm text-muted-foreground mt-0.5">{coaching.actionableAdvice}</p>
                </div>
              </div>
            )}

            {coaching.practiceExercise && (
              <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
                <Activity className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-blue-800">Practice Exercise</p>
                  <p className="text-sm text-blue-700 mt-0.5">{coaching.practiceExercise}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Skill Breakdown (Expandable) */}
      {components && Object.keys(components).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Skill Breakdown</CardTitle>
            <CardDescription>What contributes to each score</CardDescription>
          </CardHeader>
          <CardContent>
            <Accordion type="single" collapsible>
              {availableSkills.map((skill) => {
                const comp = components[skill.key]
                if (!comp) return null
                const val = scores[skill.key as keyof typeof scores] as number
                return (
                  <AccordionItem key={skill.key} value={skill.key}>
                    <AccordionTrigger className="text-sm">
                      <span className="flex items-center gap-2">
                        {skill.label}
                        <Badge variant="outline" className="ml-1">{val.toFixed(1)}</Badge>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="grid gap-2 pt-1">
                        {Object.entries(comp).map(([name, value]) => (
                          <div key={name} className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground capitalize">
                              {name.replace(/([A-Z])/g, ' $1').trim()}
                            </span>
                            <span className={getScoreColor(value)}>{value.toFixed(1)}/10</span>
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                )
              })}
            </Accordion>
          </CardContent>
        </Card>
      )}

    </div>
  )
}
