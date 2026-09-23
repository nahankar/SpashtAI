import {
  formatMeasurement,
  formatRecordingTime,
  getMomentDataError,
  metricLabels,
  type DeliveryMetric,
  type DeliveryMoment,
  type RawMeasurement,
} from './contract'

export interface DeliveryTrendChartProps {
  moments: readonly DeliveryMoment[]
  metric: DeliveryMetric
}
export function DeliveryTrendChart({ moments, metric }: DeliveryTrendChartProps) {
  if (moments.some((moment) =>
    moment.evidence.quality === 'verified' &&
    moment.evidence.measurement.metric === metric &&
    getMomentDataError(moment) !== null
  )) {
    return <p role="alert">Cannot chart {metricLabels[metric].toLowerCase()}: invalid verified sample data.</p>
  }

  const points = moments.flatMap((moment) =>
    moment.evidence.quality === 'verified' && moment.evidence.measurement.metric === metric
      ? [{ id: moment.id, time: moment.clip.startSeconds, measurement: moment.evidence.measurement }]
      : [],
  ).sort((a, b) => a.time - b.time)

  if (!points.length) {
    return <p className="text-sm text-muted-foreground">No verified {metricLabels[metric].toLowerCase()} samples to chart.</p>
  }

  const values = points.map((point) => point.measurement.value)
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const padding = Math.max((maximum - minimum) * 0.1, 1)
  const low = minimum - padding
  const high = maximum + padding
  const start = points[0].time
  const end = points[points.length - 1].time
  const x = (time: number) => 65 + (end === start ? 245 : (time - start) / (end - start) * 490)
  const y = (value: number) => 160 - (value - low) / (high - low) * 130
  const formatAxis = (value: number, measurement: RawMeasurement) =>
    formatMeasurement({ ...measurement, value })

  return (
    <figure className="rounded-lg border border-border bg-card p-4">
      <figcaption className="mb-2 font-medium">
        {metricLabels[metric]} over recording time
      </figcaption>
      <div className="overflow-x-auto">
        <svg
          className="min-w-[600px] w-full text-foreground"
          viewBox="0 0 600 200"
          role="img"
          aria-label={`${metricLabels[metric]} over recording time, ${points.length} verified samples; gaps are not interpolated`}
        >
          <line x1="65" y1="30" x2="65" y2="160" stroke="currentColor" />
          <line x1="65" y1="160" x2="555" y2="160" stroke="currentColor" />
          <text x="5" y={y(maximum) + 4} fontSize="11" fill="currentColor">{formatAxis(maximum, points[0].measurement)}</text>
          {minimum !== maximum && (
            <text x="5" y={y(minimum) + 4} fontSize="11" fill="currentColor">{formatAxis(minimum, points[0].measurement)}</text>
          )}
          <text x="65" y="183" fontSize="11" fill="currentColor">{formatRecordingTime(start)}</text>
          <text x="555" y="183" textAnchor="end" fontSize="11" fill="currentColor">{formatRecordingTime(end)}</text>
          {points.map((point) => (
            <circle
              key={point.id}
              cx={x(point.time)}
              cy={y(point.measurement.value)}
              r="5"
              fill="currentColor"
            />
          ))}
        </svg>
      </div>
      <p className="text-sm text-muted-foreground">
        Individual verified samples only. Missing evidence is not plotted; no trend is inferred between samples.
      </p>
      <table className="sr-only">
        <caption>{metricLabels[metric]} samples</caption>
        <thead><tr><th scope="col">Recording time</th><th scope="col">Raw measurement</th></tr></thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.id}>
              <td>{formatRecordingTime(point.time)}</td>
              <td>{formatMeasurement(point.measurement)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
