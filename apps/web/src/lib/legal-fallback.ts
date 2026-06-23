/** Client-side fallback when API returns empty content (e.g. before server seed runs). */
export const LEGAL_FALLBACK: Record<'terms' | 'privacy', { title: string; content: string }> = {
  terms: {
    title: 'Terms and Conditions',
    content: `Terms and Conditions

Welcome to SpashtAI. By creating an account or using our platform, you agree to these Terms.

1. The Service
SpashtAI provides AI-powered communication coaching including live voice sessions (Elevate), recording analysis (Replay), progress tracking, and feedback features. Coaching output is for learning purposes only and is not professional advice.

2. Your account
You must be 18 or older. You are responsible for your login credentials and activity on your account. Information you provide at signup (including phone, date of birth, gender, and pincode) must be accurate.

3. Acceptable use
Do not misuse the platform, attempt to disrupt our systems, or upload content you do not have rights to share. We may suspend accounts that violate these Terms.

4. Voice & session data
When you use Elevate or Replay, you may transmit audio and transcripts. You grant us permission to process this data to deliver the Service and improve your experience. Our infrastructure may be hosted in different countries.

5. Points & rewards
Reward points have no cash value and may be changed or discontinued at our discretion.

6. Disclaimer
THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTIES. WE ARE NOT LIABLE FOR INDIRECT OR CONSEQUENTIAL DAMAGES TO THE EXTENT PERMITTED BY LAW.

7. Changes
We may update these Terms. Continued use after changes constitutes acceptance. The latest version is always published on this page.

8. Contact
Questions? Use the in-app feedback feature or contact support.

— SpashtAI`,
  },
  privacy: {
    title: 'Privacy Policy',
    content: `Privacy Policy

SpashtAI respects your privacy. This policy explains how we handle your information.

What we collect
• Account details: name, email, phone, date of birth, gender, pincode
• Location derived from pincode (city, state, country) — used internally, not shown to other users
• Session data: audio, transcripts, metrics, and coaching insights
• Usage logs: sign-in activity, feature usage, device/browser type

How we use it
• Provide and improve the Service
• Authenticate you and keep your account secure
• Deliver personalised coaching and progress tracking
• Respond to feedback and support requests
• Comply with legal obligations

AI processing
Your voice and text may be processed by automated systems (speech recognition, language models, analytics) to generate coaching feedback. Processing may occur through trusted subprocessors worldwide.

Sharing
We do not sell your personal data. We share data only with service providers under contract, when required by law, or to protect safety and rights.

International transfers
Our servers and partners may be located in various countries. We apply appropriate safeguards where required.

Retention
We retain data while your account is active and as needed for legitimate business or legal purposes.

Your rights
Depending on your region, you may request access, correction, deletion, or restriction of your data via in-app feedback or support.

Children
SpashtAI is not intended for users under 18.

Updates
We may revise this policy. The "last updated" date on this page reflects the current version.

Contact
Privacy questions? Reach us through the feedback feature in the app.

— SpashtAI`,
  },
}
