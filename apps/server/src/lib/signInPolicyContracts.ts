import { z } from 'zod'

export const signInPolicySchema = z.object({
  google: z.boolean(), emailCode: z.boolean(),
}).strict().refine(p => p.google || p.emailCode, 'Select at least one sign-in method')
export const accessPolicySchema = z.object({
  methods: signInPolicySchema,
  learnerEmailDomains: z.array(z.string().trim().toLowerCase().max(253)
    .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'Enter a domain such as klsvdit.edu.in')).max(20)
    .transform(v => [...new Set(v)]),
}).strict()
