import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Upload, Mic, History } from 'lucide-react';
import { SkillProgressCard } from '@/components/analytics/SkillProgressCard';

export function Home() {
  return (
    <div className="grid gap-6">
      <section className="grid gap-4">
        <div>
          <h2 className="text-2xl font-bold">Welcome to SpashtAI</h2>
          <p className="text-muted-foreground mt-1">
            AI-powered communication coaching — practice live or learn from past conversations.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Replay Card */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <Upload className="h-10 w-10 text-blue-500" />
              <CardTitle className="mt-2">Replay</CardTitle>
              <CardDescription>
                Upload past recordings or transcripts and get AI-powered analysis and feedback.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link to="/replay">
                <Button className="w-full" size="lg" variant="outline">Upload &amp; Analyze</Button>
              </Link>
              <ul className="mt-3 grid gap-1 text-xs text-muted-foreground">
                <li>Works with any meeting platform</li>
                <li>Detailed AI feedback &amp; scores</li>
                <li>Track improvement over time</li>
              </ul>
              <div className="mt-3 flex justify-end">
                <Link
                  to="/history?tab=replay"
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <History className="h-3.5 w-3.5" />
                  Past Sessions
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Elevate Card */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <Mic className="h-10 w-10 text-indigo-500" />
              <CardTitle className="mt-2">Elevate</CardTitle>
              <CardDescription>
                Practice live with an AI coach and elevate your communication skills in real time.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link to="/elevate">
                <Button className="w-full" size="lg" variant="outline">Start Live Session</Button>
              </Link>
              <ul className="mt-3 grid gap-1 text-xs text-muted-foreground">
                <li>Real-time voice AI conversation</li>
                <li>Live metrics &amp; analytics</li>
                <li>Resume anytime</li>
              </ul>
              <div className="mt-3 flex justify-end">
                <Link
                  to="/history?tab=elevate"
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <History className="h-3.5 w-3.5" />
                  Past Sessions
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <SkillProgressCard />
    </div>
  );
}
