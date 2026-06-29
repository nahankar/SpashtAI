/**
 * Resolve AWS credentials config for SDK v3 clients.
 *
 * - When AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY are both set (local dev /
 *   IAM user), use them explicitly.
 * - When they're absent (production on EC2), return an empty object so the SDK
 *   uses its default provider chain — which picks up the attached EC2 instance
 *   role. Passing empty-string credentials would otherwise cause
 *   "The security token included in the request is invalid".
 */
export function awsCredentialsConfig(): {
  credentials?: { accessKeyId: string; secretAccessKey: string }
} {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim()
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim()
  if (accessKeyId && secretAccessKey) {
    return { credentials: { accessKeyId, secretAccessKey } }
  }
  return {}
}
