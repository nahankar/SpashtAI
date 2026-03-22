import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Clock, MessageSquare, Calendar, TrendingUp, Trash2, CheckSquare, Square, Upload, Mic } from 'lucide-react';
import { getAuthHeaders } from '@/lib/api-client';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';

interface Session {
  id: string;
  module: string;
  startedAt: string;
  endedAt?: string;
  durationSec?: number;
  words?: number;
  fillerRate?: number;
  user: {
    id: string;
    email: string;
  };
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function Home() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchSessions();
  }, []);

  async function fetchSessions() {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/sessions`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) throw new Error('Failed to fetch sessions');
      const data = await response.json();
      setSessions(data.sessions || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
      console.error('Error fetching sessions:', err);
    } finally {
      setLoading(false);
    }
  }

  async function deleteSession(sessionId: string) {
    try {
      const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!response.ok) throw new Error('Failed to delete session');
      
      // Remove from UI
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      setSelectedSessions(prev => {
        const newSet = new Set(prev);
        newSet.delete(sessionId);
        return newSet;
      });
    } catch (err) {
      console.error('Error deleting session:', err);
      alert('Failed to delete session. Please try again.');
    }
  }

  async function deleteSelectedSessions() {
    if (selectedSessions.size === 0) return;
    
    if (!confirm(`Delete ${selectedSessions.size} session(s)? This cannot be undone.`)) {
      return;
    }

    setDeleting(true);
    try {
      // Delete all selected sessions
      await Promise.all(
        Array.from(selectedSessions).map(id => 
          fetch(`${API_BASE_URL}/sessions/${id}`, { method: 'DELETE', headers: getAuthHeaders() })
        )
      );
      
      // Refresh the list
      await fetchSessions();
      setSelectedSessions(new Set());
    } catch (err) {
      console.error('Error deleting sessions:', err);
      alert('Some sessions could not be deleted. Please try again.');
    } finally {
      setDeleting(false);
    }
  }

  function toggleSelection(sessionId: string) {
    setSelectedSessions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(sessionId)) {
        newSet.delete(sessionId);
      } else {
        newSet.add(sessionId);
      }
      return newSet;
    });
  }

  function toggleSelectAll() {
    if (selectedSessions.size === sessions.length) {
      setSelectedSessions(new Set());
    } else {
      setSelectedSessions(new Set(sessions.map(s => s.id)));
    }
  }

  return (
    <div className="grid gap-6">
      {/* Welcome Section */}
      <section className="grid gap-4">
        <h2 className="text-2xl font-bold">Welcome to SpashtAI</h2>
        <p className="text-muted-foreground -mt-2">
          AI-powered communication coaching — practice live or learn from past conversations.
        </p>

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
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Past Sessions */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <h3 className="text-xl font-semibold">Your Past Sessions</h3>
            {sessions.length > 0 && (
              <Badge variant="secondary">{sessions.length} sessions</Badge>
            )}
          </div>
          
          {sessions.length > 0 && (
            <div className="flex gap-2">
              {selectedSessions.size > 0 && (
                <>
                  <Button 
                    variant="destructive" 
                    size="sm"
                    onClick={deleteSelectedSessions}
                    disabled={deleting}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete {selectedSessions.size} Selected
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => setSelectedSessions(new Set())}
                  >
                    Clear Selection
                  </Button>
                </>
              )}
              <Button 
                variant="outline" 
                size="sm"
                onClick={toggleSelectAll}
              >
                {selectedSessions.size === sessions.length ? (
                  <>
                    <CheckSquare className="h-4 w-4 mr-2" />
                    Deselect All
                  </>
                ) : (
                  <>
                    <Square className="h-4 w-4 mr-2" />
                    Select All
                  </>
                )}
              </Button>
            </div>
          )}
        </div>

        {loading && (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              Loading sessions...
            </CardContent>
          </Card>
        )}

        {error && (
          <Card className="border-red-200 bg-red-50 dark:bg-red-950">
            <CardContent className="p-6 text-center text-red-600 dark:text-red-400">
              {error}
            </CardContent>
          </Card>
        )}

        {!loading && !error && sessions.length === 0 && (
          <Card>
            <CardContent className="p-12 text-center">
              <MessageSquare className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <h4 className="text-lg font-medium mb-2">No sessions yet</h4>
              <p className="text-muted-foreground mb-4">
                Start your first session to get personalized feedback and analytics.
              </p>
              <Link to="/elevate">
                <Button>Start Your First Session</Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {!loading && !error && sessions.length > 0 && (
          <div className="grid gap-4">
            {sessions.map((session) => {
              const isSelected = selectedSessions.has(session.id);
              const isCompleted = session.endedAt !== null && session.endedAt !== undefined;
              
              return (
                <Card 
                  key={session.id} 
                  className={`hover:shadow-lg transition-all ${isSelected ? 'ring-2 ring-primary' : ''}`}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3 flex-1">
                        {/* Selection Checkbox */}
                        <button
                          onClick={() => toggleSelection(session.id)}
                          className="mt-1 hover:opacity-70 transition-opacity"
                          aria-label={isSelected ? "Deselect session" : "Select session"}
                        >
                          {isSelected ? (
                            <CheckSquare className="h-5 w-5 text-primary" />
                          ) : (
                            <Square className="h-5 w-5 text-muted-foreground" />
                          )}
                        </button>
                        
                        <div className="flex-1">
                          <CardTitle className="text-lg">
                            {session.module.charAt(0).toUpperCase() + session.module.slice(1)} Session
                          </CardTitle>
                          <CardDescription className="flex items-center gap-2 mt-1">
                            <Calendar className="h-3 w-3" />
                            {formatDate(session.startedAt)}
                          </CardDescription>
                        </div>
                      </div>
                      
                      <Badge variant={isCompleted ? "default" : "secondary"}>
                        {isCompleted ? "Completed" : "In Progress"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {isCompleted && (
                      <div className="grid grid-cols-3 gap-4 mb-4">
                        {session.durationSec !== null && session.durationSec !== undefined && (
                          <div className="flex items-center gap-2 text-sm">
                            <Clock className="h-4 w-4 text-muted-foreground" />
                            <span>{formatDuration(session.durationSec)}</span>
                          </div>
                        )}
                        
                        {session.words !== null && session.words !== undefined && (
                          <div className="flex items-center gap-2 text-sm">
                            <MessageSquare className="h-4 w-4 text-muted-foreground" />
                            <span>{session.words} words</span>
                          </div>
                        )}
                        
                        {session.fillerRate !== null && session.fillerRate !== undefined && (
                          <div className="flex items-center gap-2 text-sm">
                            <TrendingUp className="h-4 w-4 text-muted-foreground" />
                            <span>{session.fillerRate.toFixed(1)}% fillers</span>
                          </div>
                        )}
                      </div>
                    )}

                    {!isCompleted && (
                      <p className="text-sm text-muted-foreground mb-4">
                        This session was not properly completed. You can resume it or delete it.
                      </p>
                    )}

                    <div className="flex gap-2">
                      <Link to={`/elevate?session=${session.id}`} className="flex-1">
                        <Button variant="outline" className="w-full">
                          {isCompleted ? "View Details & Metrics" : "Resume or View"}
                        </Button>
                      </Link>
                      <Button 
                        variant="ghost" 
                        size="icon"
                        onClick={async () => {
                          if (confirm('Delete this session? This cannot be undone.')) {
                            await deleteSession(session.id);
                          }
                        }}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
