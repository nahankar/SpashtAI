export interface AccessPolicy { methods: { google: boolean; emailCode: boolean }; learnerEmailDomains: string[] }
export const defaultAccessPolicy: AccessPolicy = { methods: { google: true, emailCode: true }, learnerEmailDomains: [] }
