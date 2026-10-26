# X Space Multi-Window Muter — 多窗口 X Space 静音与独奏控制器

专为同时打开多个 Chrome 窗口收听不同 **X (Twitter) Space** 设计的音频混音与静音控制扩展（Manifest V3）。支持直接在 **Antigravity IDE / VS Code** 中打开调试，或在 `chrome://extensions/` 中一键加载。

---

## 1. 核心功能亮点

1. **按 Chrome 窗口分组管理 (`chrome.windows` + `chrome.tabs`)**
   - 自动扫描你所有打开的 X 窗口与 Space 页面，实时显示哪个窗口正在发声 (`🔊 正在发声`)、Space 房间标题以及当前发言人信息。
2. **一键独奏窗口 (`🎧 独奏此窗口 / Solo Mode`)**
   - 当你同时挂着 3～5 个 X Space 窗口时，点击任意窗口的 **「独奏此窗口」**，扩展会自动将该窗口恢复声音，并**把其余所有 X 窗口一键静音**，省去逐个切窗口点静音的麻烦。
3. **焦点窗口自动独奏 (`⚡ Auto-Solo Focused Window`)**
   - 在弹窗中勾选 **「切换窗口时自动独奏焦点窗口」** 后，你用鼠标点击哪个 Chrome 窗口，哪个窗口的 X Space 就自动发声，背景其他 X 窗口自动静音（切到微信、终端或 IDE 时保持当前声音不变）。
4. **单窗口独立音量推子 (`0% - 100%`)**
   - 除了浏览器级静音，还支持通过滑块调节每个 X Space 窗口的音量百分比（例如主听窗口 100% 音量，副窗口压低到 20% 当背景音）。
5. **全局快捷键支持**
   - `Alt + Shift + S`：独奏当前焦点窗口（静音其他所有 X 窗口）
   - `Alt + Shift + M`：切换当前窗口的静音/发声状态
   - `Alt + Shift + X`：紧急一键静音所有 X 窗口

---

## 2. 在 Antigravity IDE 与本地 Chrome 中安装使用

1. 解压 `x-space-multi-window-muter.zip`。
2. **在 Antigravity IDE 中打开**：点击 `File -> Open Folder...` 打开 `x-space-multi-window-muter` 文件夹，内置了 `.vscode/launch.json` 与 `jsconfig.json`，终端运行 `npm run check` 可进行语法自检。
3. **在 Chrome 中加载**：
   - 打开 `chrome://extensions/`，开启右上角 **开发者模式 (Developer mode)**。
   - 点击左上角 **加载已解压的扩展程序 (Load unpacked)**，选择 `x-space-multi-window-muter` 文件夹即可。
