import { z } from 'zod'
import { buildInvitationEmail, expiryFrom } from '../lib/invitations'
import { emailContentSchema } from './enrollment'

const input = z.object({ emailContent: emailContentSchema.default({}), name: z.string().trim().max(120).optional() }).strict()
/** No token is generated, no invitation is saved, and no mail is sent. */
export function invitationPreview(workspaceName: string | undefined, body: unknown) {
  const parsed = input.parse(body)
  const expiresAt = expiryFrom(new Date())
  return { previewOnly: true, expiresAt, ...buildInvitationEmail({ workspaceName,
    recipientName: parsed.name || 'Sample recipient', acceptUrl: '#preview-only', expiresAt,
    emailSubject: parsed.emailContent.subject, emailMessage: parsed.emailContent.message }) }
}
