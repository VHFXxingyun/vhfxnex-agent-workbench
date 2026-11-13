import unittest

from timer_app.engine import TimerEngine


class FakeClock:
    def __init__(self) -> None:
        self.now = 100.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class TimerEngineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.clock = FakeClock()
        self.timer = TimerEngine(10, self.clock)

    def test_counts_down_and_finishes_at_zero(self) -> None:
        self.assertTrue(self.timer.start())
        self.clock.advance(3.2)
        self.assertEqual(self.timer.tick(), 7)
        self.clock.advance(7)
        self.assertEqual(self.timer.tick(), 0)
        self.assertEqual(self.timer.state, "finished")

    def test_pause_and_resume_preserve_remaining_time(self) -> None:
        self.timer.start()
        self.clock.advance(4.1)
        self.assertTrue(self.timer.pause())
        self.assertEqual(self.timer.remaining, 6)
        self.clock.advance(20)
        self.assertEqual(self.timer.tick(), 6)
        self.assertTrue(self.timer.resume())
        self.clock.advance(6)
        self.timer.tick()
        self.assertEqual(self.timer.state, "finished")

    def test_reset_restores_configured_duration(self) -> None:
        self.timer.start()
        self.clock.advance(5)
        self.timer.tick()
        self.timer.reset()
        self.assertEqual((self.timer.state, self.timer.remaining), ("idle", 10))

    def test_running_timer_rejects_duration_changes(self) -> None:
        self.timer.start()
        with self.assertRaises(RuntimeError):
            self.timer.set_duration(25)

    def test_zero_duration_cannot_start(self) -> None:
        self.timer.set_duration(0)
        self.assertFalse(self.timer.start())
        self.assertEqual(self.timer.state, "finished")


if __name__ == "__main__":
    unittest.main()
