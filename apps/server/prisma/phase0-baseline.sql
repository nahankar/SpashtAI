-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."UserRole" AS ENUM ('USER', 'ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "public"."Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY');

-- CreateEnum
CREATE TYPE "public"."ActivityPurpose" AS ENUM ('COMMUNICATION', 'INTERVIEW', 'GOAL_PREPARATION');

-- CreateEnum
CREATE TYPE "public"."ContextScope" AS ENUM ('SESSION_ONLY', 'COMMUNICATION_PROFILE', 'JOURNEY', 'EXPLICIT_SOURCE');

-- CreateEnum
CREATE TYPE "public"."FeatureAudience" AS ENUM ('EVERYONE', 'SELECTED_USERS');

-- CreateEnum
CREATE TYPE "public"."PreparationType" AS ENUM ('INTERVIEW');

-- CreateEnum
CREATE TYPE "public"."PreparationStatus" AS ENUM ('ACTIVE', 'PAUSED', 'OFFERED', 'COMPLETED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "public"."PreparationStageType" AS ENUM ('APPLIED', 'RECRUITER', 'TECHNICAL', 'BEHAVIORAL', 'HIRING_MANAGER', 'CASE_ASSIGNMENT', 'LEADERSHIP', 'HR', 'OFFER', 'CUSTOM');

-- CreateEnum
CREATE TYPE "public"."PreparationStageStatus" AS ENUM ('UPCOMING', 'SCHEDULED', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "public"."InterviewQuestionSource" AS ENUM ('ACTUAL_INTERVIEW', 'PRACTICE', 'USER_ENTERED', 'AI_SUGGESTED');

-- CreateEnum
CREATE TYPE "public"."InterviewOutcome" AS ENUM ('PASSED', 'REJECTED', 'PENDING', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "public"."InterviewRating" AS ENUM ('VERY_POOR', 'POOR', 'FAIR', 'GOOD', 'EXCELLENT');

-- CreateEnum
CREATE TYPE "public"."UserFeedbackType" AS ENUM ('FEEDBACK', 'ISSUE', 'FEATURE_REQUEST');

-- CreateEnum
CREATE TYPE "public"."UserFeedbackStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'CONSIDERED', 'IMPLEMENTED', 'PARKED');

-- CreateEnum
CREATE TYPE "public"."FeedbackPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "googleId" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "verificationToken" TEXT,
    "resetPasswordToken" TEXT,
    "resetPasswordExpiry" TIMESTAMP(3),
    "firstName" TEXT,
    "lastName" TEXT,
    "avatar" TEXT,
    "phone" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "gender" "public"."Gender",
    "pincode" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "speakerAliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "role" "public"."UserRole" NOT NULL DEFAULT 'USER',
    "lastLoginAt" TIMESTAMP(3),
    "lastActiveAt" TIMESTAMP(3),
    "loginCount" INTEGER NOT NULL DEFAULT 0,
    "rewardPoints" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hideTranscriptText" BOOLEAN NOT NULL DEFAULT false,
    "hideTranscriptJsonExport" BOOLEAN NOT NULL DEFAULT false,
    "hideAudioDownload" BOOLEAN NOT NULL DEFAULT false,
    "enableTxtExport" BOOLEAN NOT NULL DEFAULT false,
    "enableJsonExport" BOOLEAN NOT NULL DEFAULT false,
    "enableAudioExport" BOOLEAN NOT NULL DEFAULT false,
    "enableReplayAudioUpload" BOOLEAN NOT NULL DEFAULT false,
    "enableReprocess" BOOLEAN NOT NULL DEFAULT false,
    "enablePro" BOOLEAN NOT NULL DEFAULT true,
    "enableUltra" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FeatureUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "sessionId" TEXT,
    "metadata" JSONB,
    "duration" INTEGER,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserActivity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource" TEXT,
    "resourceId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AdminAction" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetUserId" TEXT,
    "targetResource" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SystemMetrics" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "totalUsers" INTEGER NOT NULL,
    "activeUsers" INTEGER NOT NULL,
    "newUsers" INTEGER NOT NULL,
    "replayUploads" INTEGER NOT NULL,
    "elevateSessions" INTEGER NOT NULL,
    "totalMinutesAnalyzed" INTEGER NOT NULL,
    "avgResponseTime" DOUBLE PRECISION,
    "errorRate" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Preparation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "public"."PreparationType" NOT NULL DEFAULT 'INTERVIEW',
    "title" TEXT NOT NULL,
    "status" "public"."PreparationStatus" NOT NULL DEFAULT 'ACTIVE',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Preparation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InterviewPreparation" (
    "id" TEXT NOT NULL,
    "preparationId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "roleTitle" TEXT NOT NULL,
    "jobDescriptionText" TEXT,
    "interviewDate" TIMESTAMP(3),
    "resumeText" TEXT,
    "resumeLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewPreparation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PreparationStage" (
    "id" TEXT NOT NULL,
    "preparationId" TEXT NOT NULL,
    "type" "public"."PreparationStageType" NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "public"."PreparationStageStatus" NOT NULL DEFAULT 'UPCOMING',
    "scheduledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "interviewerName" TEXT,
    "interviewerRole" TEXT,
    "interviewerProfileText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreparationStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InterviewQuestion" (
    "id" TEXT NOT NULL,
    "preparationId" TEXT NOT NULL,
    "stageId" TEXT,
    "questionText" TEXT NOT NULL,
    "source" "public"."InterviewQuestionSource" NOT NULL DEFAULT 'ACTUAL_INTERVIEW',
    "category" TEXT,
    "topic" TEXT,
    "difficulty" TEXT,
    "notes" TEXT,
    "askedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StageReflection" (
    "id" TEXT NOT NULL,
    "preparationId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "rating" "public"."InterviewRating",
    "outcome" "public"."InterviewOutcome",
    "wentWell" TEXT,
    "difficulties" TEXT,
    "surprisedBy" TEXT,
    "feedbackReceived" TEXT,
    "nextRoundHints" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StageReflection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PreparationPractice" (
    "id" TEXT NOT NULL,
    "preparationId" TEXT NOT NULL,
    "stageId" TEXT,
    "sessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreparationPractice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PreparationRecording" (
    "id" TEXT NOT NULL,
    "preparationId" TEXT NOT NULL,
    "stageId" TEXT,
    "replaySessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreparationRecording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ReplayDeletion" (
    "id" TEXT NOT NULL,
    "replaySessionId" TEXT NOT NULL,
    "filePaths" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplayDeletion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "purpose" "public"."ActivityPurpose" NOT NULL DEFAULT 'COMMUNICATION',
    "contextScope" "public"."ContextScope" NOT NULL DEFAULT 'SESSION_ONLY',
    "communicationProfile" TEXT NOT NULL DEFAULT 'communication-v1',
    "configurationSnapshot" JSONB,
    "sessionName" TEXT,
    "focusArea" TEXT,
    "focusContext" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "sessionPointsAwarded" BOOLEAN NOT NULL DEFAULT false,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "retainedAt" TIMESTAMP(3),
    "progressPulseStatus" TEXT,
    "paceReconciliationStatus" TEXT,
    "paceReconciliationAttempts" INTEGER NOT NULL DEFAULT 0,
    "paceReconciliationError" TEXT,
    "nextPaceReconciliationAt" TIMESTAMP(3),
    "paceReconciliationLeaseId" TEXT,
    "paceReconciliationLeaseUntil" TIMESTAMP(3),
    "deliveryAlignmentStatus" TEXT DEFAULT 'pending',
    "deliveryAlignmentAttempts" INTEGER NOT NULL DEFAULT 0,
    "deliveryAlignmentNextAt" TIMESTAMP(3),
    "deliveryAlignmentError" TEXT,
    "deliveryAlignmentResult" JSONB,
    "discardedAt" TIMESTAMP(3),
    "deletionStatus" TEXT,
    "deletionAttempts" INTEGER NOT NULL DEFAULT 0,
    "deletionError" TEXT,
    "nextDeletionAttemptAt" TIMESTAMP(3),
    "deletionLeaseId" TEXT,
    "deletionLeaseUntil" TIMESTAMP(3),
    "recordingStartedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DeliveryAlignmentLease" (
    "id" TEXT NOT NULL,
    "owner" TEXT,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "DeliveryAlignmentLease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SessionTurn" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "segmentId" TEXT,
    "turnIndex" INTEGER NOT NULL,
    "localTurnIndex" INTEGER NOT NULL,
    "sequenceNo" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "audioStart" DOUBLE PRECISION,
    "audioEnd" DOUBLE PRECISION,
    "words" JSONB,
    "metrics" JSONB,
    "score" JSONB,
    "coachNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SessionSegment" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "segmentIndex" INTEGER NOT NULL,
    "roomName" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "recordingStartedAt" TIMESTAMP(3),
    "recordingDurationSec" DOUBLE PRECISION,
    "captureSettings" JSONB,
    "endedAt" TIMESTAMP(3),
    "activeDurationSec" INTEGER,
    "audioStatus" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SessionMetrics" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "totalLlmTokens" INTEGER NOT NULL DEFAULT 0,
    "totalLlmDuration" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgTtft" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalTtsDuration" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalTtsAudioDuration" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgTtsTtfb" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalEouDelay" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "conversationLatencyAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "userWpm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "userFillerCount" INTEGER NOT NULL DEFAULT 0,
    "userFillerRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "userAvgSentenceLength" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "userSpeakingTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "userVocabDiversity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "userResponseTimeAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "assistantWpm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "assistantFillerCount" INTEGER NOT NULL DEFAULT 0,
    "assistantFillerRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "assistantAvgSentenceLength" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "assistantSpeakingTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "assistantVocabDiversity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "assistantResponseTimeAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalTurns" INTEGER NOT NULL DEFAULT 0,
    "contentMetrics" JSONB,
    "deliveryMetrics" JSONB,
    "performanceInsights" JSONB,
    "processingStatus" JSONB,
    "skillScores" JSONB,
    "communicationSignals" JSONB,
    "coachingInsights" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SessionTranscript" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "conversationData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionTranscript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SessionRecording" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "segmentId" TEXT,
    "egressId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "duration" INTEGER NOT NULL DEFAULT 0,
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "recordingType" TEXT NOT NULL DEFAULT 'user',
    "contentHash" TEXT,
    "mimeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionRecording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ReplaySession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "public"."ActivityPurpose" NOT NULL DEFAULT 'COMMUNICATION',
    "contextScope" "public"."ContextScope" NOT NULL DEFAULT 'SESSION_ONLY',
    "communicationProfile" TEXT NOT NULL DEFAULT 'communication-v1',
    "configurationSnapshot" JSONB,
    "sessionName" TEXT,
    "meetingType" TEXT NOT NULL,
    "userRole" TEXT NOT NULL,
    "focusAreas" TEXT[],
    "meetingGoal" TEXT,
    "meetingDate" TIMESTAMP(3),
    "participantName" TEXT,
    "learnerSelection" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "exportCount" INTEGER NOT NULL DEFAULT 0,
    "progressPulseStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplaySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ReplayUpload" (
    "id" TEXT NOT NULL,
    "replaySessionId" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storedPath" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "duration" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReplayUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ReplayResult" (
    "id" TEXT NOT NULL,
    "replaySessionId" TEXT NOT NULL,
    "transcriptText" TEXT NOT NULL,
    "structuredTranscript" JSONB,
    "speakerCount" INTEGER NOT NULL DEFAULT 1,
    "transcriptionSource" TEXT NOT NULL,
    "deliveryEvidence" JSONB,
    "wordsPerMinute" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fillerWordCount" INTEGER NOT NULL DEFAULT 0,
    "fillerWordRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgSentenceLength" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vocabularyDiversity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalTurns" INTEGER NOT NULL DEFAULT 0,
    "speakingPercentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hedgingCount" INTEGER NOT NULL DEFAULT 0,
    "hedgingRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "interruptionCount" INTEGER NOT NULL DEFAULT 0,
    "longestMonologueSec" INTEGER NOT NULL DEFAULT 0,
    "questionsAsked" INTEGER NOT NULL DEFAULT 0,
    "repetitionRequests" INTEGER NOT NULL DEFAULT 0,
    "avgResponseTimeSec" DOUBLE PRECISION,
    "overallScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "clarityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "engagementScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "strengths" JSONB,
    "improvements" JSONB,
    "recommendations" JSONB,
    "contextSpecificFeedback" JSONB,
    "keyMoments" JSONB,
    "annotatedTranscript" JSONB,
    "skillScores" JSONB,
    "communicationSignals" JSONB,
    "coachingInsights" JSONB,
    "modelUsed" TEXT,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "processingTimeMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplayResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProgressPulse" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "skill" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "sessionId" TEXT,
    "metadata" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgressPulse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PlatformFeatureFlag" (
    "feature" TEXT NOT NULL,
    "audience" "public"."FeatureAudience" NOT NULL DEFAULT 'EVERYONE',
    "label" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "overlayComment" TEXT,
    "overlayPosition" TEXT NOT NULL DEFAULT 'center',
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "public"."UserFeatureGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "grantedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserFeatureGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AgentPrompt" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "content" TEXT NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "public"."VoiceConfig" (
    "id" TEXT NOT NULL,
    "backend" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "pipelineStt" TEXT,
    "pipelineLlm" TEXT,
    "pipelineTts" TEXT,
    "voiceName" TEXT,
    "sttProvider" TEXT,
    "ttsProvider" TEXT,
    "hushEnabled" BOOLEAN NOT NULL DEFAULT false,
    "sttBaseUrl" TEXT,
    "llmBaseUrl" TEXT,
    "ttsBaseUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AnalysisConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "replayModelId" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserFeedback" (
    "id" TEXT NOT NULL,
    "feedbackNumber" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "public"."UserFeedbackType" NOT NULL DEFAULT 'FEEDBACK',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" "public"."UserFeedbackStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "public"."FeedbackPriority",
    "pointsAwarded" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgedAt" TIMESTAMP(3),
    "sessionId" TEXT,
    "sessionUrl" TEXT,
    "sessionModule" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserFeedbackAttachment" (
    "id" TEXT NOT NULL,
    "feedbackId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storedPath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserFeedbackAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserFeedbackNote" (
    "id" TEXT NOT NULL,
    "feedbackId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserFeedbackNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PlatformTicker" (
    "id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformTicker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PlatformSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "signupsPaused" BOOLEAN NOT NULL DEFAULT false,
    "signupsPausedMessage" TEXT,
    "adminRateLimitBypass" BOOLEAN NOT NULL DEFAULT false,
    "rewardPointsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PricingSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "comingSoonText" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PricingPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceMonthly" DOUBLE PRECISION NOT NULL,
    "description" TEXT,
    "isPromoted" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PricingPlanFeature" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PricingPlanFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LegalDocument" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "LegalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CoachThread" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "preparationId" TEXT,
    "focusArea" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CoachTurn" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "kind" TEXT,
    "text" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CoachAction" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CoachHomeResultReceipt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachHomeResultReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "public"."User"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "User_verificationToken_key" ON "public"."User"("verificationToken");

-- CreateIndex
CREATE UNIQUE INDEX "User_resetPasswordToken_key" ON "public"."User"("resetPasswordToken");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "public"."User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "public"."User"("role");

-- CreateIndex
CREATE INDEX "FeatureUsage_userId_feature_timestamp_idx" ON "public"."FeatureUsage"("userId", "feature", "timestamp");

-- CreateIndex
CREATE INDEX "UserActivity_userId_timestamp_idx" ON "public"."UserActivity"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "AdminAction_adminId_timestamp_idx" ON "public"."AdminAction"("adminId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "SystemMetrics_date_key" ON "public"."SystemMetrics"("date");

-- CreateIndex
CREATE INDEX "SystemMetrics_date_idx" ON "public"."SystemMetrics"("date");

-- CreateIndex
CREATE INDEX "Preparation_userId_idx" ON "public"."Preparation"("userId");

-- CreateIndex
CREATE INDEX "Preparation_userId_status_idx" ON "public"."Preparation"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewPreparation_preparationId_key" ON "public"."InterviewPreparation"("preparationId");

-- CreateIndex
CREATE INDEX "PreparationStage_preparationId_status_idx" ON "public"."PreparationStage"("preparationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PreparationStage_preparationId_sequence_key" ON "public"."PreparationStage"("preparationId", "sequence");

-- CreateIndex
CREATE INDEX "InterviewQuestion_preparationId_idx" ON "public"."InterviewQuestion"("preparationId");

-- CreateIndex
CREATE INDEX "InterviewQuestion_preparationId_source_idx" ON "public"."InterviewQuestion"("preparationId", "source");

-- CreateIndex
CREATE INDEX "InterviewQuestion_stageId_idx" ON "public"."InterviewQuestion"("stageId");

-- CreateIndex
CREATE UNIQUE INDEX "StageReflection_stageId_key" ON "public"."StageReflection"("stageId");

-- CreateIndex
CREATE INDEX "StageReflection_preparationId_idx" ON "public"."StageReflection"("preparationId");

-- CreateIndex
CREATE UNIQUE INDEX "PreparationPractice_sessionId_key" ON "public"."PreparationPractice"("sessionId");

-- CreateIndex
CREATE INDEX "PreparationPractice_preparationId_createdAt_idx" ON "public"."PreparationPractice"("preparationId", "createdAt");

-- CreateIndex
CREATE INDEX "PreparationPractice_stageId_idx" ON "public"."PreparationPractice"("stageId");

-- CreateIndex
CREATE UNIQUE INDEX "PreparationRecording_replaySessionId_key" ON "public"."PreparationRecording"("replaySessionId");

-- CreateIndex
CREATE INDEX "PreparationRecording_preparationId_createdAt_idx" ON "public"."PreparationRecording"("preparationId", "createdAt");

-- CreateIndex
CREATE INDEX "PreparationRecording_stageId_idx" ON "public"."PreparationRecording"("stageId");

-- CreateIndex
CREATE UNIQUE INDEX "ReplayDeletion_replaySessionId_key" ON "public"."ReplayDeletion"("replaySessionId");

-- CreateIndex
CREATE INDEX "ReplayDeletion_status_nextAttemptAt_idx" ON "public"."ReplayDeletion"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "Session_userId_startedAt_idx" ON "public"."Session"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "Session_userId_module_endedAt_idx" ON "public"."Session"("userId", "module", "endedAt");

-- CreateIndex
CREATE INDEX "Session_userId_retainedAt_idx" ON "public"."Session"("userId", "retainedAt");

-- CreateIndex
CREATE INDEX "Session_discardedAt_nextDeletionAttemptAt_idx" ON "public"."Session"("discardedAt", "nextDeletionAttemptAt");

-- CreateIndex
CREATE INDEX "Session_discardedAt_deletionLeaseUntil_nextDeletionAttemptA_idx" ON "public"."Session"("discardedAt", "deletionLeaseUntil", "nextDeletionAttemptAt");

-- CreateIndex
CREATE INDEX "Session_paceReconciliationStatus_nextPaceReconciliationAt_idx" ON "public"."Session"("paceReconciliationStatus", "nextPaceReconciliationAt");

-- CreateIndex
CREATE INDEX "Session_paceReconciliationStatus_paceReconciliationLeaseUnt_idx" ON "public"."Session"("paceReconciliationStatus", "paceReconciliationLeaseUntil");

-- CreateIndex
CREATE INDEX "Session_deliveryAlignmentStatus_deliveryAlignmentNextAt_idx" ON "public"."Session"("deliveryAlignmentStatus", "deliveryAlignmentNextAt");

-- CreateIndex
CREATE INDEX "Session_userId_purpose_startedAt_idx" ON "public"."Session"("userId", "purpose", "startedAt");

-- CreateIndex
CREATE INDEX "SessionTurn_sessionId_idx" ON "public"."SessionTurn"("sessionId");

-- CreateIndex
CREATE INDEX "SessionTurn_segmentId_idx" ON "public"."SessionTurn"("segmentId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionTurn_sessionId_turnIndex_key" ON "public"."SessionTurn"("sessionId", "turnIndex");

-- CreateIndex
CREATE UNIQUE INDEX "SessionTurn_sessionId_sequenceNo_key" ON "public"."SessionTurn"("sessionId", "sequenceNo");

-- CreateIndex
CREATE UNIQUE INDEX "SessionTurn_segmentId_localTurnIndex_key" ON "public"."SessionTurn"("segmentId", "localTurnIndex");

-- CreateIndex
CREATE INDEX "SessionSegment_sessionId_startedAt_idx" ON "public"."SessionSegment"("sessionId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SessionSegment_sessionId_segmentIndex_key" ON "public"."SessionSegment"("sessionId", "segmentIndex");

-- CreateIndex
CREATE UNIQUE INDEX "SessionMetrics_sessionId_key" ON "public"."SessionMetrics"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionTranscript_sessionId_key" ON "public"."SessionTranscript"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionRecording_segmentId_key" ON "public"."SessionRecording"("segmentId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionRecording_egressId_key" ON "public"."SessionRecording"("egressId");

-- CreateIndex
CREATE INDEX "ReplaySession_userId_createdAt_idx" ON "public"."ReplaySession"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ReplaySession_userId_status_createdAt_idx" ON "public"."ReplaySession"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ReplaySession_userId_purpose_createdAt_idx" ON "public"."ReplaySession"("userId", "purpose", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReplayResult_replaySessionId_key" ON "public"."ReplayResult"("replaySessionId");

-- CreateIndex
CREATE INDEX "ProgressPulse_userId_skill_recordedAt_idx" ON "public"."ProgressPulse"("userId", "skill", "recordedAt");

-- CreateIndex
CREATE INDEX "ProgressPulse_userId_recordedAt_idx" ON "public"."ProgressPulse"("userId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformFeatureFlag_feature_key" ON "public"."PlatformFeatureFlag"("feature");

-- CreateIndex
CREATE UNIQUE INDEX "UserFeatureGrant_userId_feature_key" ON "public"."UserFeatureGrant"("userId", "feature");

-- CreateIndex
CREATE UNIQUE INDEX "AgentPrompt_key_key" ON "public"."AgentPrompt"("key");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceConfig_backend_key" ON "public"."VoiceConfig"("backend");

-- CreateIndex
CREATE UNIQUE INDEX "UserFeedback_feedbackNumber_key" ON "public"."UserFeedback"("feedbackNumber");

-- CreateIndex
CREATE INDEX "UserFeedback_userId_createdAt_idx" ON "public"."UserFeedback"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UserFeedback_status_idx" ON "public"."UserFeedback"("status");

-- CreateIndex
CREATE INDEX "UserFeedback_status_priority_idx" ON "public"."UserFeedback"("status", "priority");

-- CreateIndex
CREATE INDEX "UserFeedback_sessionId_idx" ON "public"."UserFeedback"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "LegalDocument_slug_key" ON "public"."LegalDocument"("slug");

-- CreateIndex
CREATE INDEX "CoachThread_userId_updatedAt_idx" ON "public"."CoachThread"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "CoachThread_userId_status_idx" ON "public"."CoachThread"("userId", "status");

-- CreateIndex
CREATE INDEX "CoachThread_userId_status_updatedAt_idx" ON "public"."CoachThread"("userId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "CoachThread_preparationId_idx" ON "public"."CoachThread"("preparationId");

-- CreateIndex
CREATE INDEX "CoachThread_userId_focusArea_idx" ON "public"."CoachThread"("userId", "focusArea");

-- CreateIndex
CREATE INDEX "CoachTurn_threadId_createdAt_idx" ON "public"."CoachTurn"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "CoachAction_threadId_createdAt_idx" ON "public"."CoachAction"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "CoachAction_targetId_idx" ON "public"."CoachAction"("targetId");

-- CreateIndex
CREATE INDEX "CoachHomeResultReceipt_userId_seenAt_idx" ON "public"."CoachHomeResultReceipt"("userId", "seenAt");

-- CreateIndex
CREATE UNIQUE INDEX "CoachHomeResultReceipt_userId_module_targetId_key" ON "public"."CoachHomeResultReceipt"("userId", "module", "targetId");

-- AddForeignKey
ALTER TABLE "public"."FeatureUsage" ADD CONSTRAINT "FeatureUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserActivity" ADD CONSTRAINT "UserActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Preparation" ADD CONSTRAINT "Preparation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InterviewPreparation" ADD CONSTRAINT "InterviewPreparation_preparationId_fkey" FOREIGN KEY ("preparationId") REFERENCES "public"."Preparation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PreparationStage" ADD CONSTRAINT "PreparationStage_preparationId_fkey" FOREIGN KEY ("preparationId") REFERENCES "public"."Preparation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InterviewQuestion" ADD CONSTRAINT "InterviewQuestion_preparationId_fkey" FOREIGN KEY ("preparationId") REFERENCES "public"."Preparation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InterviewQuestion" ADD CONSTRAINT "InterviewQuestion_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "public"."PreparationStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StageReflection" ADD CONSTRAINT "StageReflection_preparationId_fkey" FOREIGN KEY ("preparationId") REFERENCES "public"."Preparation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StageReflection" ADD CONSTRAINT "StageReflection_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "public"."PreparationStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PreparationPractice" ADD CONSTRAINT "PreparationPractice_preparationId_fkey" FOREIGN KEY ("preparationId") REFERENCES "public"."Preparation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PreparationPractice" ADD CONSTRAINT "PreparationPractice_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "public"."PreparationStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PreparationPractice" ADD CONSTRAINT "PreparationPractice_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PreparationRecording" ADD CONSTRAINT "PreparationRecording_preparationId_fkey" FOREIGN KEY ("preparationId") REFERENCES "public"."Preparation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PreparationRecording" ADD CONSTRAINT "PreparationRecording_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "public"."PreparationStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PreparationRecording" ADD CONSTRAINT "PreparationRecording_replaySessionId_fkey" FOREIGN KEY ("replaySessionId") REFERENCES "public"."ReplaySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SessionTurn" ADD CONSTRAINT "SessionTurn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SessionTurn" ADD CONSTRAINT "SessionTurn_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "public"."SessionSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SessionSegment" ADD CONSTRAINT "SessionSegment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SessionMetrics" ADD CONSTRAINT "SessionMetrics_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SessionTranscript" ADD CONSTRAINT "SessionTranscript_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SessionRecording" ADD CONSTRAINT "SessionRecording_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SessionRecording" ADD CONSTRAINT "SessionRecording_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "public"."SessionSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReplaySession" ADD CONSTRAINT "ReplaySession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReplayUpload" ADD CONSTRAINT "ReplayUpload_replaySessionId_fkey" FOREIGN KEY ("replaySessionId") REFERENCES "public"."ReplaySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReplayResult" ADD CONSTRAINT "ReplayResult_replaySessionId_fkey" FOREIGN KEY ("replaySessionId") REFERENCES "public"."ReplaySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProgressPulse" ADD CONSTRAINT "ProgressPulse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserFeatureGrant" ADD CONSTRAINT "UserFeatureGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserFeatureGrant" ADD CONSTRAINT "UserFeatureGrant_feature_fkey" FOREIGN KEY ("feature") REFERENCES "public"."PlatformFeatureFlag"("feature") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserFeedback" ADD CONSTRAINT "UserFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserFeedbackAttachment" ADD CONSTRAINT "UserFeedbackAttachment_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "public"."UserFeedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserFeedbackNote" ADD CONSTRAINT "UserFeedbackNote_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "public"."UserFeedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PricingPlanFeature" ADD CONSTRAINT "PricingPlanFeature_planId_fkey" FOREIGN KEY ("planId") REFERENCES "public"."PricingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CoachThread" ADD CONSTRAINT "CoachThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CoachThread" ADD CONSTRAINT "CoachThread_preparationId_fkey" FOREIGN KEY ("preparationId") REFERENCES "public"."Preparation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CoachTurn" ADD CONSTRAINT "CoachTurn_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "public"."CoachThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CoachAction" ADD CONSTRAINT "CoachAction_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "public"."CoachThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CoachHomeResultReceipt" ADD CONSTRAINT "CoachHomeResultReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ownership constraints also used by the incremental upgrade.
CREATE UNIQUE INDEX "SessionSegment_active_roomName_key" ON "SessionSegment" ("roomName") WHERE "endedAt" IS NULL;
CREATE FUNCTION check_activity_journey_policy() RETURNS trigger AS $$
DECLARE
  live_id TEXT;
  replay_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'Session' THEN live_id := NEW.id;
  ELSIF TG_TABLE_NAME = 'ReplaySession' THEN replay_id := NEW.id;
  ELSIF TG_TABLE_NAME = 'PreparationPractice' THEN live_id := NEW."sessionId";
  ELSE replay_id := NEW."replaySessionId";
  END IF;
  IF EXISTS (SELECT 1 FROM "PreparationPractice" p JOIN "Session" s ON s.id=p."sessionId"
    JOIN "Preparation" j ON j.id=p."preparationId"
    WHERE s.id=live_id AND (s."purpose" <> 'INTERVIEW' OR s."contextScope" <> 'JOURNEY' OR s."userId" <> j."userId"))
    OR EXISTS (SELECT 1 FROM "PreparationRecording" p JOIN "ReplaySession" s ON s.id=p."replaySessionId"
    JOIN "Preparation" j ON j.id=p."preparationId"
    WHERE s.id=replay_id AND (s."purpose" <> 'INTERVIEW' OR s."contextScope" <> 'JOURNEY' OR s."userId" <> j."userId")) THEN
    RAISE EXCEPTION 'Journey activity purpose, context and ownership must agree';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER "Session_journey_policy" AFTER INSERT OR UPDATE OF "purpose", "contextScope", "userId" ON "Session"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_activity_journey_policy();
CREATE CONSTRAINT TRIGGER "ReplaySession_journey_policy" AFTER INSERT OR UPDATE OF "purpose", "contextScope", "userId" ON "ReplaySession"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_activity_journey_policy();
CREATE CONSTRAINT TRIGGER "PreparationPractice_activity_policy" AFTER INSERT OR UPDATE ON "PreparationPractice"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_activity_journey_policy();
CREATE CONSTRAINT TRIGGER "PreparationRecording_activity_policy" AFTER INSERT OR UPDATE ON "PreparationRecording"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_activity_journey_policy();
