"""Tkinter 桌面倒计时界面。"""

from __future__ import annotations

import json
import math
import os
import sys
import tkinter as tk
from pathlib import Path
from tkinter import messagebox, ttk

from timer_app.engine import TimerEngine


COLORS = {
    "background": "#0d1014",
    "panel": "#151a20",
    "panel_light": "#1d242c",
    "border": "#2a333d",
    "text": "#f3f5f7",
    "muted": "#8e9aa7",
    "accent": "#c5f17a",
    "accent_text": "#18200d",
    "violet": "#c3a5ff",
}
PRESETS = ((5, "Quick"), (15, "Reset"), (25, "Focus"), (45, "Deep work"))


def settings_path() -> Path:
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return base / "VHFXNEX Timer" / "settings.json"


class TimerApp:
    """包含时长设置、预设、快捷键、置顶和提示音的桌面计时器。"""

    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("VHFXNEX Timer")
        self.root.configure(bg=COLORS["background"])
        self.root.minsize(760, 600)
        self.root.geometry("980x720")
        self.settings = self._load_settings()
        initial = max(1, int(self.settings.get("duration", 25 * 60)))
        self.engine = TimerEngine(initial)
        self.minutes = tk.StringVar(value=f"{initial // 60:02d}")
        self.seconds = tk.StringVar(value=f"{initial % 60:02d}")
        self.status = tk.StringVar(value="准备就绪")
        self.sound_enabled = tk.BooleanVar(value=self.settings.get("sound", True))
        self.always_on_top = tk.BooleanVar(value=self.settings.get("always_on_top", False))
        self._last_state = self.engine.state
        self._build_styles()
        self._build_layout()
        self._apply_topmost()
        self.root.bind("<space>", self._space_shortcut)
        self.root.bind("<KeyPress-r>", lambda _event: self.reset())
        self.root.bind("<KeyPress-R>", lambda _event: self.reset())
        self.root.protocol("WM_DELETE_WINDOW", self._close)
        self._draw_clock(self.engine.remaining)
        self._tick()

    def _load_settings(self) -> dict[str, object]:
        try:
            return json.loads(settings_path().read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}

    def _save_settings(self) -> None:
        path = settings_path()
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            payload = {
                "duration": self.engine.duration,
                "sound": bool(self.sound_enabled.get()),
                "always_on_top": bool(self.always_on_top.get()),
            }
            path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        except OSError as error:
            messagebox.showwarning("设置未保存", f"无法保存偏好设置：{error}", parent=self.root)

    def _build_styles(self) -> None:
        style = ttk.Style(self.root)
        style.theme_use("clam")
        style.configure(
            "Timer.TSpinbox",
            fieldbackground=COLORS["panel_light"],
            background=COLORS["panel_light"],
            foreground=COLORS["text"],
            arrowcolor=COLORS["muted"],
            bordercolor=COLORS["border"],
            insertcolor=COLORS["text"],
            padding=(10, 8),
            font=("Segoe UI", 18, "bold"),
        )

    def _build_layout(self) -> None:
        shell = tk.Frame(self.root, bg=COLORS["background"], padx=30, pady=24)
        shell.pack(fill="both", expand=True)

        header = tk.Frame(shell, bg=COLORS["background"])
        header.pack(fill="x", pady=(0, 22))
        brand = tk.Frame(header, bg=COLORS["background"])
        brand.pack(side="left")
        mark = tk.Canvas(brand, width=38, height=38, bg=COLORS["background"], highlightthickness=0)
        mark.pack(side="left", padx=(0, 10))
        mark.create_oval(3, 3, 35, 35, outline=COLORS["accent"], width=2)
        mark.create_line(12, 24, 19, 11, 26, 24, fill=COLORS["violet"], width=3, smooth=True)
        wordmark = tk.Frame(brand, bg=COLORS["background"])
        wordmark.pack(side="left")
        self._label(wordmark, "VHFXNEX", 12, "bold", COLORS["text"]).pack(anchor="w")
        self._label(wordmark, "FOCUS TIMER  /  01", 8, "bold", COLORS["muted"]).pack(anchor="w", pady=(2, 0))
        self._label(header, "本地运行 · 无需联网", 9, "normal", COLORS["muted"]).pack(side="right", pady=10)

        intro = tk.Frame(shell, bg=COLORS["background"])
        intro.pack(fill="x", pady=(0, 18))
        self._label(intro, "把注意力，留给眼前这一件事。", 21, "bold", COLORS["text"]).pack(anchor="w")
        self._label(intro, "设置一段专注时间。剩下的交给计时器。", 10, "normal", COLORS["muted"]).pack(anchor="w", pady=(7, 0))

        body = tk.Frame(shell, bg=COLORS["background"])
        body.pack(fill="both", expand=True)
        body.grid_columnconfigure(0, weight=7, minsize=400)
        body.grid_columnconfigure(1, weight=4, minsize=250)
        body.grid_rowconfigure(0, weight=1)

        self._build_clock_panel(body)
        self._build_controls_panel(body)

        footer = tk.Frame(shell, bg=COLORS["background"])
        footer.pack(fill="x", pady=(16, 0))
        self._label(footer, "SPACE 开始 / 暂停     R 重置", 9, "normal", COLORS["muted"]).pack(side="left")
        self._label(footer, "VHFXNEX  ·  VERSION 1.0", 8, "bold", COLORS["muted"]).pack(side="right")

    def _build_clock_panel(self, parent: tk.Widget) -> None:
        panel = tk.Frame(parent, bg=COLORS["panel"], highlightbackground=COLORS["border"], highlightthickness=1)
        panel.grid(row=0, column=0, sticky="nsew", padx=(0, 12))
        panel.grid_rowconfigure(1, weight=1)
        self._label(panel, "专注计时", 10, "bold", COLORS["muted"]).pack(anchor="w", padx=22, pady=(20, 0))

        clock_area = tk.Frame(panel, bg=COLORS["panel"])
        clock_area.pack(fill="both", expand=True, padx=10, pady=8)
        self.canvas = tk.Canvas(clock_area, width=330, height=330, bg=COLORS["panel"], highlightthickness=0)
        self.canvas.pack(expand=True)

        status_row = tk.Frame(panel, bg=COLORS["panel"])
        status_row.pack(fill="x", padx=22, pady=(0, 20))
        dot = tk.Canvas(status_row, width=10, height=10, bg=COLORS["panel"], highlightthickness=0)
        dot.pack(side="left", padx=(0, 8))
        dot.create_oval(2, 2, 8, 8, fill=COLORS["accent"], outline="")
        self._label(status_row, self.status, 10, "normal", COLORS["muted"]).pack(side="left")

    def _build_controls_panel(self, parent: tk.Widget) -> None:
        panel = tk.Frame(parent, bg=COLORS["panel"], highlightbackground=COLORS["border"], highlightthickness=1, padx=19, pady=20)
        panel.grid(row=0, column=1, sticky="nsew", padx=(12, 0))
        self._label(panel, "SESSION SETUP", 8, "bold", COLORS["violet"]).pack(anchor="w")
        self._label(panel, "设置时长", 14, "bold", COLORS["text"]).pack(anchor="w", pady=(8, 3))
        self._label(panel, "可自定义，也可选择常用时长", 9, "normal", COLORS["muted"]).pack(anchor="w")

        fields = tk.Frame(panel, bg=COLORS["panel"])
        fields.pack(fill="x", pady=(18, 8))
        minute_box = ttk.Spinbox(fields, from_=0, to=999, width=4, textvariable=self.minutes, format="%02.0f", style="Timer.TSpinbox", justify="center", command=self._apply_custom_duration)
        minute_box.pack(side="left", fill="x", expand=True)
        self._label(fields, ":", 20, "bold", COLORS["muted"]).pack(side="left", padx=6)
        second_box = ttk.Spinbox(fields, from_=0, to=59, width=3, textvariable=self.seconds, format="%02.0f", style="Timer.TSpinbox", justify="center", command=self._apply_custom_duration)
        second_box.pack(side="left", fill="x", expand=True)
        self._label(panel, "分钟                         秒", 8, "normal", COLORS["muted"]).pack(anchor="w")
        self._button(panel, "应用自定义时长", self._apply_custom_duration, primary=False).pack(fill="x", pady=(10, 20))

        self._label(panel, "快速选择", 10, "bold", COLORS["text"]).pack(anchor="w", pady=(0, 9))
        presets = tk.Frame(panel, bg=COLORS["panel"])
        presets.pack(fill="x")
        for index, (minutes, label) in enumerate(PRESETS):
            button = self._button(presets, f"{minutes:02d}  {label}", lambda value=minutes: self.set_preset(value), primary=False, compact=True)
            button.grid(row=index // 2, column=index % 2, sticky="ew", padx=(0 if index % 2 == 0 else 5, 5 if index % 2 == 0 else 0), pady=4)
        presets.grid_columnconfigure(0, weight=1)
        presets.grid_columnconfigure(1, weight=1)

        separator = tk.Frame(panel, bg=COLORS["border"], height=1)
        separator.pack(fill="x", pady=17)
        self._label(panel, "运行选项", 10, "bold", COLORS["text"]).pack(anchor="w", pady=(0, 8))
        self._checkbutton(panel, "完成时播放提示音", self.sound_enabled).pack(anchor="w", pady=4)
        self._checkbutton(panel, "窗口始终置顶", self.always_on_top, self._apply_topmost).pack(anchor="w", pady=4)

        actions = tk.Frame(panel, bg=COLORS["panel"])
        actions.pack(fill="x", side="bottom", pady=(18, 0))
        self.start_button = self._button(actions, "开始专注  ·  SPACE", self.start_or_pause, primary=True)
        self.start_button.pack(fill="x")
        self._button(actions, "重置计时  ·  R", self.reset, primary=False).pack(fill="x", pady=(8, 0))

    def _label(self, parent: tk.Widget, text: str | tk.StringVar, size: int, weight: str, color: str) -> tk.Label:
        return tk.Label(parent, textvariable=text if isinstance(text, tk.StringVar) else None, text=text if not isinstance(text, tk.StringVar) else None, font=("Segoe UI", size, weight), fg=color, bg=parent.cget("bg"), anchor="w")

    def _button(self, parent: tk.Widget, text: str, command, primary: bool, compact: bool = False) -> tk.Button:
        background = COLORS["accent"] if primary else COLORS["panel_light"]
        foreground = COLORS["accent_text"] if primary else COLORS["text"]
        button = tk.Button(parent, text=text, command=command, font=("Segoe UI", 9 if compact else 10, "bold"), fg=foreground, bg=background, activeforeground=foreground, activebackground=background, relief="flat", bd=0, cursor="hand2", padx=10 if compact else 12, pady=7 if compact else 10, highlightthickness=1, highlightbackground=background if primary else COLORS["border"], highlightcolor=COLORS["violet"])
        button.bind("<Enter>", lambda _event: button.configure(bg=COLORS["violet"] if primary else "#29323c"))
        button.bind("<Leave>", lambda _event: button.configure(bg=background))
        return button

    def _checkbutton(self, parent: tk.Widget, label: str, variable: tk.BooleanVar, command=None) -> tk.Checkbutton:
        return tk.Checkbutton(parent, text=label, variable=variable, command=command, font=("Segoe UI", 9), fg=COLORS["muted"], bg=COLORS["panel"], activeforeground=COLORS["text"], activebackground=COLORS["panel"], selectcolor=COLORS["panel_light"], cursor="hand2", bd=0, highlightthickness=0)

    def _input_duration(self) -> int | None:
        try:
            minutes = int(self.minutes.get() or "0")
            seconds = int(self.seconds.get() or "0")
            if minutes < 0 or seconds < 0 or seconds > 59:
                return None
            duration = minutes * 60 + seconds
            return duration if duration > 0 else None
        except ValueError:
            return None

    def _apply_custom_duration(self) -> bool:
        if self.engine.state == "running":
            self._show_notice("请先暂停或重置，再修改时长。")
            self._sync_inputs(self.engine.duration)
            return False
        duration = self._input_duration()
        if duration is None:
            self._show_notice("请输入有效时长：分钟大于等于 0，秒数为 0–59，且总时长不能为 0。")
            self._sync_inputs(self.engine.duration)
            return False
        self.engine.set_duration(duration)
        self.status.set("时长已更新，准备开始")
        self._draw_clock(duration)
        self._save_settings()
        return True

    def set_preset(self, minutes: int) -> None:
        if self.engine.state == "running":
            self._show_notice("计时运行中，请先暂停或重置。")
            return
        self.engine.set_duration(minutes * 60)
        self._sync_inputs(minutes * 60)
        self.status.set(f"已选择 {minutes} 分钟专注")
        self._draw_clock(self.engine.remaining)
        self._save_settings()

    def start_or_pause(self) -> None:
        if self.engine.state == "running":
            self.engine.pause()
            self.status.set("已暂停 · 准备好后继续")
        elif self.engine.state == "paused":
            self.engine.resume()
            self.status.set("专注进行中")
        elif self.engine.state == "finished":
            self.engine.reset()
            self.engine.start()
            self.status.set("新一轮专注开始")
        else:
            if self._input_duration() != self.engine.duration and not self._apply_custom_duration():
                return
            if self.engine.duration <= 0:
                if not self._apply_custom_duration():
                    return
            self.engine.start()
            self.status.set("专注进行中")
        self._update_start_button()
        self._draw_clock(self.engine.tick())

    def reset(self) -> None:
        self.engine.reset()
        self.status.set("计时已重置 · 准备就绪")
        self._update_start_button()
        self._draw_clock(self.engine.remaining)

    def _tick(self) -> None:
        remaining = self.engine.tick()
        self._draw_clock(remaining)
        if self.engine.state != self._last_state:
            if self.engine.state == "finished":
                self.status.set("时间到 · 这一轮专注完成")
                if self.sound_enabled.get():
                    self.root.bell()
                    self.root.after(220, self.root.bell)
                    self.root.after(440, self.root.bell)
                self._show_notice("本轮专注结束。起来活动一下，再决定下一步。")
            self._last_state = self.engine.state
            self._update_start_button()
        self.root.after(200, self._tick)

    def _draw_clock(self, remaining: int) -> None:
        self.canvas.delete("all")
        width = max(250, self.canvas.winfo_width())
        height = max(250, self.canvas.winfo_height())
        side = min(width, height) - 34
        left, top = (width - side) / 2, (height - side) / 2
        right, bottom = left + side, top + side
        self.canvas.create_oval(left, top, right, bottom, outline=COLORS["panel_light"], width=13)
        if self.engine.duration > 0:
            progress = max(0, min(1, remaining / self.engine.duration))
            self.canvas.create_arc(
                left,
                top,
                right,
                bottom,
                start=90,
                extent=-360 * progress,
                style="arc",
                outline=COLORS["accent"],
                width=13,
            )
            if 0.001 < progress < 0.999:
                radius = side / 2 - 6.5
                center_x, center_y = width / 2, height / 2
                start_x, start_y = center_x, center_y - radius
                end_angle = math.radians(90 - 360 * progress)
                end_x = center_x + radius * math.cos(end_angle)
                end_y = center_y - radius * math.sin(end_angle)
                for cap_x, cap_y in ((start_x, start_y), (end_x, end_y)):
                    self.canvas.create_oval(
                        cap_x - 6.5,
                        cap_y - 6.5,
                        cap_x + 6.5,
                        cap_y + 6.5,
                        fill=COLORS["accent"],
                        outline="",
                    )
        minutes, seconds = divmod(max(0, remaining), 60)
        self.canvas.create_text(width / 2, height / 2 - 8, text=f"{minutes:02d}:{seconds:02d}", fill=COLORS["text"], font=("Segoe UI", max(29, int(side * 0.16)), "bold"))
        self.canvas.create_text(width / 2, height / 2 + side * 0.17, text=self._clock_caption(), fill=COLORS["muted"], font=("Segoe UI", 9, "bold"))

    def _clock_caption(self) -> str:
        return {
            "idle": "READY WHEN YOU ARE",
            "running": "FOCUS SESSION IN PROGRESS",
            "paused": "PAUSED  ·  TAKE YOUR TIME",
            "finished": "SESSION COMPLETE  ·  WELL DONE",
        }.get(self.engine.state, "READY WHEN YOU ARE")

    def _show_notice(self, text: str) -> None:
        self.status.set(text)

    def _sync_inputs(self, duration: int) -> None:
        minutes, seconds = divmod(duration, 60)
        self.minutes.set(f"{minutes:02d}")
        self.seconds.set(f"{seconds:02d}")

    def _update_start_button(self) -> None:
        text = "暂停专注  ·  SPACE" if self.engine.state == "running" else "继续专注  ·  SPACE" if self.engine.state == "paused" else "再来一轮  ·  SPACE" if self.engine.state == "finished" else "开始专注  ·  SPACE"
        self.start_button.configure(text=text)

    def _apply_topmost(self) -> None:
        self.root.attributes("-topmost", bool(self.always_on_top.get()))

    def _space_shortcut(self, event: tk.Event) -> str | None:
        if event.widget.winfo_class() in {"Entry", "TEntry", "TSpinbox", "Spinbox"}:
            return None
        self.start_or_pause()
        return "break"

    def _close(self) -> None:
        self._save_settings()
        self.root.destroy()
