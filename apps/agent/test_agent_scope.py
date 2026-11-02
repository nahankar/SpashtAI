"""Organization voice callbacks echo the server-signed scope; Personal rooms never send one."""
import unittest

import agent_scope


class AgentScopeHeaderTests(unittest.TestCase):
    def tearDown(self):
        agent_scope.set_workspace_scope()

    def test_personal_room_sends_only_the_internal_token(self):
        agent_scope.set_workspace_scope({"sessionId": "s1"}, {})
        self.assertEqual(set(agent_scope.agent_headers()), {"x-internal-agent-token"})

    def test_room_scope_wins_and_is_forwarded(self):
        agent_scope.set_workspace_scope({"workspaceScope": " signed-room "}, {"workspaceScope": "signed-dispatch"})
        self.assertEqual(agent_scope.agent_headers()[agent_scope.WORKSPACE_SCOPE_HEADER], "signed-room")

    def test_dispatch_scope_is_the_fallback(self):
        agent_scope.set_workspace_scope({}, {"workspaceScope": "signed-dispatch"})
        self.assertEqual(agent_scope.workspace_scope(), "signed-dispatch")

    def test_a_new_job_never_inherits_the_previous_scope(self):
        agent_scope.set_workspace_scope({"workspaceScope": "org-a"})
        agent_scope.set_workspace_scope({"sessionId": "personal"})
        self.assertNotIn(agent_scope.WORKSPACE_SCOPE_HEADER, agent_scope.agent_headers())

    def test_non_string_values_are_ignored(self):
        agent_scope.set_workspace_scope({"workspaceScope": {"forged": True}}, None)
        self.assertEqual(agent_scope.workspace_scope(), "")


if __name__ == "__main__":
    unittest.main()
