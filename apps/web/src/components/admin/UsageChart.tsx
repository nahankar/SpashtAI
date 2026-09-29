import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface UsageChartProps {
  title: string
  data: Array<{ name: string; elevate?: number; replay?: number; prepare?: number; [key: string]: string | number | undefined }>
  enabledFeatures?: Array<'elevate' | 'replay' | 'prepare'>
}

export function UsageChart({ title, data, enabledFeatures = ['elevate', 'replay', 'prepare'] }: UsageChartProps) {
  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            No data available yet
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="name" className="text-xs" />
            <YAxis className="text-xs" />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '6px',
              }}
            />
            <Legend />
            {enabledFeatures.includes('elevate') && (
              <Bar dataKey="elevate" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            )}
            {enabledFeatures.includes('replay') && (
              <Bar dataKey="replay" fill="hsl(262.1, 83.3%, 57.8%)" radius={[4, 4, 0, 0]} />
            )}
            {enabledFeatures.includes('prepare') && (
              <Bar dataKey="prepare" fill="hsl(142.1, 76.2%, 36.3%)" radius={[4, 4, 0, 0]} />
            )}
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
