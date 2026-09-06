import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Briefcase,
  FileText,
  Loader2,
  Sparkles,
  UserRound,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createPreparation } from '@/lib/prepare-api'
import {
  PREPARE_TEXT_LIMITS,
  ROUND_OPTIONS,
  type PreparationStageType,
} from '@/lib/prepare-types'
import { cn } from '@/lib/utils'

function CharacterCount({ value, limit }: { value: string; limit: number }) {
  if (value.length < limit * 0.8) return null
  return (
    <p
      className={cn(
        'text-right text-xs',
        value.length >= limit ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {value.length.toLocaleString()} / {limit.toLocaleString()} characters
    </p>
  )
}

/** One turn in the intake conversation. Content is whatever the user needs to answer with. */
function Turn({
  prompt,
  hint,
  children,
}: {
  prompt: string
  hint?: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex gap-3">
      <div
        aria-hidden
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
      >
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <p className="font-medium">{prompt}</p>
          {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
        </div>
        {children}
      </div>
    </div>
  )
}

function UserSaid({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-muted px-4 py-2.5 text-sm">
        {text}
      </p>
    </div>
  )
}

/** Optional extra context, revealed only when the user asks for it. */
function OptionalSection({
  icon,
  label,
  open,
  onOpen,
  children,
}: {
  icon: React.ReactNode
  label: string
  open: boolean
  onOpen: () => void
  children: React.ReactNode
}) {
  if (!open) {
    return (
      <Button variant="outline" size="sm" className="rounded-full" onClick={onOpen}>
        {icon}
        <span className="ml-2">{label}</span>
      </Button>
    )
  }
  return <div className="w-full space-y-3 rounded-lg border bg-muted/20 p-4">{children}</div>
}

export function Prepare() {
  const navigate = useNavigate()
  const endRef = useRef<HTMLDivElement>(null)

  const [opening, setOpening] = useState('')
  const [started, setStarted] = useState(false)
  const [companyName, setCompanyName] = useState('')
  const [roleTitle, setRoleTitle] = useState('')
  const [interviewDate, setInterviewDate] = useState('')
  const [round, setRound] = useState<PreparationStageType | null>(null)
  const [roundChosen, setRoundChosen] = useState(false)
  const [jobDescriptionText, setJobDescriptionText] = useState('')
  const [resumeText, setResumeText] = useState('')
  const [resumeLabel, setResumeLabel] = useState('')
  const [interviewerName, setInterviewerName] = useState('')
  const [interviewerRole, setInterviewerRole] = useState('')
  const [interviewerProfileText, setInterviewerProfileText] = useState('')
  const [showJd, setShowJd] = useState(false)
  const [showResume, setShowResume] = useState(false)
  const [showInterviewer, setShowInterviewer] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const hasEssentials = companyName.trim() !== '' && roleTitle.trim() !== ''

  useEffect(() => {
    if (started) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [started, roundChosen, showJd, showResume, showInterviewer])

  async function submit() {
    setSubmitting(true)
    try {
      const preparation = await createPreparation({
        companyName: companyName.trim(),
        roleTitle: roleTitle.trim(),
        interviewDate: interviewDate ? new Date(interviewDate).toISOString() : null,
        currentStageType: round,
        jobDescriptionText: jobDescriptionText.trim() || null,
        resumeText: resumeText.trim() || null,
        resumeLabel: resumeLabel.trim() || null,
        interviewerName: interviewerName.trim() || null,
        interviewerRole: interviewerRole.trim() || null,
        interviewerProfileText: interviewerProfileText.trim() || null,
      })
      toast.success('Interview journey created')
      navigate(`/prepare/interviews/${preparation.id}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create journey')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-primary">Prepare · Perform</p>
          <h1 className="text-3xl font-bold tracking-tight">What are you preparing for?</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Tell us what is coming up. We will organise the interview journey underneath.
          </p>
        </div>
        <Link to="/prepare/interviews">
          <Button variant="outline">Your interviews</Button>
        </Link>
      </div>

      <Card className="mx-auto max-w-3xl">
        <CardContent className="space-y-6 py-6">
          {!started ? (
            <Turn
              prompt="What is coming up?"
              hint="Write it however you think about it. You will confirm the details next."
            >
              <Textarea
                autoFocus
                rows={3}
                value={opening}
                maxLength={2000}
                onChange={(event) => setOpening(event.target.value)}
                placeholder="e.g. I have a Google Senior Engineering Manager interview next Thursday"
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => setStarted(true)}>
                  Continue <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <button
                  type="button"
                  className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  onClick={() => {
                    setOpening('')
                    setStarted(true)
                  }}
                >
                  Enter details instead
                </button>
              </div>
            </Turn>
          ) : (
            <>
              {opening.trim() && <UserSaid text={opening.trim()} />}

              <Turn
                prompt="Which company and role?"
                hint="These two are all we need to start the journey."
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="prepare-company">Company *</Label>
                    <Input
                      id="prepare-company"
                      autoFocus
                      value={companyName}
                      maxLength={PREPARE_TEXT_LIMITS.companyName}
                      onChange={(event) => setCompanyName(event.target.value)}
                      placeholder="e.g. Google"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="prepare-role">Role *</Label>
                    <Input
                      id="prepare-role"
                      value={roleTitle}
                      maxLength={PREPARE_TEXT_LIMITS.roleTitle}
                      onChange={(event) => setRoleTitle(event.target.value)}
                      placeholder="e.g. Senior Engineering Manager"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="prepare-date">When is it? (optional)</Label>
                  <Input
                    id="prepare-date"
                    type="datetime-local"
                    className="sm:max-w-xs"
                    value={interviewDate}
                    onChange={(event) => setInterviewDate(event.target.value)}
                  />
                </div>
              </Turn>

              {hasEssentials && (
                <Turn
                  prompt="Which round is next?"
                  hint="Earlier rounds are marked skipped, not completed — we will not invent history you did not have."
                >
                  <div
                    className="flex flex-wrap gap-2"
                    role="group"
                    aria-label="Next interview round"
                  >
                    {ROUND_OPTIONS.map((option) => {
                      const selected = roundChosen && round === option.type
                      return (
                        <Button
                          key={option.label}
                          type="button"
                          variant={selected ? 'default' : 'outline'}
                          className="rounded-full"
                          aria-pressed={selected}
                          onClick={() => {
                            setRound(option.type)
                            setRoundChosen(true)
                          }}
                        >
                          {option.label}
                        </Button>
                      )
                    })}
                  </div>
                </Turn>
              )}

              {hasEssentials && roundChosen && (
                <Turn
                  prompt="Anything else that would help?"
                  hint="All optional. You can add these later from the journey."
                >
                  <div className="flex flex-wrap gap-2">
                    <OptionalSection
                      icon={<FileText className="h-4 w-4" />}
                      label="Add job description"
                      open={showJd}
                      onOpen={() => setShowJd(true)}
                    >
                      <Label htmlFor="prepare-jd">Job description</Label>
                      <Textarea
                        id="prepare-jd"
                        rows={7}
                        autoFocus
                        maxLength={PREPARE_TEXT_LIMITS.jobDescriptionText}
                        value={jobDescriptionText}
                        onChange={(event) => setJobDescriptionText(event.target.value)}
                        placeholder="Paste the job description…"
                      />
                      <CharacterCount
                        value={jobDescriptionText}
                        limit={PREPARE_TEXT_LIMITS.jobDescriptionText}
                      />
                    </OptionalSection>

                    <OptionalSection
                      icon={<Briefcase className="h-4 w-4" />}
                      label="Add your profile / resume"
                      open={showResume}
                      onOpen={() => setShowResume(true)}
                    >
                      <div>
                        <Label htmlFor="prepare-resume">Profile / resume for this role</Label>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Paste text only. We use it to personalise preparation for this role.
                        </p>
                      </div>
                      <Input
                        value={resumeLabel}
                        maxLength={PREPARE_TEXT_LIMITS.resumeLabel}
                        onChange={(event) => setResumeLabel(event.target.value)}
                        placeholder="Label, e.g. Engineering Manager 2026"
                        aria-label="Profile label"
                      />
                      <Textarea
                        id="prepare-resume"
                        rows={6}
                        autoFocus
                        maxLength={PREPARE_TEXT_LIMITS.resumeText}
                        value={resumeText}
                        onChange={(event) => setResumeText(event.target.value)}
                        placeholder="Paste profile or resume text…"
                      />
                      <CharacterCount value={resumeText} limit={PREPARE_TEXT_LIMITS.resumeText} />
                    </OptionalSection>

                    <OptionalSection
                      icon={<UserRound className="h-4 w-4" />}
                      label="Add the interviewer"
                      open={showInterviewer}
                      onOpen={() => setShowInterviewer(true)}
                    >
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="interviewer-name">Name</Label>
                          <Input
                            id="interviewer-name"
                            autoFocus
                            maxLength={PREPARE_TEXT_LIMITS.interviewerName}
                            value={interviewerName}
                            onChange={(event) => setInterviewerName(event.target.value)}
                            placeholder="e.g. Rahul"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="interviewer-role">Professional role</Label>
                          <Input
                            id="interviewer-role"
                            maxLength={PREPARE_TEXT_LIMITS.interviewerRole}
                            value={interviewerRole}
                            onChange={(event) => setInterviewerRole(event.target.value)}
                            placeholder="e.g. Director, Platform Engineering"
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="interviewer-profile">Professional profile details</Label>
                        <Textarea
                          id="interviewer-profile"
                          rows={5}
                          maxLength={PREPARE_TEXT_LIMITS.interviewerProfileText}
                          value={interviewerProfileText}
                          onChange={(event) => setInterviewerProfileText(event.target.value)}
                          placeholder="Paste relevant public professional experience, if available…"
                        />
                        <CharacterCount
                          value={interviewerProfileText}
                          limit={PREPARE_TEXT_LIMITS.interviewerProfileText}
                        />
                        <p className="text-xs text-muted-foreground">
                          Used only to identify professional topics worth preparing for — never
                          personality or hiring preferences. We never fetch profile URLs.
                        </p>
                      </div>
                    </OptionalSection>
                  </div>
                </Turn>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <p className="text-xs text-muted-foreground">
                  {hasEssentials
                    ? 'You can change any of this later.'
                    : 'Company and role are required.'}
                </p>
                <Button onClick={submit} disabled={submitting || !hasEssentials}>
                  {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create interview journey
                </Button>
              </div>
            </>
          )}
          <div ref={endRef} />
        </CardContent>
      </Card>

      <div className="mx-auto grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-5">
        {['Presentation', 'Pitch', 'Viva', 'Emcee', 'Difficult conversation'].map((name) => (
          <div
            key={name}
            className="rounded-lg border bg-muted/20 p-3 text-center text-xs text-muted-foreground"
          >
            <p className="font-medium text-foreground">{name}</p>
            <p className="mt-1">Coming later</p>
          </div>
        ))}
      </div>
    </div>
  )
}
