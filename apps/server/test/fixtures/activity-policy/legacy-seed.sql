INSERT INTO "User" (id,email,"updatedAt") VALUES ('legacy-user','legacy@example.com',now());
INSERT INTO "Preparation" (id,"userId",title,"updatedAt") VALUES ('legacy-journey','legacy-user','Existing interview',now());
INSERT INTO "Session" (id,"userId",module) VALUES ('legacy-profile','legacy-user','elevate'),('legacy-owned','legacy-user','elevate');
INSERT INTO "PreparationPractice" (id,"preparationId","sessionId") VALUES ('legacy-practice','legacy-journey','legacy-owned');
INSERT INTO "ReplaySession" (id,"userId","meetingType","userRole","focusAreas","updatedAt") VALUES ('legacy-replay','legacy-user','Interview','Candidate',ARRAY[]::text[],now());
INSERT INTO "PreparationRecording" (id,"preparationId","replaySessionId") VALUES ('legacy-recording','legacy-journey','legacy-replay');
