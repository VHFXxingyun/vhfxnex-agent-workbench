# VHFXNEX 桌面计时器

一个可直接运行的轻量级桌面倒计时工具。使用 Python 3.10+ 和 Tkinter 标准库开发，不需要安装第三方运行依赖，也不需要联网。

## 功能

- 自定义分钟和秒数，或快速选择 5、15、25、45 分钟
- 开始、暂停、继续和重置
- 环形进度与剩余时间实时显示
- 计时结束时显示桌面内提示并播放提示音
- 可选窗口置顶，适合边工作边查看
- 空格键开始/暂停，R 键重置
- 记住上次时长、提示音和置顶偏好
- 计时基于单调时钟，切换窗口或系统负载变化时不会累计漂移

## 运行

1. 安装 Python 3.10 或更高版本。Windows 安装 Python 时请启用 Tcl/Tk 组件。
2. 在项目根目录运行：

   ```powershell
   py -m timer_app
   ```

   macOS / Linux：

   ```bash
   python3 -m timer_app
   ```

如果系统 Python 未包含 Tkinter，请安装发行版提供的 Tk/Tcl GUI 组件后再启动。

窗口默认尺寸为 `980×720`，最小尺寸为 `760×700`；在 Windows 高 DPI 显示环境下也会保留完整的计时设置与操作按钮。

## 测试

```powershell
py -m unittest discover -s tests -v
```

## Windows 可执行文件（可选）

源码开箱可运行。若需要制作单文件 `.exe`，先安装 PyInstaller，再在项目根目录执行：

```powershell
py -m pip install pyinstaller
py -m PyInstaller --noconfirm --onefile --windowed --name VHFXNEX-Timer main.py
```

生成文件位于 `dist/VHFXNEX-Timer.exe`。PyInstaller 只用于可选打包，不是运行源码的前置依赖。

## 项目结构

```text
timer_app/
  __init__.py       应用版本
  __main__.py       桌面程序入口
  app.py            界面、快捷键、偏好设置和计时刷新
  engine.py         可独立测试的倒计时状态机
main.py             直接运行和可选打包的入口
tests/
  test_engine.py    计时状态和边界测试
pyproject.toml      项目元数据与格式化配置
```

## 数据与权限

偏好设置仅保存在当前用户目录下的 `VHFXNEX Timer/settings.json`；程序不会上传数据，也不需要账号、API Key 或服务器。
