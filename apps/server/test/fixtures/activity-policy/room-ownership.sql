BEGIN;
INSERT INTO "User" (id,email,"updatedAt") VALUES ('room-user','room@example.com',now());
INSERT INTO "Session" (id,"userId",module) VALUES ('room-session','room-user','elevate');
INSERT INTO "SessionSegment" (id,"sessionId","segmentIndex","roomName","startedAt","updatedAt")
  VALUES ('room-segment','room-session',0,'shared-test-room',now(),now());
DO $$ BEGIN
  BEGIN
    INSERT INTO "SessionSegment" (id,"sessionId","segmentIndex","roomName","startedAt","updatedAt")
      VALUES ('room-conflict','room-session',1,'shared-test-room',now(),now());
    RAISE EXCEPTION 'Concurrent room ownership accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;
UPDATE "SessionSegment" SET "endedAt"=now() WHERE id='room-segment';
INSERT INTO "SessionSegment" (id,"sessionId","segmentIndex","roomName","startedAt","updatedAt")
  VALUES ('room-reused','room-session',1,'shared-test-room',now(),now());
ROLLBACK;
