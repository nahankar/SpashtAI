-- Validate each selected value, not the combined display/storage string.
-- Legacy single-value runs remain valid; no historical run is rewritten.
CREATE FUNCTION public.valid_interview_selection(value TEXT, allowed TEXT[], maximum INTEGER, item_length INTEGER)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT cardinality(parts) BETWEEN 1 AND maximum
    AND cardinality(parts) = (SELECT count(DISTINCT item) FROM unnest(parts) item)
    AND NOT EXISTS (SELECT 1 FROM unnest(parts) item
      WHERE item <> btrim(item) OR char_length(item) NOT BETWEEN 1 AND item_length
        OR (cardinality(allowed) > 0 AND NOT item = ANY(allowed)))
  FROM (SELECT string_to_array(value, '|') AS parts) selected
$$;

ALTER TABLE "InterviewRun" DROP CONSTRAINT "InterviewRun_setup";
ALTER TABLE "InterviewRun" ADD CONSTRAINT "InterviewRun_setup" CHECK (
  namespace = 'automation-pilot'
  AND public.valid_interview_selection(track, ARRAY[]::TEXT[], 20, 160)
  AND public.valid_interview_selection("experienceBand", ARRAY['0-2','2-5','5-8','8+'], 4, 3)
  AND public.valid_interview_selection("startingDifficulty", ARRAY['Simple','Medium','Complex','Very Complex'], 4, 12)
  AND "durationMinutes" IN (5,10,15) AND "maxQuestions" = 8
);
