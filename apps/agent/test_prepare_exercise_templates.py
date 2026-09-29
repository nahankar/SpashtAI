import unittest

from exercise_templates import get_exercise_instructions


class PrepareInterviewExerciseTests(unittest.TestCase):
    def test_interview_practice_has_a_structured_mock_interview_flow(self):
        context = {
            "skillSummaries": {},
            "replayInsights": None,
            "lastPracticeSummary": None,
            "elevateSessionCount": 0,
            "prepareJourney": {
                "companyName": "Acme",
                "roleTitle": "Senior Engineer",
                "stageName": "Technical",
                "actualQuestions": [{"stageName": "Phone screen", "questionText": "Describe a system you built."}],
                "practiceMemory": {
                    "recentPracticeQuestions": ["How would you diagnose a production incident?"],
                },
            },
        }

        instructions = get_exercise_instructions("interview_practice", coaching_context=context)

        self.assertIn('SESSION TYPE: Guided Practice — "Interview Practice"', instructions)
        self.assertIn("Ask one interview question", instructions)
        self.assertIn("Actual questions remembered from this journey", instructions)
        self.assertIn("QUESTIONS ALREADY USED IN PRIOR PRACTICE", instructions)
        self.assertIn("How would you diagnose a production incident?", instructions)
        self.assertIn("Do not repeat these questions", instructions)
        self.assertNotIn("HISTORY: You have NO record", instructions)
        self.assertEqual(instructions.count("INTERVIEW JOURNEY DATA"), 1)


if __name__ == "__main__":
    unittest.main()
