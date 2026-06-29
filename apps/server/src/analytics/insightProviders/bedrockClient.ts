import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime'
import { awsCredentialsConfig } from '../../lib/awsCredentials'

let _client: BedrockRuntimeClient | null = null

export function getBedrockClient(): BedrockRuntimeClient {
  if (!_client) {
    _client = new BedrockRuntimeClient({
      region: process.env.BEDROCK_REGION || process.env.AWS_REGION || 'us-east-1',
      ...awsCredentialsConfig(),
    })
  }
  return _client
}
