import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime'

let _client: BedrockRuntimeClient | null = null

export function getBedrockClient(): BedrockRuntimeClient {
  if (!_client) {
    _client = new BedrockRuntimeClient({
      region: process.env.BEDROCK_REGION || process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    })
  }
  return _client
}
