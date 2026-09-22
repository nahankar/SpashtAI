from pathlib import Path
import unittest


class StartupEnvironmentOrderTest(unittest.TestCase):
    def test_dotenv_loads_before_signal_api_import(self):
        source = Path(__file__).with_name("main.py").read_text()

        self.assertLess(
            source.index("load_dotenv()"),
            source.index("from analytics.signal_api import start_signal_api"),
        )


if __name__ == "__main__":
    unittest.main()
