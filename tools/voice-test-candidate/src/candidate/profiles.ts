/** Fictional people only. Nothing here describes a real person or employer. */
export interface CandidateProfile {
  id: string
  name: string
  summary: string
  background: string[]
  /** Answers used only by the provider-free `scripted` response generator. */
  scriptedAnswers: string[]
}

export const PROFILES: Record<string, CandidateProfile> = {
  'qa-engineer': {
    id: 'qa-engineer',
    name: 'Riya Malhotra (fictional)',
    summary: 'Test automation engineer with four years of experience on web and API testing.',
    background: [
      'Four years at "Bluefin Retail Labs" (fictional), an e-commerce company, as a QA automation engineer.',
      'Built a Playwright and TypeScript UI regression suite of about 600 tests and cut flaky failures from 12% to under 2% using retries with root-cause tagging, stable selectors and isolated test data.',
      'Maintains REST API tests with Postman/Newman and later moved them to a Jest + Supertest suite running in GitHub Actions.',
      'Uses the page object model, data-driven tests, contract tests with Pact for two internal services, and basic k6 load tests.',
      'Works in two-week Scrum sprints; writes risk-based test plans and triages defects with developers.',
      'Earlier: one year of manual testing at a fictional payroll start-up.',
    ],
    scriptedAnswers: [
      'In my current role I own the UI regression suite. I built it with Playwright and TypeScript, using the page object model and stable test identifiers. The biggest win was reducing flaky failures from about twelve percent to under two percent by isolating test data and tagging every retry with a root cause.',
      'For API testing I start from the contract: status codes, schema and error handling. Then I add negative cases, authentication checks and boundary values. Those tests run in our CI pipeline on every pull request, so a broken endpoint is caught before it reaches the UI tests.',
      'When a test is flaky I first reproduce it locally with tracing on, then check timing, shared test data and environment differences. I fix the cause rather than adding waits, and I keep a small dashboard so we can see whether flakiness is trending down.',
      'I prioritise testing by risk. Payment and checkout flows get the deepest coverage, while low-traffic admin pages get smoke tests. I review the plan with the developers and product owner at the start of each sprint.',
    ],
  },
  'learner-pm': {
    id: 'learner-pm',
    name: 'Arjun Mehta (fictional)',
    summary: 'Associate product manager practising clearer, more structured spoken explanations.',
    background: [
      'Associate product manager at "Northpeak Health Apps" (fictional), a small company building appointment-booking software for clinics.',
      'Recently led a feature that lets patients reschedule appointments from a text message link.',
      'Tends to over-explain and wants to be more concise and structured when presenting to leadership.',
      'Comfortable with everyday product topics: user research, prioritisation, release planning, simple metrics like conversion and no-show rate.',
    ],
    scriptedAnswers: [
      'Sure. I am an associate product manager working on appointment booking for clinics. I would like to practise explaining ideas more clearly and concisely.',
      'Let me explain it simply. A no-show rate is the share of booked appointments where the patient never arrives. If a clinic books one hundred appointments and ten people do not come, the no-show rate is ten percent.',
      'Think of it like a restaurant reservation. If people reserve tables and do not turn up, the restaurant loses money and other diners could not book. Clinics have the same problem, so we send reminders and an easy reschedule link.',
      'Thank you, that was helpful. My main takeaway is to start with the point, give one example, and stop.',
    ],
  },
}

export function getProfile(id: string): CandidateProfile {
  const profile = PROFILES[id]
  if (!profile) throw new Error(`Unknown profile "${id}". Available: ${Object.keys(PROFILES).join(', ')}`)
  return profile
}
