"""启动 VHFXNEX 桌面计时器。"""

import tkinter as tk

from timer_app.app import TimerApp


def main() -> None:
    root = tk.Tk()
    TimerApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
