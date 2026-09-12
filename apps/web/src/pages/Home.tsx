import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Upload, Mic, History, BriefcaseBusiness } from 'lucide-react';
import { ProgressPulseCard } from '@/components/analytics/ProgressPulseCard';
import { useFeatureFlags } from '@/contexts/FeatureFlagsContext';
import { FeatureModuleCard } from '@/components/auth/FeatureModuleCard';
import { HomeTicker } from '@/components/layout/HomeTicker';
import { useAuth } from '@/hooks/useAuth';
import { BrandName } from '@/components/brand/BrandName';

export function Home() {
  const { isVisible, isAccessible, getFlag } = useFeatureFlags()
  const { user } = useAuth()
  const showReplay = isVisible('replay')
  const showElevate = isVisible('elevate')
  const showPrepare = isVisible('prepare')
  const moduleCount = [showReplay, showElevate, showPrepare].filter(Boolean).length

  return (
    <div className="grid gap-6">
      <HomeTicker />

      <section className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold">Welcome to <BrandName className="inline" size="lg" /></h2>
            <p className="text-muted-foreground mt-1">
              AI-powered communication coaching — practice live or learn from past conversations.
            </p>
          </div>
          {user && (
            <div className="rounded-lg border bg-primary/5 px-4 py-2 text-sm">
              <span className="text-muted-foreground">Points earned </span>
              <span className="font-semibold text-primary">
                {(user.rewardPoints ?? 0).toFixed(2)}
              </span>
            </div>
          )}
        </div>

        {moduleCount === 0 ? (
          <FeatureModuleCard
            title="Modules"
            description="No coaching modules are currently available."
            icon={null}
            flag={{ hidden: false, disabled: true, overlayComment: 'Contact your administrator.', overlayPosition: 'center' }}
            accessible={false}
          >
            <Button disabled className="w-full">Unavailable</Button>
          </FeatureModuleCard>
        ) : (
          <div className={`grid gap-4 ${moduleCount > 2 ? 'lg:grid-cols-3' : moduleCount > 1 ? 'sm:grid-cols-2' : 'max-w-lg'}`}>
            {showReplay && (
              <FeatureModuleCard
                title="Replay"
                description="Upload past recordings or transcripts and get AI-powered analysis and feedback."
                icon={<Upload className="h-8 w-8 text-blue-500 shrink-0" />}
                flag={getFlag('replay')}
                accessible={isAccessible('replay')}
                footer={
                  isAccessible('replay') ? (
                    <div className="mt-3 flex justify-end">
                      <Link
                        to="/history?tab=replay"
                        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <History className="h-3.5 w-3.5" />
                        Sessions
                      </Link>
                    </div>
                  ) : undefined
                }
              >
                <Link to="/replay">
                  <Button className="w-full" size="lg" variant="outline">Upload &amp; Analyze</Button>
                </Link>
                <ul className="mt-3 grid gap-1 text-xs text-muted-foreground">
                  <li>Works with any meeting platform</li>
                  <li>Detailed AI feedback &amp; scores</li>
                  <li>Track improvement over time</li>
                </ul>
              </FeatureModuleCard>
            )}

            {showElevate && (
              <FeatureModuleCard
                title="Elevate"
                description="Practice live with an AI coach and elevate your communication skills in real time."
                icon={<Mic className="h-8 w-8 text-indigo-500 shrink-0" />}
                flag={getFlag('elevate')}
                accessible={isAccessible('elevate')}
                footer={
                  isAccessible('elevate') ? (
                    <div className="mt-3 flex justify-end">
                      <Link
                        to="/history?tab=elevate"
                        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <History className="h-3.5 w-3.5" />
                        Sessions
                      </Link>
                    </div>
                  ) : undefined
                }
              >
                <div className="grid gap-2">
                  <Link to="/elevate?demo=1&newSession=true">
                    <Button className="w-full" size="lg">Quick Try · 3 min</Button>
                  </Link>
                  <Link to="/elevate">
                    <Button className="w-full" size="lg" variant="outline">Start Live Session</Button>
                  </Link>
                </div>
                <ul className="mt-3 grid gap-1 text-xs text-muted-foreground">
                  <li>Real-time voice AI conversation</li>
                  <li>Live metrics &amp; analytics</li>
                  <li>Resume anytime</li>
                </ul>
              </FeatureModuleCard>
            )}

            {showPrepare && (
              <FeatureModuleCard
                title="Prepare"
                description="Organise upcoming interview journeys and always know which round is next."
                icon={<BriefcaseBusiness className="h-8 w-8 text-emerald-600 shrink-0" />}
                flag={getFlag('prepare')}
                accessible={isAccessible('prepare')}
              >
                <Link to="/prepare">
                  <Button className="w-full" size="lg" variant="outline">Start Preparing</Button>
                </Link>
                <ul className="mt-3 grid gap-1 text-xs text-muted-foreground">
                  <li>Track multiple interview journeys</li>
                  <li>Keep role and round context together</li>
                  <li>Know what comes next</li>
                </ul>
              </FeatureModuleCard>
            )}
          </div>
        )}
      </section>

      <ProgressPulseCard />
    </div>
  );
}
