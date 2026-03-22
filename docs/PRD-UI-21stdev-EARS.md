

***

## Full PRD+Prompt: Voice AI App (EARS, All Techs)

### PURPOSE

A full-stack, web-based Voice AI application for practicing job interviews, VC pitching, and language fluency—offering real-time communication, analysis, and multi-persona AI interaction.

***

### TECHNOLOGY STACK

- **Frontend:** ReactJS + Vite
- **UI:** Tailwind CSS, ShadCN UI, 21st.dev components
- **Backend:** Node.js (Express)
- **Database:** PostgreSQL
- **RTC:** LiveKit (real-time voice/video)
- **LLM/Voice AI:** AWS NovaSonic (Bedrock), user-selectable models

***

### FUNCTIONAL REQUIREMENTS (EARS Syntax)
#### Ubiquitous
- The system shall use ReactJS (Vite) for SPA frontend.
- The system shall style all UI with Tailwind CSS, ShadCN UI, and 21st.dev components—with 21st.dev as first choice for major elements.
- The system shall use LiveKit for low-latency, real-time audio/video streaming.[11]
- The backend shall use Node.js and persist all data in PostgreSQL.
- The system shall support user login, persona selection, settings, and session history.

#### Modules
##### Job Interview
- When a user selects an interview persona, the system shall establish a LiveKit session and start a mock interview, streaming audio and video.
- While the session is active, the system shall transcribe voice (via NovaSonic), send to LLM for persona response, and stream TTS back in real time.
- The system shall compute and display live stats: word count, duration, filler rate, etc.

##### VC Pitching
- When a user starts a pitch, the system shall simulate a VC persona, enforce timing, and display pitch delivery metrics.

##### Language Fluency
- While in a fluency session, the system shall display real-time metrics (words/min, character count, fluency, pauses, repeated phrases).
- When the session ends, the system shall store session stats in PostgreSQL. When past sessions are viewed, the system shall retrieve and display analytics.

#### Settings & LLM Integration
- On the Settings Page, the system shall let users select which LLM/voice model to use, and input all required API/secret keys for integration (AWS NovaSonic, custom, etc.).
- When a model is selected/configured, the system shall route persona responses through it live.

#### Non-functional
- The system shall provide <300ms round-trip latency for AV.
- The system shall encrypt API keys/secrets in backend storage.
- The UI shall be responsive (mobile+desktop).
- The system shall handle at least 100 concurrent voice sessions.

***

### UI COMPONENT REQUIREMENTS (21st.dev, ShadCN, Tailwind)
- The system shall use 21st.dev UI components for all primary screens (calls to action, nav, session views, analytics dashboards, persona selection, forms, notifications).[12]
- The system shall use ShadCN UI for form fields, buttons, menus, if not present in 21st.dev.[13][14]
- The system shall style layouts via Tailwind CSS—never use CSS-in-JS or vanilla CSS.
- Where possible, use 21st.dev Accordions, Tabs, and Tables for analytics and history.
- All error, progress, and notification states shall use animated 21st.dev/Toast/Snackbar/Alert/Spinner components.

***

### FULL REQUIREMENTS MATRIX (for engineering & QA)

