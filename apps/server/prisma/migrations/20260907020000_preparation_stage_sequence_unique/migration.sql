-- Replace the non-unique (preparationId, sequence) index with a unique constraint
-- so two concurrent "add stage" requests cannot share a sequence number.
DROP INDEX "PreparationStage_preparationId_sequence_idx";

CREATE UNIQUE INDEX "PreparationStage_preparationId_sequence_key" ON "PreparationStage"("preparationId", "sequence");
