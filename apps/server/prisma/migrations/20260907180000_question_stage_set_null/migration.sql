-- Keep question memory on the journey when a stage is removed.
ALTER TABLE "InterviewQuestion" DROP CONSTRAINT "InterviewQuestion_stageId_fkey";

ALTER TABLE "InterviewQuestion" ADD CONSTRAINT "InterviewQuestion_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "PreparationStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