| ReqID   | Type        | Priority | Description                                                                                                                           | Acceptance Criteria                                                  |
|---------|-------------|----------|---------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------|
| FR-01   | Ubiquitous  | High     | The system shall be built with ReactJS (Vite), using Tailwind CSS, ShadCN, and 21st.dev components.                                   | All screens render; Components from 21st.dev are present throughout.|
| FR-02   | Ubiquitous  | High     | The backend shall use Node.js and PostgreSQL for session, user, and analytics data.                                                   | Data persists; API endpoints are stable and secure.                 |
| FR-03   | Ubiquitous  | High     | The system shall use LiveKit for real-time audio/video RTC.                                                                           | Low round-trip latency; Sessions stable for all users.              |
| FR-04   | Event       | High     | When a user kicks-off a session, system shall create and join LiveKit room and stream audio/video.                                    | No perceptible AV lag; Clean join/leave flows.                      |
| FR-05   | Event       | High     | When user speaks, system shall stream to NovaSonic for STT, LLM response, and TTS playback.                                          | Audio is transcribed, LLM-processed, and played instantly.          |
| FR-06   | Event       | Med      | When session ends, stats/history shall be stored in PostgreSQL; user can review past sessions.                                        | Completed sessions/metrics visible in dashboard.                    |
| FR-07   | State       | High     | While session active, show analytics/stats via 21st.dev tables, accordions, etc.                                                     | Analytics update in real time onscreen.                             |
| FR-08   | Ubiquitous  | High     | Settings page shall allow choosing model, entering keys (NovaSonic, custom), toggling persona, AV.                                   | Switching LLM and AV works instantly; error messages shown if bad.  |
| FR-09   | Optional    | Med      | Where video is enabled, show AV feeds side-by-side in 21st.dev grid or Hero components.                                               | Both feeds visible for user and AI persona.                         |
| FR-10   | State       | High     | While waiting for LLM response or session status, display loading/progress via 21st.dev Spinner/Toast/Alert.                         | Users never see blank screens; always get feedback UI.              |

***

### CRITICAL DOC REFERENCES (add to prompt for Cursor AI)

- **21st.dev UI library:** https://21st.dev/home[12]
- **Tailwind CSS official docs:** https://tailwindcss.com/docs[15]
- **ShadCN UI official docs:** https://ui.shadcn.com/docs[14]
- **ReactJS + Vite official guide:** https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Frameworks_libraries/React_getting_started[16]
- **LiveKit JS/RTC SDK:** https://docs.livekit.io/reference/client-sdk-js/[11]
- **AWS NovaSonic on Bedrock:** https://docs.pipecat.ai/server/services/s2s/aws , https://docs.livekit.io/agents/integrations/realtime/nova-sonic/[17][18]
- **Cursor PRD context/best practices:** https://cursor.com/docs/context/rules[19]

***

### PROMPT FINAL INSTRUCTIONS

Copy-paste this PRD section and all documentation links as references for Cursor AI or for engineering onboarding. Instruct agents and devs to always:
- Use 21st.dev components as first choice on all UI—not default elements or hand-made variants.
- Adhere strictly to referenced docs for Tailwind, ShadCN, LiveKit, NovaSonic, React, and PostgreSQL integration and troubleshooting.
- Any new UI/flow must meet both EARS requirement structure and acceptance criteria for bug-free implementation.

This will maximize engineering & AI success, reduce UX and styling surprises, and ensure correct full-stack+AI pipeline setup.[1][18][14][15][17][11][12]

[1](https://aws.amazon.com/blogs/machine-learning/deploy-a-full-stack-voice-ai-agent-with-amazon-nova-sonic/)
[2](https://www.assemblyai.com/blog/the-voice-ai-stack-for-building-agents)
[3](https://appinventiv.com/blog/how-to-build-an-ai-voice-agent/)
[4](https://www.uptech.team/blog/how-to-make-an-ai-voice-assistant)
[5](https://assemblyai.com/blog/building-ai-voice-agents-with-examples)
[6](https://www.biz4group.com/blog/how-to-build-an-ai-voice-agent)
[7](https://vapi.ai)
[8](https://dev.to/anmolbaranwal/i-built-and-deployed-a-voice-ai-agent-in-30-minutes-hpa)
[9](https://rasa.com/blog/how-to-make-an-ai-voice-assistant/)
[10](https://cognitiveclass.ai/courses/chatapp-powered-by-openai)
[11](https://docs.livekit.io/reference/client-sdk-js/)
[12](https://21st.dev/home)
[13](https://codeparrot.ai/blogs/shadcn-ui-for-beginners-the-ultimate-guide-and-step-by-step-tutorial)
[14](https://ui.shadcn.com/docs)
[15](https://tailwindcss.com/docs)
[16](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Frameworks_libraries/React_getting_started)
[17](https://docs.pipecat.ai/server/services/s2s/aws)
[18](https://docs.livekit.io/agents/integrations/realtime/nova-sonic/)
[19](https://cursor.com/docs/context/rules)