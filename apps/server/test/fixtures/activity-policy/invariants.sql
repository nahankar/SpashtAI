
INSERT INTO "User" (id,email,"updatedAt") VALUES ('u-test','test@example.com',now()),('other','other@example.com',now());
INSERT INTO "Preparation" (id,"userId",title,"updatedAt") VALUES ('j-test','u-test','Test journey',now());
INSERT INTO "Session" (id,"userId",module) VALUES ('fresh','u-test','elevate');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Session" WHERE id='fresh' AND "contextScope"='SESSION_ONLY') THEN RAISE EXCEPTION 'Fresh defaults failed'; END IF;
  BEGIN
    INSERT INTO "PreparationPractice" (id,"preparationId","sessionId") VALUES ('bad','j-test','fresh');
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'Invalid ownership was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Journey activity purpose, context and ownership must agree' THEN RAISE; END IF;
  END;
END $$;
BEGIN;
INSERT INTO "Session" (id,"userId",module,purpose,"contextScope") VALUES ('owned','u-test','elevate','INTERVIEW','JOURNEY');
INSERT INTO "PreparationPractice" (id,"preparationId","sessionId") VALUES ('good','j-test','owned');
COMMIT;
DO $$ BEGIN
  BEGIN
    UPDATE "Session" SET purpose='COMMUNICATION' WHERE id='owned';
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'Invalid purpose update was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Journey activity purpose, context and ownership must agree' THEN RAISE; END IF;
  END;
END $$;
INSERT INTO "PlatformFeatureFlag" (feature,label,"updatedAt") VALUES ('interviews','Interviews',now());
INSERT INTO "UserFeatureGrant" (id,"userId",feature) VALUES ('grant','u-test','interviews');
DELETE FROM "User" WHERE id='u-test';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "UserFeatureGrant" WHERE id='grant') THEN RAISE EXCEPTION 'Grant cascade failed'; END IF;
END $$;
