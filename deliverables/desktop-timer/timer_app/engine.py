"""无界面倒计时状态机，使用单调时钟避免系统时间调整造成误差。"""

from collections.abc import Callable
from math import ceil
from time import monotonic


class TimerEngine:
    """支持设置、开始、暂停、继续、重置的单个倒计时。"""

    def __init__(self, duration: int = 300, clock: Callable[[], float] = monotonic) -> None:
        self._clock = clock
        self.duration = max(0, int(duration))
        self.remaining = self.duration
        self.state = "idle"
        self._deadline: float | None = None

    def set_duration(self, seconds: int) -> None:
        if self.state == "running":
            raise RuntimeError("计时运行中不能修改时长")
        self.duration = max(0, int(seconds))
        self.remaining = self.duration
        self.state = "idle"
        self._deadline = None

    def start(self) -> bool:
        if self.state == "running":
            return False
        if self.remaining <= 0:
            self.state = "finished"
            self._deadline = None
            return False
        self._deadline = self._clock() + self.remaining
        self.state = "running"
        return True

    def pause(self) -> bool:
        if self.state != "running":
            return False
        self.remaining = self._seconds_left()
        self._deadline = None
        self.state = "paused"
        return True

    def resume(self) -> bool:
        if self.state != "paused" or self.remaining <= 0:
            return False
        self._deadline = self._clock() + self.remaining
        self.state = "running"
        return True

    def reset(self) -> None:
        self.remaining = self.duration
        self._deadline = None
        self.state = "idle"

    def tick(self) -> int:
        if self.state != "running":
            return self.remaining
        self.remaining = self._seconds_left()
        if self.remaining <= 0:
            self.remaining = 0
            self._deadline = None
            self.state = "finished"
        return self.remaining

    def _seconds_left(self) -> int:
        if self._deadline is None:
            return self.remaining
        return max(0, ceil(self._deadline - self._clock()))
