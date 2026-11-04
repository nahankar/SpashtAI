import { useWorkspacesEnabled } from '@/workspaces/useWorkspacesEnabled'
import {
  Activity,
  BarChart3,
  Bot,
  BrainCircuit,
  Building2,
  ClipboardList,
  DollarSign,
  Flag,
  Gauge,
  HeartPulse,
  LayoutDashboard,
  MailPlus,
  MessageSquareText,
  Mic2,
  Scale,
  Users,
} from 'lucide-react'
import { AdminSideNav, type AdminSideGroup } from './AdminSideNav'

const groups: AdminSideGroup[] = [
  {
    label: 'Overview',
    links: [
      { to: '/admin', label: 'Dashboard', end: true, icon: LayoutDashboard },
      { to: '/admin/users', label: 'Users', icon: Users },
      { to: '/admin/workspaces', label: 'Workspaces', icon: Building2 },
      { to: '/admin/invitations', label: 'Invitations', icon: MailPlus },
      { to: '/admin/feedback', label: 'Feedback', icon: MessageSquareText },
    ],
  },
  {
    label: 'Analytics',
    links: [
      { to: '/admin/analytics', label: 'Feature Usage', end: true, icon: BarChart3 },
      { to: '/admin/progress-pulse', label: 'Progress Pulse', icon: Activity },
      { to: '/admin/analytics/explorer', label: 'AI Analytics', end: true, icon: BrainCircuit },
      { to: '/admin/ux-analytics', label: 'UX Analytics', icon: Gauge },
    ],
  },
  {
    label: 'System',
    links: [
      { to: '/admin/system', label: 'Health', icon: HeartPulse },
      { to: '/admin/voice-backend', label: 'Voice Backend', icon: Mic2 },
      { to: '/admin/features', label: 'Feature Flags', icon: Flag },
      { to: '/admin/agent-prompts', label: 'Coach Prompts', icon: Bot },
      { to: '/admin/interview-bank', label: 'Interview Question Bank', icon: ClipboardList },
      { to: '/admin/tickers', label: 'Tickers', icon: Building2 },
    ],
  },
  {
    label: 'Administration',
    links: [
      { to: '/admin/pricing', label: 'Pricing', icon: DollarSign },
      { to: '/admin/legal', label: 'Legal', icon: Scale },
    ],
  },
]

export function Sidebar() {
  const workspacesEnabled = useWorkspacesEnabled()
  return (
    <AdminSideNav
      title="Admin Panel"
      groups={groups.map(group => ({
        ...group,
        links: group.links.filter(link => link.to !== '/admin/workspaces' || workspacesEnabled),
      }))}
    />
  )
}
