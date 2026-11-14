# VHFXNEX 开发记录

## 2026-11-14｜修正活动物资跨时段核算

- 活动可行性检查过去只累加同时段的共享物资，可能把先后两场活动消耗的纸卡、餐券等误判为库存足够。现在默认物资按消耗品处理，按同一天总需求与库存比较；用户/Agent 明确标记 `reusable: true` 的器材才按并发时段的最大占用量核算。
- 同一物品在同一天被混标为消耗品与可复用器材时，检查会直接报告类型冲突，要求统一后复核；同步更新工具 schema、类型声明、Agent 工具说明、验收矩阵。
- 新增回归覆盖跨时段消耗品短缺、跨时段可复用器材通过、并发器材短缺和类型混标。4 项定向回归、项目静态校验烟测、主演示资料烟测、ESLint、TypeScript、生产构建和改动文件格式检查均通过；API smoke 因缺少显式隔离服务配置而按保护逻辑拒绝运行，未访问默认工作区数据库。未调用 DeepSeek。

## 2026-11-14｜明确代码项目独立复核失败状态

- 修复独立代码复核失败时的状态丢失：源码包静态检查通过后，若复核服务超时、返回无效 JSON 或结果结构不完整，工具会保留可下载成果，同时把 `independentReview.status=unavailable` 返回给工作台 Agent，要求明确说明独立复核未完成，不得宣称复核通过。
- 复核通过时也把 `independentReview.status=passed` 附在工具结果上；无效复核响应按不可用处理。执行记录标题与详情不再把“复核暂不可用”伪装成“复核通过”。
- 新增离线回归覆盖通过/阻塞响应、JSON 代码围栏、格式错误、缺字段、错误类型和不可用状态下保留成果；未调用 DeepSeek。

## 2026-11-14｜区分可行性无冲突与完整核验覆盖率

- 修复活动检查的状态误报：过去 `valid: true` 只代表没有发现已提供数据中的冲突，却会被执行记录直接写成“执行约束已核对”；人数、场地、岗位名单或物料清单没提供时，也可能给人完整核验通过的印象。
- 可行性报告现在同时返回 `valid` 与 `coverage.complete/pending`。按每个有效时段检查场地名称、参与者人数、其他现场人员人数、场地容量、岗位名单和物料清单；明确没有岗位/物料时用空数组，没有其他现场人员时填 `0`。缺项只标待确认，不猜测、不阻止 Agent 完成其他安全可交付内容。
- 执行事件区分“执行约束已核对”和“部分约束待确认”，并附上缺项；Agent 提示要求把待确认项带到最终答复和方案，不得把局部检查写成完整通过。检查统计仅计入可实际检查的有效时段。
- 回归覆盖完整数据、缺失数据、无效时段和容量冲突。通过 ESLint、TypeScript、Prettier、Demo Kit、项目静态校验、客户端密钥扫描、遥测检查和定向断言。GitHub Actions [#43596200144](https://github.com/VHFXxingyun/vhfxnex-agent-workbench/actions/runs/43596200144) 对代码提交 `80a8dbf` 全流程通过，包含 API/UI smoke、生产构建、客户端密钥扫描和生产容器健康检查。未调用 DeepSeek。

## 2026-11-14｜场地容量核算计入志愿者和其他现场人员

- 修复活动可行性检查的口径缺口：工具此前只比较参与者人数与场地容量，可能漏掉志愿者。现在 `attendeeCount` 明确表示参与者人数；校验会额外计入 `staff` 名单中的去重人员及 `unlistedOnsiteCount`，再和容量比较。
- 更新工具参数说明与执行 Agent 规则，要求计划按“参与者 + 具名现场支持人员 + 其他现场人员”核算；未提供的事实仍不作猜测。
- 新增回归覆盖 20 名参与者加 5 名志愿者超过 24 人容量、容量 25 人可通过，以及未列名现场人员计入总人数。
- 验收：定向人数回归、ESLint、TypeScript、Prettier、`npm run smoke:demo-kit` 与 `npm run smoke:project` 通过；`git diff --check` 通过。GitHub Actions #43594185993 对提交 `70f4953` 全流程通过，包含 API smoke、160 项 UI smoke、生产构建、前端密钥扫描和容器健康检查。未调用 DeepSeek。

## 2026-11-14｜将活动可行性复核纳入交付门槛

- 活动类输入明确包含人数、岗位、场地容量或物料数量时，服务端现在强制要求 `validate_feasibility` 通过，并确认最后一次复核发生在最后一次方案文档修改之后；缺失事实保留为待确认，不会被标成已核验。
- 若检查发现冲突，执行循环会把具体问题反馈给 Agent，先修订当前方案文档，再自动复核；修订文档会替换本轮旧方案，避免把冲突版和修订版同时作为最终成果。三轮后仍未通过会中止完成状态并明确提示，不把未解决方案标为交付。
- 后续补充修改活动方案时，会结合已保存的目标、任务、里程碑、约束和最近方案重新判断是否需要复核；校验工具收到本轮最新文档，只有尚未修改文档时才读取已保存版本。纯进度问题和无关 Web 修改不会触发额外检查。
- 将门槛状态转换（检查、冲突后修订、文档更新后复核、复核通过后完成）收敛为独立纯函数，并为每种转换增加离线断言，避免首次执行、续轮与最终完成判断分支出现不同规则。
- 新增规则回归，覆盖活动中明确人数/站点的触发、单独时长/未量化志愿者/普通 Web 页面数量的不触发，以及主演示资料的触发。
- 验收：`npm run smoke` 82 项通过；隔离临时 SQLite 的生产服务 `npm run smoke:ui` 160 项通过；`npm run lint`、`npx tsc --noEmit` 通过；当前源代码构建已通过。临时测试服务已停止，未连接用户预览端口，未调用 DeepSeek；本地 `output/` 未纳入更改。

## 2026-11-14｜要求 AI 用量调用明确标注来源

- 将 `recordAiUsage` 的来源上下文改为必填，调用方必须明确标注 planner、dialogue、workbench、reviewer 或 healthcheck，避免新请求静默落入 `unknown`，让管理页的 Agent 用量归因保持可解释。
- 现有 81 条本地用量记录中，73 条旧执行记录的来源为 `unknown`，缓存统计字段没有有效样本；保留这些历史值，不从缺失证据推断来源或命中率。后续请求会按调用点已有的显式来源统计。
- 没有调用 DeepSeek；本地用量数据只读聚合。

## 2026-11-14｜避免 CPU 部署安装可选 CUDA Provider

- 第 9 次 GitHub Actions 在 Linux `npm ci` 阶段失败：`onnxruntime-node` 默认尝试从 NuGet 下载可选 CUDA 12 Provider，连接超时；本项目知识向量推理使用 CPU。
- 为 CI 与 Docker 的开发/生产依赖安装设置 `ONNXRUNTIME_NODE_INSTALL=skip`，跳过不需要的 CUDA Provider 下载，保留 npm 包自带 Runtime。GitHub Actions 运行 #43586345910 全流程通过：依赖安装、构建、82 项 API smoke、160 项 UI smoke、密钥扫描及生产容器健康检查均成功。

## 2026-11-14｜补全对话 Markdown 的浏览器覆盖

- 浏览器夹具现在覆盖标题、列表、表格、引用、安全 HTTP(S) 链接、行内/块代码，并确认 `javascript:` 链接不会生成可点击锚点、原始脚本标签不会执行。
- 使用独立端口 3465、临时 SQLite 与 `NEXORA_DISABLE_AI=1` 运行生产 UI smoke，160 项全部通过；没有调用 DeepSeek。

## 2026-11-14｜对话 Markdown 提交通过远程 CI

- GitHub Actions 运行 #43582996078 对提交 166ad04 全流程通过：ESLint、TypeScript、worker 与项目回归、生产构建、密钥扫描、82 项 API smoke、158 项 UI smoke，以及 Docker 镜像构建与容器健康检查。
- 本次远程 CI 使用占位环境变量并禁用模型请求；没有调用 DeepSeek。

本记录从项目基线提交后开始，按实际完成时间记录开发、验收与发布情况。未完成的工作会标为“待完成”，不把计划写成已实现内容，也不补造过去的提交历史。

## 2026-11-14｜让对话支持安全 Markdown 呈现

- 对话历史与流式回复现在复用方案预览的结构化 Markdown 渲染器，标题、列表、表格、引用、链接、行内代码和代码块可直接阅读；保留深色工作台中的高对比文字样式。
- 回复按 React 文本节点渲染，不执行原始 HTML；链接只识别 HTTP(S) 地址。
- 增加浏览器回归，检查历史对话中的标题、列表、行内/块代码以及嵌入脚本标签不会变成可执行元素。隔离数据库、独立本机端口与 `NEXORA_DISABLE_AI=1` 下 UI smoke 通过 158 项；ESLint、TypeScript、Prettier、生产构建和 `git diff --check` 通过。
- 未调用 DeepSeek，也未访问 3456 预览服务。

## 2026-11-14｜通过 CI 修复生产容器运行与窄屏产物弹窗

- 首次 GitHub Actions 实建发现 Docker runner 层漏复制 worker 导入的 `src/lib/database-path.mjs`，导致 worker 启动失败、容器健康检查不通过；Dockerfile 已补齐运行模块，静态检查增加对应断言。
- 后续真实浏览器回归发现 320×720 视口的代码产物弹窗超出屏幕；为代码弹窗建立受视口约束的 grid 行，并将弹窗最大高度约束到容器可用高度。
- 最终 GitHub Actions 全流程通过：生产构建、82 项 API smoke、157 项浏览器 UI smoke、Docker 镜像构建和容器健康检查；容器运行用户为 `node` 且进程 UID 非 root。`npm run smoke:container` 通过 36 项，ESLint、TypeScript、Prettier 与 diff whitespace 检查通过。
- 回归没有调用 DeepSeek。`.env.local` 未提交；本地产生的 `output/` PDF 未提交。本地没有 Docker/Podman，镜像验收由隔离的 GitHub Actions runner 完成。

## 2026-11-14｜补齐执行中连续对话与队列自动接手的浏览器回归

- UI smoke 新增完整浏览器链路：工作区已有服务端运行状态时，用户仍可向对话 Agent 发送第二项明确工作；它先进入队列，当前执行锁存在时不得启动，刷新页面后仍恢复队列并等待，锁释放后自动领取并发送给工作台 Agent，完成结果回到聊天记录，已完成队列项从待处理列表移除。
- 回归确认聊天发送按钮在执行中使用“发送”文案，并使用正确的执行请求字段验证交接要求、原始聊天消息和消息 ID；加入有时限的等待，避免缺陷导致烟测永久挂起。
- API smoke 在隔离数据库上通过 80 项，覆盖真实 `/api/chat` 对话与进度回复、执行中服务器队列持久化、锁存在时返回 busy、执行结束后 claim 和完成；UI smoke 在独立隔离服务与全新临时 SQLite 上通过 154 项，新增刷新后队列恢复断言。UI 流使用本地响应拦截，不调用模型。
- `npm run lint`、`npx tsc --noEmit`、UI smoke 格式检查、`git diff --check` 均通过。隔离测试服务已停止；本轮未修改 `.env.local`、未调用 DeepSeek、未访问用户预览服务，也未提交或推送。

## 2026-11-14｜补充缓存命中率与费用口径说明

- 新增 API 用量说明，区分命中请求率、输入 Token 命中率和统计覆盖率，并用例子说明为何请求命中率不能直接代表省钱比例。
- 依据 DeepSeek 官方上下文缓存和价格文档记录缓存按相同输入前缀 best-effort 复用、V4.1 Flash 命中/未命中/输出当前价及费用估算公式；明确应用估值不等于历史账单，思考 Token 已计入输出。
- 记录 17 次受控前缀探测的实际样本与估算节省，注明其不代表完整应用或真实账户的长期命中表现；不纳入用户账户消费数据。
- README 增加说明文档入口。只更新文档，没有调用 DeepSeek 或变更应用用量逻辑；容器验收仍受当前环境未安装 Docker 的限制。

## 2026-11-14｜将 API 与浏览器 smoke 固定到隔离数据库

- 排查发现此前 smoke 客户端只根据本机 URL 判断目标；当错误服务占用默认端口时，测试账号和数据清理可能落到错误 SQLite。现在 API、浏览器和实时 smoke 都要求显式设置临时目录数据库与本机回环 URL，并在任何测试写入前用 `SESSION_SECRET` 签名的路径证明核对服务端实际数据库。健康接口只返回匹配状态，不返回数据库路径。
- 隔离路径检查同时校验 SQLite 的真实解析位置，拒绝临时目录中的符号链接指向工作区外部；Windows 短路径/长路径别名会先规范化，避免同一个临时数据库被误判成不同目标。服务没就绪、数据库不匹配或未提供隔离设置时，脚本简洁失败并说明没有开始测试写入。
- 在 3460 端口的隔离生产服务和临时 SQLite 上验证：错误会话密钥与错误数据库路径都在测试写入前被拒绝；用 Windows 长路径指向服务使用的同一个短路径 SQLite 时，`npm run smoke` 通过 77 项。`npm run smoke:ui` 通过 152 项。服务端 `NEXORA_DISABLE_AI=1`，本轮没有模型 API 请求；3456 预览健康检查仍为 200。隔离服务已停止，未删除临时数据库文件，也未提交或推送。
- `npm run build`、ESLint、TypeScript、Prettier、Node 脚本语法检查和 `git diff --check` 通过。

## 2026-11-14｜让 API smoke 在服务不可达时安全快速失败

- 真实执行发现 `npm run smoke` 默认目标 `localhost:3000` 未启动时会先运行本地断言，之后才在首个 HTTP 请求报 `ECONNREFUSED`。现在先探测本地 NEXORA `/api/health`，要求 SQLite 与后台 worker 都就绪；连接失败、健康状态异常或非 2xx 时立即终止，不执行后续 API 用例或测试账号创建，并显示简明启动提示。
- 错误信息明确说明 smoke 会创建/删除测试账号和数据库样例，并要求使用隔离 `GOALFLOW_DATABASE_PATH`、关闭模型调用的 `NEXORA_DISABLE_AI=1`，再通过 `NEXORA_BASE_URL` 指向专用测试服务。
- README 增加 Windows PowerShell 的双终端启动示例，固定使用独立 SQLite、3017 端口和服务端 AI 禁用开关，并提示实时 smoke 单独消耗额度。
- 用空闲的 3457 端口验证预检在 API 测试与注册前退出，并只显示说明、不打印堆栈。`npm run build`、客户端密钥扫描、`npm run smoke:project`、`npm run smoke:desktop-timer`（5 项）、ESLint、TypeScript、Node 语法、Prettier 和 `git diff --check` 均通过；3456 预览健康检查返回 200，本轮未调用 DeepSeek。

## 2026-11-14｜完善语音输入静音反馈并修复重试竞态

- 浏览器语音识别正常结束但没有听到语音时，聊天框现在会提示用户检查麦克风后重试；浏览器明确返回 `no-speech` 时也显示对应提示。
- 为每次语音识别会话校验回调归属，防止用户重试后旧会话延迟返回的 `onend` 或错误事件覆盖新会话状态、提前清除录音状态。
- UI smoke 增加静音结束、`no-speech`、权限拒绝、浏览器不支持、成功转写，以及重试后旧会话延迟结束的回归检查；隔离服务上 152 项检查全部通过，运行时关闭 AI，未调用 DeepSeek。
- 对照 [DeepSeek 官方价格表](https://api-docs.deepseek.com/quick_start/pricing/) 核对 V4.1 Flash 当前公开价，并将费用估值提示的核对日期更新为 2026-11-14。单价与现有估值逻辑一致：非高峰缓存命中/未命中输入分别为每百万 Token $0.003/$0.15，高峰为 $0.006/$0.30；输出分别为 $0.60/$1.20。费用估值仍是当前价回算，不代表历史账单。
- `npm run build`、TypeScript、定向 ESLint、Node 语法检查、Prettier 和 `git diff --check` 通过；生产构建期间确认用户预览 `/api/health` 仍返回 200。隔离构建目录经 Webpack 和 Turbopack 的构建尝试受 Windows 外部 `node_modules` Junction 路径解析限制，实际仓库生产构建已通过。
- 隔离 smoke 数据库记录核对为 0，测试服务已停止；当前预览服务保持运行。没有提交或推送。

## 2026-11-14｜验收真实图片理解与规划

- 在隔离服务和临时 SQLite 上执行 `npm run smoke:vision`，向真实 DeepSeek 规划请求附加脚本内置的纯红色测试图；模型将“红色”写入已保存的规划结果，单次请求消耗 3,650 Token。
- 复核输出后发现旧版烟测把缺失的缓存遥测字段默认显示为“0 命中”，无法区分供应商报告零命中和未提供数据；已修正为明确输出“缓存遥测不可用”，或者供应商实际报告的缓存 Token 数。本次请求的原始缓存统计结果没有保留，不纳入命中率样本。
- 临时用户、工作区、用量和知识库记录均已清理并核对为 0；隔离服务已停止。临时 SQLite 文件为空，仅剩 4 KB 文件；自动删除操作被执行策略拦截，因此没有改用其他方式绕过限制。
- 本次只验收单图理解与规划保存，不代表多轮、语音或视频帧的视觉质量；单次请求也不能作为账户总体命中率。

## 2026-11-14｜修复实时规划截断并完成浏览器端到端验收

- 将首次规划的输出上限从 1,500 调整到 4,096 Token；显式拒绝达到长度上限、空内容和损坏 JSON，避免把不完整结果保存成工作区。实时浏览器 smoke 现在先检查规划 API 响应，失败时直接报告服务端错误，不再空等路线卡片。
- 修复工具参数校验错误暴露整段 JSON 输入的问题：从 SDK 类型校验错误中提取实际原因，避免把源码片段误当错误提示；增加截断计划和源码过长错误用例。
- 在隔离生产服务、临时 SQLite 和一次性账号上，通过真实浏览器完成规划、DeepSeek SSE、联网搜索、任务与时间线、方案、`create_project`、独立 `review_project`、成果预览及 ZIP CRC/逐文件一致性核对。执行事件含 `search_web`、`create_tasks`、`build_timeline`、`draft_document`、`create_project` 和 `review_project`。本次用量为 42,574 Token（27,865 输入、14,709 输出）；测试账号及工作区已清理。实时烟测现会输出缓存字段，供后续统计命中样本。
- 首次实时执行曾在代码项目参数校验阶段失败；缩小烟测项目后全链路通过。首轮规划失败未保存供应商 `finish_reason`，因此将输出截断视为待验证推断，不作为已证实根因。
- `npm run build`、TypeScript、定向 ESLint、`npm run smoke`（76 项）和 `npm run smoke:ui`（153 项）通过。隔离服务停止；未提交或推送。

## 2026-11-14｜按 Agent 来源展示 Token 与费用估值

- 管理员来源明细现在分别显示各 Agent 的请求数、输入/输出 Token、DeepSeek Flash 输入/输出 Token、缓存遥测和按当前公开价计算的费用区间；其他模型的 Token 继续列入用量，但不会混入 Flash 单价估算。费用提示明确它是当前价回算，不是历史账单。
- 手机窄屏将来源表格改为带字段名的纵向指标卡，避免用量区块产生横向滚动。
- 隔离生产构建通过；隔离生产服务与临时 SQLite 上通过 75 项 API smoke 和 150 项 Playwright UI smoke，覆盖来源级费用估值与窄屏布局。运行时强制禁用模型请求，未调用 DeepSeek API，也未读取或修改用户预览数据库。

## 2026-11-14｜恢复刷新后的工作区并修复规划草稿竞态

- 页面整页重载后，React 内存中的当前页面状态会重置；现按用户与浏览器标签页保存活动工作区 ID，并在认证和服务器工作区列表完成加载后恢复仍有效的工作区。离开、删除工作区或登出时清理恢复标记，避免重开过期项目。
- 修复规划请求返回 401 时草稿先于会话核验被清理的竞态；现在等待会话核验结果，再决定是否清理，确保原账户重新认证时可以恢复目标文本和附件。
- UI 回归增加硬刷新恢复断言，并让过期会话模拟同时覆盖身份核验接口；共享邀请测试改为等待撤销项加载后继续，避免读写时序导致偶发失败。
- `npm run lint`、`npx tsc --noEmit`、Prettier、`npm run build`、`npm run smoke:project` 和 `git diff --check` 通过；隔离生产服务与临时 SQLite 上通过 152 项 UI smoke。运行时启用 `NEXORA_DISABLE_AI=1`，未调用 DeepSeek API，也未读取或修改用户预览数据库。

## 2026-11-13｜回归环境隔离与共享弹窗键盘操作

- 分享弹窗打开后会将焦点移入弹窗；Tab/Shift+Tab 在弹窗内循环，Escape 关闭后焦点回到打开按钮。
- 修复断流恢复浏览器用例把真实 handoff 写入共享 SQLite、可能与开发服务器后台 worker 争抢的问题。聊天、队列和断流执行现在由浏览器内存模拟，并断言测试工作区没有真实队列记录。
- 新增服务端显式开关 `NEXORA_DISABLE_AI=1`；隔离回归环境即使能读取项目 `.env.local`，模型 API 仍拿不到 Key。这个开关只用于明确关闭模型的运行环境。
- 把完整 UI smoke 移到独立 3013 端口、临时 SQLite 和隔离 worker；没有重启 3000 端口的预览，也没有触发 DeepSeek 请求。
- 两次早期 UI smoke 尝试发生在发现共享 worker 竞态之前，且脚本清理了临时账号与用量行，因此无法从现存记录确认 worker 是否曾继续到真实模型入口；不能据此断言那两次一定没有请求。后续通过独立数据库和服务端 AI 禁用开关完成的回归不发起模型调用。

### 本地检查

- `npm run smoke` — 通过 75 项。
- `npm run smoke:ui` — 通过 149 项；使用隔离 SQLite、隔离 worker 与服务端 AI 禁用开关。
- `npm run lint`、`npx tsc --noEmit`、`npm run build` 通过；`scripts/ui-smoke.mjs` 的无凭据规划探针补齐了必需的工作区 ID。

## 2026-11-13｜隔离多账户 DeepSeek KV 缓存

- 发现同一 DeepSeek API Key 服务多个应用账户时，请求未携带 `user_id`；这会让提供方无法按应用账户隔离 KV 缓存。现为规划、聊天、工作台执行、代码复核与管理员连接检查加入同一套账户级伪名。
- 伪名由服务端 HMAC 派生，采用 ASCII 字母数字与下划线格式；原始账户 ID、姓名和邮箱不会作为 `user_id` 发送。账户下工作区保持同一个 ID；更换 `SESSION_SECRET` 会切换提供方缓存分区，缓存命中仍不保证。
- 缓存隔离会减少不同账户之间偶然共享相同前缀的机会，因此全局命中率可能降低；这是多账户隐私隔离与跨账户缓存复用的明确取舍。
- 增加不联网的 HMAC 隔离断言和模拟 AI SDK Fetch 的序列化检查，确保请求体使用 DeepSeek 所需的 `user_id` 字段；另静态核对规划、聊天、工作台主执行/代码复核及连接诊断入口都传入账户伪名，避免某个调用路径日后漏传。

### 本地检查

- `npm run smoke` 通过 75 项；新增 HMAC 用户隔离、全模型入口覆盖和模拟 SDK 请求体断言。请求由本地 mock fetch 接收，没有连接 DeepSeek。
- `npm run lint`、`npx tsc --noEmit`、`npm run build`、`npm run check:client-secrets`、Prettier 和 `git diff --check` 通过；生产构建使用占位环境变量。
- 本地预览 `/api/health` 返回 HTTP 200；没有在 3000 端口重启服务。未发起真实 DeepSeek 请求，未产生模型费用。GitHub 托管 CI 尚未运行。
- 本轮再运行 `npm run smoke:ui`，149 项浏览器检查全部通过；覆盖 100% 桌面布局、工作区切换与执行状态、共享邀请创建/撤销及无障碍检查。运行时关闭实时 AI 与连接探测，没有发起模型请求。此前报告的偶发邀请弹窗问题本轮未复现；这次通过不等同于已经确认并修复其根因。
- 抽查 1366×768 工作区截图，主工作区、左侧项目流程、右侧行动计划和固定输入区均在视口内；浏览器烟测截图保存在系统临时目录 `nexora-ui-smoke-e3a54693-e08a-4be0-a15f-7bb9aaa29bae`。本地预览仍在运行。

## 2026-11-13｜增加无模型消耗的 GitHub Actions CI

### 本次完成

- 新增推送和 Pull Request 自动检查：依赖安装、ESLint、TypeScript、API/worker/进程监督/生成项目/遥测本地检查、Next.js 生产构建，以及构建后浏览器密钥扫描。
- CI 构建使用仅限临时运行器的占位配置，以确保密钥扫描确实遍历产出的浏览器 bundle；占位值不是 DeepSeek Key，不发起模型请求。
- 限制工作流权限为只读仓库内容，并为同一分支的新运行取消过期运行。
- README 说明自动检查范围；明确不会发起 DeepSeek 请求，浏览器 UI、实时模型、Docker 与公网部署仍需单独验收。
- 工作流使用 GitHub 官方 `actions/checkout@v7` 与 `actions/setup-node@v7`；工作流尚未推送，GitHub 托管执行结果待确认。

### 本地检查

- YAML 解析与结构检查通过；工作流中引用的所有 npm 脚本均存在。
- 按工作流顺序在本机通过 `npm run lint`、`npx tsc --noEmit`、`npm run check:client-secrets`、`npm run smoke`（73 项）、`npm run smoke:worker`、`npm run smoke:supervisor`、`npm run smoke:project`、`npm run smoke:telemetry`（5 个 span）和 `npm run build`。
- 本次未调用 DeepSeek API、Docker 或 GitHub Actions 服务；GitHub 托管结果待工作流推送后确认。

## 2026-11-12｜项目基线整理并发布

### 本次完成

- 整理并提交 VHFXNEX 目标驱动 AI 工作台的应用源码、运行说明、环境变量模板、品牌资源和验收脚本。
- 建立公开 GitHub 仓库：<https://github.com/VHFXxingyun/vhfxnex-agent-workbench>，默认分支为 `main`。
- 项目基线提交：`71ce375`（`feat: publish VHFXNEX agent workbench baseline`）。
- 排除 `.env.local`、本地数据库、内部备赛笔记和单独生成的样例项目；仓库仅包含空值 `.env.example`。
- 将本仓库的 Git 代理设为空值，避免本机失效的全局代理阻断后续远程推送；没有修改其他仓库的代理设置。

### 当时已具备的功能

- 规划、对话和工作台 Agent 的职责分工与明确交接；普通问题和进度查询由对话 Agent 回答，明确工作要求交给工作台 Agent。
- 流式执行、工具调用、任务与时间线、联网搜索、知识库检索、图片和文档上下文、可恢复工作区状态。
- DOCX、PDF、XLSX、PPTX、Markdown、ICS 和代码 ZIP 等成果生成、预览或下载。
- 账户登录与恢复、管理员控制台、SQLite 持久化、权限检查和用量记录。

### 已完成验收

- ESLint、TypeScript、客户端密钥扫描和 Next.js 生产构建通过。
- 本地端到端检查通过：62 项。
- Playwright 浏览器检查通过：129 项，覆盖桌面与手机布局、Agent 交接、进度问答、产物、权限、无障碍和恢复流程。
- OpenTelemetry 检查通过：4 个 span 的关系与隐私字段验证通过。
- 远程 `main` 分支的提交号已核对为 `71ce375`。

### 尚未完成（截至本记录）

- 尚未对完整主场景执行实时 DeepSeek 端到端验收；本轮为控制 API 额度，没有运行实时模型检查。
- 尚无公网部署地址、持久化生产数据库配置和评审账号。
- 技术报告与演示视频仍为提纲，主演示场景及最终提交材料仍需确认。
- 本地自动化验收结果尚需结合最终实时演示进行人工复核。

## 2026-11-13｜共享协作与持续执行能力验收

### 本次完成与复核

- 补充工作区协作端到端 API 验收：覆盖只读/编辑权限、邀请接受、撤销邀请、成员访问边界、共享执行状态和编辑者停止任务。
- 补充浏览器验收：共享弹窗生成只读邀请、未登录邀请页提示、撤销邀请；弹窗和邀请页通过 axe-core WCAG 2.2 AA 检查。
- 调亮已完成任务的划线文字，并让 UI smoke 等待共享弹窗入场动画结束后再运行可访问性检查，避免把动画过渡帧误判成实际颜色。
- 核实持久队列、后台工作状态、对话 Agent 进度问答、代码静态检查与复核、浏览器语音输入/本地视频抽帧、知识库本地语义检索等能力的 API/UI 覆盖，并更新验收矩阵与运行说明。
- Google Calendar 和 GitHub 外部授权/发布集成按用户要求暂缓；保留 `.ics` 文件导出与代码 ZIP 下载。

### 本轮验收结果

- `npm run lint` — 通过。
- `npx tsc --noEmit` — 通过。
- `npm run smoke` — 通过，63 项。
- `npm run smoke:ui` — 通过，132 项；验收截图目录名为 `nexora-ui-smoke-abdc3be5-42fb-42b5-af47-c570fb2b0064`，保存在系统临时目录。
- `npm run smoke:telemetry` — 通过，4 个 span。
- `npm run build` — 通过，Next.js 16.4.5 Turbopack 生产构建成功。
- `npm run check:client-secrets` — 通过；生产构建后还需再执行一次。

实时 DeepSeek 端到端调用未运行，避免未经确认消耗 API 额度；语音识别、模型首次下载和视频视觉理解仍需在最终比赛浏览器与真实模型环境人工验收。本轮仅完成代码与文档变更，未提交或推送远程仓库。

## 2026-11-13｜用量口径与后台任务启动修复

### 本次完成与复核

- 修正缓存命中统计的含义：以前接口没有返回缓存元数据时，页面仍可能把缓存命中显示为 0，无法区分“接口报告未命中”和“接口没有提供统计”。还确认 DeepSeek SDK 会把缺失字段标准化成 `cacheReadTokens: 0`；现在根据原始 Provider 用量中的字段判断是否真的测量，单独保存测量输入量与命中量，只有有测量样本时才显示命中率。
- 将同一统计口径应用到聊天、工作台执行、管理员汇总、每日趋势、数据库迁移、导出和用量界面，并校验缓存命中量不超过已测量输入量、测量输入量不超过总输入量。
- 修复后台 worker 在 Node 24 下启动失败的问题：`@next/env` 通过默认导入读取，再从导出对象获取 `loadEnvConfig`，与启动脚本的 CommonJS 互操作方式一致。
- 直接启动 worker 验证其打印服务就绪状态后正常驻留；测试使用不可连接的本地地址，不触发 DeepSeek 请求。

### 本次验收结果

- `npm run lint` — 通过。
- `npx tsc --noEmit` — 通过。
- `npm run smoke` — 通过，65 项；覆盖原始 Provider 有/无缓存字段、无命中、嵌套缓存字段、数据库保存、管理员聚合及执行提示词稳定前缀。
- `npm run smoke:ui` — 通过，132 项；覆盖管理界面实际缓存比例和无样本状态。
- `npm run smoke:worker` — 通过；以独立测试密钥启动 worker，确认就绪后关闭数据库并退出，不读取或领取真实队列任务。
- `npm run build` — 通过，Next.js 16.4.5 Turbopack 生产构建成功。
- `npm run check:client-secrets` — 通过；生产构建后的浏览器产物未发现配置的 API Key。
- `npm run smoke:telemetry` — 上一轮通过 4 个 span；本次改动不涉及遥测结构。
- `git diff --check` — 通过；仅有 Git 关于工作区 LF/CRLF 的提示。
- 在不调用 DeepSeek 的情况下，对 DuckDuckGo 搜索适配器执行真实只读网络检查，返回 5 条安全 HTTP(S) 网页来源，包含 `nextjs.org`。该项只验证搜索数据源，不代表模型自动选工具、SSE 展示与工作区持久化的实时全链路通过。
- 将工作台执行提示词的固定策略放在稳定前缀，将日期留在用户上下文，并把新目标/续办模式、代码/办公文档产物要求和搜索策略放在后缀。不同模式和工具请求现在保留相同的长提示词前缀，为 DeepSeek 前缀缓存提供更多可复用内容；缓存属于尽力而为，未用真实 API 请求测量实际命中提升或费用变化。
- 提示词调整后重新运行 ESLint、TypeScript、生产构建、客户端密钥扫描、65 项 smoke、worker 启动检查和生产服务 UI smoke（132 项），均通过。没有运行实时 DeepSeek 调用。

实时 DeepSeek 请求仍未运行，以免未经确认消耗额度；Google Calendar 和 GitHub 集成按用户要求暂缓。本次未创建提交或推送。

## 2026-11-13｜知识库混合检索排序修复

### 本次完成与复核

- 修复语义检索与关键词检索互相丢结果的问题：现在使用加权倒数排名融合两路候选，语义与精确文本命中同时出现时保留两者的优势。
- 同一资料同时被两路命中时，将引用片段固定为关键词检索找到的原文，避免只展示语义切块而漏掉精确名称、编号或原句。
- 嵌入模型不可用时仍使用关键词检索；不要求用户为这一回退路径配置外部服务。
- 为融合排序增加 smoke 检查，覆盖混合命中标记、排名融合、关键词原文保留和零结果上限。

### 本次验收结果

- `npm run lint`、`npx tsc --noEmit`、`npm run build`、`npm run check:client-secrets` — 通过。
- `npm run smoke` — 通过，66 项。
- `npm run smoke:worker` — 通过；确认 worker 启动并正常退出，没有领取真实队列任务。
- `npm run smoke:ui` — 通过，132 项；截图目录为 `nexora-ui-smoke-9d005e83-1a45-4b42-91be-a8dbbcae201c`。
- 本地 BGE 中文向量模型离线推理 — 通过；产生 512 维向量，两个相关活动描述的余弦相似度约为 0.75，与计时器描述约为 0.61。阈值检查可区分这组样例；只使用已有本地模型缓存，没有调用 DeepSeek 或触发模型下载。
- `git diff --check` — 通过；仅有 Git 提示工作区文本文件的 LF/CRLF 转换，不影响补丁空白检查。
- 未运行真实 DeepSeek 请求；真实数据库检索、向量持久化与规划引用的端到端命中仍待专项验收。

Google Calendar 与 GitHub 集成继续按用户要求暂缓；本次未创建提交或推送。

## 2026-11-13｜知识库语义索引覆盖与预算

### 本次完成与复核

- 移除每篇资料固定只索引 6 个语义块的限制。知识库总块数不超过预算时全量索引；超过预算时，最多为整个账户建立 600 个语义块索引，并在资料间均匀分配、跨全文范围取样。
- 该预算在资料篇数较少时能覆盖长文全部分块；资料很多时仍给每篇资料分配检索额度，避免只索引最新或少数资料，也控制首次索引的本地推理量。
- 增加针对空分块、较少文档、长文采样范围和 100 篇长文总预算的回归检查。

### 本次验收结果

- `npm run lint`、`npx tsc --noEmit`、`npm run build` — 通过。
- `npm run smoke` — 通过，67 项。
- `npm run smoke:worker` — 通过；启动检查没有领取队列任务。
- `npm run smoke:ui` — 通过，132 项；截图目录为 `nexora-ui-smoke-99b02a47-54c4-4c1b-a70e-1728efdf5d48`。
- `npm run check:client-secrets` 和 `git diff --check` — 通过；Git 仅提示工作区文本文件 LF/CRLF 转换。
- 未调用 DeepSeek API；检索使用本地 BGE 模型，最多建立 600 个语义块索引，向量保存在 SQLite。

Google Calendar 与 GitHub 集成继续按用户要求暂缓；本次未创建提交或推送。

## 2026-11-13｜Markdown 预览颜色回归保护

- 复核产物预览实际截图：纸白预览页上的标题、正文和代码块文字均可读，现有显式颜色规则已覆盖标题、正文、链接、行内代码和代码块。
- 在浏览器 smoke 中读取最终计算样式，按 WCAG AA 4.5:1 阈值检查这些文本与各自背景的实际对比度，避免再次出现浅底浅字。
- `npm run lint`、`npx tsc --noEmit` — 通过；`npm run smoke:ui` — 通过，133 项。
- 验收截图目录：`nexora-ui-smoke-7f450ad8-b132-4bcc-820c-46b503a1f583`。本次没有改动 UI 样式或调用 DeepSeek API。

本次未创建提交或推送。

## 2026-11-13｜静态代码预览脚本隔离回归

- 静态 HTML 预览的 CSP 显式增加 `script-src 'none'` 与 `script-src-attr 'none'`，配合 iframe 沙箱阻断脚本和内联事件处理器。
- 浏览器烟测新增恶意预览样例：点击带 `onclick` 的按钮、触发远程图片错误处理器，并确认两个处理器均未执行；远程图片无法加载。
- `npm run lint`、`npm run build` — 通过；`npm run smoke` — 通过，67 项；生产构建服务上的 `npm run smoke:ui` — 通过，134 项；`git diff --check` — 通过。
- 本轮未调用 DeepSeek API，也未创建提交或推送。外部 Google Calendar、GitHub 授权集成仍按用户要求暂缓。

## 2026-11-13｜代码项目静态交付校验

- 将代码校验逻辑拆分为不执行生成代码的纯模块，同时保留 `server-only` 服务端入口保护。
- smoke 新增有效项目、语法错误、本地引用缺失和无效 `package.json` 命令覆盖；发现问题会在 `create_project` 保存成果前返回给生成 Agent 修复。
- `npm run lint`、`npx tsc --noEmit`、`npm run build` — 通过；`npm run smoke` — 通过，68 项；生产构建服务上的 `npm run smoke:ui` — 通过，134 项；`git diff --check` — 通过。
- 未运行生成的项目代码或实时模型复核；本轮没有调用 DeepSeek API，也未创建提交或推送。

## 2026-11-13｜语音输入浏览器降级回归

- UI smoke 模拟浏览器不支持 SpeechRecognition、麦克风权限拒绝和成功返回转写三种状态，确认错误提示清楚、录音状态复位且识别文本进入聊天输入框。
- `npm run lint` — 通过；最新生产构建服务上的 `npm run smoke:ui` — 通过，135 项。
- 本地视频解码兼容性和视觉模型真实识图仍未实测；本次测试未发起语音、视频或模型网络请求，也未产生 DeepSeek 费用。

## 2026-11-13｜视频抽帧时序与本机回归

- 修复视频加载等待可能漏掉已触发 `loadeddata` 事件的竞态：等待前先检查 `readyState`，已加载到当前帧时直接继续。
- 加入 789 字节 WebM、1.7 KB MP4 与 1.6 KB MOV 合成回归素材；UI smoke 在浏览器上传三种格式并验证关键帧图片标签后移除素材，视频只在本机解码，不发送视频或音轨。
- `npm run lint`、`npm run build` — 通过；最新生产构建上的 `npm run smoke:ui` — 通过，136 项。
- 三种格式的本机解码已验收；真实视觉模型识图未验收；未调用 DeepSeek API，也未创建提交或推送。

## 2026-11-13｜首次规划思考模式对齐

- 修复首次路线规划没有遵循界面思考模式的问题：默认“深度”现在会向 DeepSeek 请求启用 thinking 与 high reasoning effort；用户选择“快速”时关闭 thinking。对话与工作台此前已使用同一默认模式。
- 增加纯本地模式映射检查，并在 Playwright UI smoke 中检查默认深度模式随首次规划请求发送；没有触发真实模型调用。
- `npm run lint`、`npx tsc --noEmit`、`npm run build` — 通过；`npm run smoke` — 通过，69 项；生产构建上的 `npm run smoke:ui` — 通过，137 项；worker 启动、客户端密钥扫描、遥测隐私检查与 `git diff --check` 均通过。
- 真实 DeepSeek 高推理请求未运行，因而尚未验证实际响应内容和该配置下的额度消耗；Google Calendar 与 GitHub 直连继续按用户要求暂缓。

## 2026-11-13｜知识库中文语义召回校准

- 用本机缓存的 BGE 中文模型复核活动需求改写，发现检索时给资料和查询重复拼接同一提示语会抬高无关文本相似度；移除公共前缀，并把向量缓存哈希升级为 `plain-text-v2`，已存旧向量会按需重建。
- 原 0.72 相似度门槛漏掉“阶梯教室固定投影”这类相关场地资料。根据本地正负样例将门槛校准到 0.56，并保留关键词检索与原文片段融合。
- 离线向量 smoke 使用真实业务措辞：场地资料得分 0.628、活动主题资料 0.664，无关学生证资料 0.495；模型远程下载关闭。
- `npm run smoke` — 通过 70 项；实际经 `/api/plan` 演示请求和 SQLite 验证改写活动需求产生本地向量索引、以 hybrid 命中并保留原文来源。`npm run smoke:knowledge` — 通过。
- `npm run lint`、`npx tsc --noEmit`、`npm run build`、生产服务 `npm run smoke:ui`（137 项）、`npm run smoke:worker`、`npm run check:client-secrets`、`npm run smoke:telemetry`、`git diff --check` — 均通过；没有触发 DeepSeek 请求。
- 核对 `.env.local` 和 SQLite 文件被 `.gitignore` 排除、未被 Git 跟踪；当前 Git 暂存区为空。
- `data/models` 已存在模型缓存，当前回归没有下载额外模型。全新机器仍可能在首次语义检索时下载模型，下载失败则退回关键词检索。
- Google Calendar/GitHub 等第三方授权接入按用户要求暂缓；本次未创建提交或推送。

## 2026-11-13｜技术说明与演示视频材料工作稿

### 本次完成与核对

- 新增 `deliverables/VHFXNEX-technical-report-draft.md`，整理产品流程、系统架构、Agent 职责、AI 与工具、知识检索、隐私边界、自动化验收、运行复现和当前限制；团队、学校、部署和真实模型评估数据保留为待填写项。
- 结合团队此前提供的冬日健康活动策划与纸笔闯关工作坊方案，扩展演示视频分镜；包含完整输入、一次路线确认、连续执行、进度交流、成果下载和未确认事项保护。
- 更新技术报告提纲与比赛准备状态，明确草稿不是最终 PDF，主演示案例仍待团队冻结。
- 逐项对照 README、验收矩阵、已有活动材料与报告中的技术描述；没有填造真人团队信息、真实用户效果或实时 DeepSeek 结果。

### 本次边界与验证

- 未调用 DeepSeek API，未请求 Google Calendar/GitHub 等外部授权，也未生成最终 PDF。
- 本次只新增和更新备赛文档；未改应用代码，未创建提交或推送远程仓库。

## 2026-11-13｜当前工作树全量本地回归

### 本次验收

- 当前代码工作树通过 `npm run lint`、`npx tsc --noEmit`、`npm run build`。
- 本机 API smoke 通过 70 项；知识向量离线 smoke、worker 启动、OpenTelemetry 隐私检查、客户端密钥扫描均通过。
- 生产服务上的 Playwright UI smoke 通过 137 项；截图保存在系统临时目录 `nexora-ui-smoke-a3401ad0-15ec-4156-8d58-e90757d8ed32`。人工检查首页、1366×768 工作区和文档预览，没有发现样式缺失或浅底浅字。
- 结束生产服务后确认 3000 端口无监听。只聚合检查本机数据库状态：无待处理交接、无活动执行锁；AI 用量最近记录早于本轮验收，原有 6 个工作区仍在。
- 没有运行 `smoke:live`、`smoke:search`、视觉模型测试或代码实时复核：这些路径会触发真实 DeepSeek 请求并消耗额度；没有进行第三方账号授权。
- 本轮未修改应用源码；没有创建提交或推送。

## 2026-11-13｜按目标追踪 AI 用量

### 完成内容

- 为新 AI 用量记录增加工作空间 ID 与来源类别：首次规划、聊天 Agent、工作台 Agent。执行中每次模型请求分别记账，管理员可以在最近目标列表里看到项目累计 Token 和三类来源拆分。
- 复核全部 DeepSeek 调用入口时发现管理员手动“测试连接”也会消耗额度；该请求现在以“连接诊断”独立计入总 Token 和七日请求趋势，不关联任何工作空间。
- 管理控制台近 7 日调用趋势区分规划、对话、工作台执行、连接诊断与无法分类的历史请求；旧记录不会被错误归因。已知为规划请求的旧记录会自动补上规划标签。
- 在统计面板说明 Token 数不等于人民币账单金额，账单仍以 DeepSeek 开放平台为准；管理员数据仍不包含提示词、知识库正文或 API Key。
- 为项目用量、连接诊断及来源拆分添加浏览器回归断言；视觉检查小屏管理控制台截图，Token 和分类文本在窄屏卡片中可读。

### 验证与边界

- `npm run lint`、`npx tsc --noEmit`、`npm run build`、`npx prettier --check ...` — 通过。
- `npm run smoke` — 通过，70 项；`npm run smoke:ui` — 通过，139 项；worker 启动、遥测隐私和客户端密钥扫描也通过。
- `git diff --check` — 通过。生产服务结束后确认 3000 端口无监听。
- 未调用 DeepSeek API，因此没有产生模型费用。现有旧执行记录没有可靠的来源标签，不能回溯区分聊天与工作台；Token 分项从新增记录开始准确生效。实际人民币费用仍需看提供方账单。
- 本轮未触发真实 DeepSeek 请求。Google Calendar/GitHub 直连按用户要求暂缓；没有提交或推送远程仓库。

## 2026-11-13｜单机 Docker 持久化部署包

### 完成内容

- 新增多阶段 Dockerfile 与 Compose 配置：以 Node 24 构建生产版 Next.js，容器内以非 root 用户启动 Web 服务和持久队列 worker。
- SQLite 数据与本地语义模型缓存写入命名卷；`.env.local` 只读挂载且被 Docker build context 排除，不进入镜像。端口默认只绑定回环地址，公网部署需另配 HTTPS 反向代理。
- 新增部署说明，写明启动、更新、停止、密钥挂载、单实例 SQLite 限制和命名卷保留规则；验收矩阵明确尚未完成容器实机及公网部署。

### 验证与边界

- `npm run build` — 通过，Next.js 16.4.5 Turbopack 生产构建成功；Compose YAML 使用本机 PyYAML 成功解析，并检查命名卷、只读 `.env.local` 挂载和回环端口绑定。
- Docker Engine/Compose 未安装在当前环境，未声称容器镜像构建或公网部署已通过；Dockerfile 与运行时文件/挂载路径已静态复核。
- 只更新部署文件和文档，未调用 DeepSeek API；未创建提交或推送。

## 2026-11-13｜SQLite 备份与离线恢复

### 完成内容

- 新增 SQLite 在线一致性快照、完整性/核心表校验和离线恢复命令；恢复前自动创建安全快照，恢复操作必须显式确认服务已停止。
- Docker Compose 把备份目录映射到主机并加入 Git/Docker 忽略规则，避免数据库备份进入仓库或镜像。
- 部署手册补充备份、验证、停机恢复和异地主机备份建议；README 与验收矩阵同步。

### 验证与边界

- `npm run smoke:db-maintenance` — 通过；隔离临时 SQLite 数据验证备份完整性、未确认时拒绝恢复、恢复结果正确、并保存恢复前快照；未读取项目实际用户数据库。
- `npm run build` — 通过；Compose YAML 解析、Prettier、客户端 Key 扫描和 `git diff --check` 通过。
- Docker Engine 未安装，容器内实际读写主机备份目录、生产卷备份和恢复演练尚未执行；未调用 DeepSeek API，未提交或推送。

## 2026-11-13｜后台 worker 心跳与服务健康检查

### 完成内容

- 新增 `/api/health`，同时检查 SQLite 可读状态和后台 worker 最近 20 秒内的心跳；状态异常返回 HTTP 503 且禁止缓存。Compose 健康检查已改用该接口，不再仅以首页能打开代表整套服务正常。
- worker 在隔离 SQLite smoke fixture 中记录运行、空闲、停止状态和更新时间；正常退出会留下停止状态，异常退出则由过期心跳判为不健康。
- 将启动进程监督逻辑抽为可单测模块：worker 意外退出时同步终止 Next.js 进程，使部署重启策略能恢复整组服务；Next.js 正常关闭时也会清理 worker。
- 为浏览器烟测加入健康接口断言；部署说明补充健康状态和恢复关系。

### 验证与边界

- `npm run smoke:worker` — 通过；在临时 SQLite 中观察运行、空闲和停止心跳，未触发 AI 请求。
- `npm run smoke:supervisor` — 通过；模拟后台 worker 异常退出及网页正常关闭两种进程生命周期。
- `npm run build`、`npm run lint`、`npx tsc --noEmit` — 通过；最终生产构建无动态文件追踪告警。
- 本机生产服务 `/api/health` 实测返回 HTTP 200 与 `Cache-Control: no-store`；使用 Edge 跑 `npm run smoke:ui`，当时 140 项全部通过。截图保存在当时的系统临时目录，后续不保证保留，不能作为最终参赛证据。
- 浏览器烟测期间数据库没有待执行或运行中的队列任务；没有调用 DeepSeek。服务退出后确认端口 3127 已关闭。
- Docker Engine 未安装，本轮未构建容器或执行 Docker 健康检查；Google Calendar、GitHub 外部授权按用户要求暂缓；未创建提交或推送。

## 2026-11-13｜代码项目依赖声明静态校验

### 完成内容

- 代码项目入库前，除源码语法、本地文件引用和 `package.json` 入口/脚本外，还会检查源码导入的 npm 包及 Vite、Next、Astro、TypeScript 等常见启动命令是否出现在依赖清单中，并校验依赖分组与版本格式。
- 识别 Node 内置模块、路径别名、URL 和虚拟模块；扩充 Vue、Svelte、Astro 文件、CSS `@import`/`url()`、HTML 图片/脚本/样式引用（含裸相对资源路径）及带查询参数资源检查，减少漏文件和误报。
- 新增离线 `npm run smoke:project` 专项烟测，并同步 README、验收矩阵与比赛准备说明。

### 验证与边界

- `npm run smoke:project` — 通过；覆盖依赖声明齐全/缺失、启动脚本工具依赖、Node 内置模块、Vue 本地文件、CSS/HTML 相对与根路径资源齐全/缺失、查询参数资源、缺少清单和无效依赖分组。
- `npm run smoke` — 通过，70 项；对本机生产服务运行，数据库队列为空，未触发 DeepSeek 请求。
- `npm run lint`、`npx tsc --noEmit`、`npm run build`、`npm run check:client-secrets` — 通过。
- 检查只解析源代码，不运行生成项目；不能替代安装依赖后的构建、运行测试或安全沙箱验证。未调用 DeepSeek API，未创建提交或推送。

## 2026-11-13｜统一 Web、worker 与备份工具的 SQLite 路径

### 完成内容

- 修复 Web 主进程忽略 `GOALFLOW_DATABASE_PATH`、而 worker 与备份工具读取该变量的配置分叉；三者现在共用一个路径解析器，默认值仍为 `data/goalflow.sqlite`。
- 自定义数据库目录会由 Web 服务自动创建；数据库维护命令也读取项目 `.env.local`，避免备份/恢复指向默认库而不是应用实际使用的库。
- 在 `.env.example`、README 和部署手册说明可选数据库/备份路径配置及持久卷要求；对照 package scripts、环境模板和运行配置复核 README；检查确认 `.env.local` 被忽略且未跟踪，客户端密钥扫描通过。

### 验证与边界

- `npm run smoke:db-maintenance` — 通过；隔离临时目录验证自定义/默认路径解析及备份恢复，不读写项目用户数据库。
- `npm run smoke:worker`、`npm run smoke:supervisor` — 通过；后台组件仍在独立 SQLite fixture 上运行。
- `npm run lint`、`npx tsc --noEmit`、`npm run build`、`npm run check:client-secrets` — 通过。
- Docker Engine 未安装，未执行容器卷实机挂载；Google Calendar、GitHub 集成按用户要求暂缓；未调用 DeepSeek API，未提交或推送。

## 2026-11-13｜执行产物一致性与隔离端到端烟测

### 本次完成

- 加强工作台 Agent 的固定执行约束：路线、任务、日程、预算和最终文件必须相互一致；并行活动要核算岗位、人手、场地、材料与换场时间；不得把尚未实际完成的联系、预订、招募或线下工作标记为完成；不得凭空增加强制限制。
- 修复端到端 smoke 的数据库路径分叉：认证和清理逻辑现在与应用共用 `GOALFLOW_DATABASE_PATH`，可在临时数据库上完成全流程，不会误操作项目用户数据库。
- 将以上执行约束加入 smoke 回归断言，避免后续提示词调整时意外丢失。

### 验证与边界

- `npm run smoke` — 通过，70 项；使用临时 SQLite 和本地生产服务，未启用实时模型模式、未调用 DeepSeek。
- `npm run build`、`npm run lint`、`npx tsc --noEmit`、`npm run smoke:project`、Prettier 与 `git diff --check` — 通过。
- 烟测能确认约束文本和服务流程正常，不能证明实时模型在所有输入下都严格遵守；正式演示前仍要对活动等真实案例检查路线、排班和最终产物是否互相吻合。
- 未接入 Google Calendar 或 GitHub，按用户要求暂缓；未更改 UI。

## 2026-11-13｜排班与共享资源可行性检查

### 本次完成

- 新增 `validate_feasibility` 执行工具：按明确提供的时段和事实检查同一人重叠排班、同一场地冲突、到场人数超过场地容量，以及并行活动对共享物料的总需求超量。
- 工作台提示词要求在资料包含人员、场地容量或共享物料信息时调用该检查，并在发现冲突后调整、复核；缺少事实时不能把未检查说成通过。
- 将工具接入 Agent 参数校验、工具目录、输出预算、执行事件、遥测白名单和独立代码检查，并为冲突、容量及多人资源重叠加入回归样例。
- 统一 API、浏览器、搜索、视觉和实时 UI smoke 客户端的环境加载与 SQLite 路径：测试使用 `GOALFLOW_DATABASE_PATH` 指定的隔离库，不再硬编码操作默认工作区库；客户端测试进程会清除 API Key，实时 UI 模式仅在显式设置时开启。

### 验证与边界

- `npm run smoke` — 通过，70 项；在隔离临时 SQLite 和本地生产服务上执行，无实时模式、未调用 DeepSeek。用例分别覆盖可行安排与排班、场地、人数、物料冲突。
- `npm run smoke:ui` — 通过，140 项；使用隔离 SQLite，未调用实时模型；覆盖桌面/移动 UI、工作区切换与执行状态恢复等场景。
- `npm run smoke:telemetry` — 通过，5 个 span；新工具可记录固定白名单遥测字段，隐私过滤仍通过。
- `npm run build`、`npm run lint`、`npx tsc --noEmit`、`npm run smoke:project`、`npm run check:client-secrets`、Prettier 和 `git diff --check` — 通过。
- 校验器只验证传入的安排和资源数据，不推断未知人手/库存；未运行实时模型，Agent 对何时调用工具的遵循仍需真实场景复核。为避免额外 API 消耗，实时联网搜索、视觉理解和 UI 实时执行烟测未运行。未接入第三方服务。

## 2026-11-13｜进度问答本地化与额度优化

### 本次完成

- 将纯进度查询改为服务端直接读取当前工作区的执行状态、任务清单、最近保存摘要与成果，不调用 DeepSeek；即使实时 API Key 暂不可用，仍可查看进度。
- 进度答复区分当前工作区运行、其他工作区运行、上轮中断、上轮完成和尚未执行；工具操作次数明确不代表项目完成百分比。
- “进度 + 继续修改/生成/补充”等组合要求不会被状态回答截断，仍交由对话 Agent 判断并转交工作台；带附件的消息继续走完整理解流程。
- 将纯状态识别与答复逻辑提为可测试模块，并补充 README 和验收矩阵说明。

### 验证与边界

- npm run smoke — 通过，71 项；使用隔离 SQLite 和本地生产服务，未调用 DeepSeek。
- npm run smoke:ui — 通过，140 项；覆盖进度问答、后台执行状态、交接及工作区切换，未调用实时模型。
- npm run build、npm run lint、npx tsc --noEmit、npm run check:client-secrets、npm run smoke:project、npm run smoke:telemetry — 通过；遥测 5 个 span。
- 另以纯本地断言验证 6 种状态问法和运行/跨工作区/中断答复。未对 DeepSeek 实时请求做压力或真实费用测量；Google Calendar、GitHub 等外部接入继续暂缓。

## 2026-11-13｜DeepSeek Flash 用量费用估值

### 本次完成

- 管理员用量页按模型名筛选 DeepSeek Flash 与当前仍按 Flash 计费的旧别名，再按当前公开单价估算美元费用范围；不把其他或未知模型的 Token 混进估值。
- 下限假设缓存统计缺失的输入均命中缓存、请求均按非高峰计费；上限假设未测输入均未命中缓存、请求均按高峰计费。另单列供应商明确报告的缓存命中相对未命中的输入费节省，不臆测无缓存数据请求。
- 显示文案说明该值使用当前价回算历史 Token，不等于人民币账单；不计历史价格差异、汇率、赠送额度及独立搜索/抓取收费，真实账单仍以 DeepSeek 平台为准。
- 参考 [DeepSeek V4.1 Flash 官方价格](https://api-docs.deepseek.com/quick_start/pricing/) 和 [缓存命中规则](https://api-docs.deepseek.com/guides/kv_cache/)；截至本记录，Flash 每百万 Token 价格为缓存命中 $0.003/$0.006、未命中 $0.15/$0.30、输出 $0.60/$1.20（非高峰/高峰）。价格可能调整，估值常量需随官方价格更新。

### 验证与边界

- 纯本地 smoke 覆盖缓存数据已测/未测、命中节省与零用量边界；管理页 UI smoke 覆盖费率区间和命中节省说明。
- 未调用 DeepSeek API；此功能只估算已记录模型 Token，不会读取 DeepSeek 账单或推断截图中的历史账单成因。
- Google Calendar、GitHub 等外部授权能力按用户要求暂缓。

## 2026-11-13｜按工作区拆分 Flash 费用估值

### 本次完成

- 管理概览对每个工作区聚合 Flash 输入、输出和供应商确认的缓存统计，不改变原有 Token 来源拆分及按更新时间排序。
- 目标列表展示每个工作区的 Flash 当前价费用区间；有已确认缓存命中时，另列对应的输入费节省区间，便于定位 Token 消耗落在哪些项目。
- 未使用真实模型调用；费用仅为当前美元价回算估值，不作为 DeepSeek 账单记录。

### 验证与边界

- 管理 API smoke 验证项目级 Flash 输入、输出及缓存字段；UI smoke 验证目标行同时显示费用区间与已确认缓存节省，并通过管理员页 axe 检查。
- `npm run build`、`npm run lint`、`npx tsc --noEmit`、`npm run smoke:project`、`npm run check:client-secrets`、72 项 API smoke、140 项 UI smoke 均通过。
- Google Calendar 与 GitHub 外部授权集成继续按用户要求暂缓。

## 2026-11-13｜工作区显示 Flash 费用估值

### 本次完成

- 在实时工作区的用量摘要中显示当前目标的 DeepSeek Flash 美元费用区间，方便用户把费用与具体项目对应起来。
- 只识别 `deepseek-flash`、`deepseek-v4-flash` 和 `deepseek-v4-flash-vision-exp`；演示模式以及其他/未知模型不会显示费用估值。
- 文案说明估值使用当前价格回算已记录 Token，不代表历史账单，不包含汇率、未知模型或独立搜索/抓取费用；管理员页仍可按工作区查看同一类估值。
- UI smoke 在隔离 SQLite 中临时构造实时 Flash 用量，并在 `finally` 中恢复原工作区数据；不会发起真实模型请求。

### 验证与边界

- `npm run smoke` — 通过，72 项；包含已知 Flash 别名与未知模型边界。
- `npm run smoke:ui` — 通过，141 项；验证实时工作区显示费用区间，同时现有管理员估值、演示模式和移动布局检查通过。
- `npm run build`、`npm run lint`、`npx tsc --noEmit`、`npm run smoke:project`、`npm run check:client-secrets` 与 `git diff --check` — 通过。
- 未调用 DeepSeek API，没有产生模型费用；估值无法代替平台账单或单独证明低缓存命中是历史支出的唯一原因。
- Google Calendar、GitHub 等外部授权能力按用户要求暂缓。

## 2026-11-13｜补齐缓存未命中用量解析

### 本次完成

- DeepSeek usage 同时提供缓存命中与未命中字段时，优先使用命中数；如果只返回 `prompt_cache_miss_tokens`，则用输入总数减去未命中数得到命中数。
- 对负数、非整数和大于总输入的统计值做校验与边界截断；缺少两类原始字段时继续标记为无测量样本，不把 SDK 的默认零误当成真实缓存命中。
- 参考 [DeepSeek Context Caching 文档](https://api-docs.deepseek.com/guides/kv_cache/) 的 usage 字段说明。

### 验证与边界

- `npm run smoke` — 通过；纯本地断言覆盖命中优先级、仅有 miss 字段、超界和无统计字段。
- `npm run lint`、`npx tsc --noEmit`、`git diff --check` — 通过。
- 未调用 DeepSeek API；历史用量数据仍无法凭新增解析代码补回当时没有持久化的测量样本。

## 2026-11-13｜校正参赛准备状态记录

- 将比赛准备文档中的 smoke 数量和最新远端提交号更新为当前验收结果（72 项 API smoke、141 项 UI smoke、提交 `11b5403`）。
- 官方大赛首页仅能确认 2026 年 7–11 月报名及 11 月省赛的概览，官方赛道详情页本次无法读取；第三方页面所列 11 月 18 日提交日期继续标为待核准线索，不写成官方确认。
- 保留容器构建、公网 HTTPS、真实模型专项验收和主演示场景为未完成项；不把本地部署配置等同于已上线。
- 增加独立的 `npm run smoke:search:adapter`，只验证 DuckDuckGo 搜索适配器的实时来源，不启动 Agent 或产生模型费用。

### 验证与边界

- 对官方大赛首页进行在线核查；赛道详情原页不可读取，具体提交日期和校内选拔安排仍需通过赛事个人中心/本校赛点核实。
- `npm run smoke:search:adapter` — 通过；当前返回 5 条来源，包含 Next.js 官方文档，全部是有效 HTTP(S) URL。
- 检查准备文档与验收矩阵的当前 smoke 数量和分支提交号；本次增加的是无模型网络搜索 smoke，没有发起 DeepSeek 调用或改变产品运行逻辑。

## 2026-11-13｜修复刷新后工作区工具进度显示

- 工作区进度横幅原先只读当前页面的临时工具计数；刷新页面或从目标列表重新打开正在运行的工作区时，服务端已保存的工具次数可能被显示为 0。
- 现在优先显示该工作区服务端执行状态里的已完成工具次数；当前页面实时执行时，仍回退到本轮的实时计数。
- 行动计划的任务完成率仍表示用户手动确认的清单状态，和工具操作次数分开展示，避免把工具次数误当成项目完成百分比。

### 验证与边界

- `npm run smoke:ui` — 通过，142 项；新增场景先在服务端保存 3 次工具操作，刷新并重新进入工作区后确认横幅仍显示 3 次。
- `npm run lint`、`npx tsc --noEmit`、`npm run build`、`npx prettier --check src/app/page.tsx scripts/ui-smoke.mjs` 通过；未调用 DeepSeek。

## 2026-11-13｜修复浏览器断流后的后台状态与成果恢复

- 浏览器执行流断开时，先查询持久化执行状态；若服务端确认仍在运行，界面继续显示步骤和已完成工具数，不把网络错误误报为 Agent 失败。
- 后台完成后按工作区 ID 拉取最新工作区，自动恢复聊天回复、代码/文档等产物；修正完成恢复读取工作区响应字段错误。
- 继续保留完成状态，不因下一次执行状态轮询而退回旧的“运行中”。
- 增加独立 `npm run smoke:ui:background-status` 与完整 UI smoke 覆盖：模拟断流、后台运行、任务完成、成果同步以及状态跨越后续轮询仍稳定；代码产物夹具通过工作区 schema 校验。

### 验证与边界

- `npm run smoke:ui:background-status` — 通过；使用隔离 SQLite 和 Playwright 请求拦截，没有发起 DeepSeek 请求。
- `npm run smoke` — 通过，72 项；`npm run smoke:ui` — 通过，144 项，含断流与成果恢复场景。
- `npm run lint -- --no-warn-ignored`、`npx tsc --noEmit`、`npm run build`、`npm run check:client-secrets` — 通过。
- 全程未运行真实模型搜索、语音/视觉模型或代码复核；第三方 Calendar/GitHub 授权按用户要求暂缓。

## 2026-11-13｜修复 SQLite 原生模块干净安装与 Docker 运行层

### 本次完成

- 将 `@next/env` 从开发依赖移到生产依赖；启动脚本、后台 worker 与服务端环境配置均在运行时导入它。
- Docker 构建单独安装生产依赖，运行镜像不再复制 ESLint、Playwright、类型声明等开发包。
- 将 `better-sqlite3` 固定到 `12.11.1`。此前 `13.0.3` 在干净 Windows `npm ci` 中触发隐式 `node-gyp rebuild`，因缺少 Visual Studio C++ 工具链而失败；12.11.1 的明确预编译安装路径在当前 Node 24 Windows 环境正常完成。相关上游问题：[WiseLibs/better-sqlite3 #1516](https://github.com/WiseLibs/better-sqlite3/issues/1516)。
- 在隔离目录实际执行 `npm ci --omit=dev`：运行时模块可加载，SQLite 内存数据库可创建，开发工具未安装。

### 验证与边界

- `npm install --save-exact better-sqlite3@12.11.1` — 通过，安装了 Windows Node 24 预编译模块；内存 SQLite 写入烟测通过。
- 隔离目录 `npm ci --omit=dev` — 通过，安装 188 个包并审计 189 个包；`@next/env`、Next、AI SDK 与 SQLite 均可加载，Playwright/ESLint 不存在。
- `npm audit --audit-level=moderate` — 通过，0 个漏洞；`npm run lint`、`npx tsc --noEmit`、`npm run build`、`npm run check:client-secrets`、`npm run smoke:db-maintenance`、`npm run smoke:worker`、`npm run smoke:supervisor` — 通过。
- 本机没有 Docker，因此 Dockerfile 的实际镜像构建仍待有 Docker 的环境验收；本地干净生产依赖安装已按运行层命令单独验证。

### 缓存命中率说明

- 将工作区、管理员汇总和近 7 天趋势的标签统一为“输入 Token 缓存命中率”。悬停说明明确其口径为缓存命中输入 Token / 已测量输入 Token，按 Token 加权而非按请求数计算；未提供统计的请求不进入样本，缓存命中只降低输入费用，不影响输出费用。
- 更新 UI smoke 对新标签的既有断言；生产构建上的 `npm run smoke:ui` 使用临时 SQLite 通过 144 项检查，没有调用模型。
- 标签调整后的 `npm run lint`、`npx tsc --noEmit`、`npm run build`、Prettier 与 `git diff --check` — 通过。

### 技术说明书证据同步

- 将技术说明书中的旧验收数字更新为当前记录的 72 项 API smoke、144 项 Playwright UI smoke 和 5 个 OpenTelemetry span，并补充隔离生产依赖安装的实际验证。
- 明确 Docker 镜像尚未实建验收；安装步骤改用 `npm ci` 按锁文件复现，README 与报告工作稿保持一致。
- 对照 `docs/COMPETITION_READINESS.md` 与 `docs/ACCEPTANCE_MATRIX.md` 核对上述数字和边界；Prettier 与 `git diff --check` 通过。

### 用量与缓存统计口径说明

- 在技术报告中补充项目级 Token 来源归因、供应商报告字段对应的输入缓存命中率公式，以及多请求汇总按 Token 加权的含义。
- 明确无缓存字段的调用不进入命中率样本，缓存命中仅影响输入费；当前价区间不等于历史账单，Search/Fetch 独立费用不包含在模型 Token 估算中。
- 对照 DeepSeek 官方缓存与价格说明复核术语；本次仅更新文档，没有发起模型调用或产生模型费用。

### 赛事校内选拔表述复核

- 官方大赛首页的整体流程写有“院校自行选拔”，同时注明“可由赛点自行组织选拔”。准备清单据此澄清：不能把流程概览解释为每所学校都强制选拔，也不能推断本队学校免选拔，需向本校赛点确认。
- 官方首页没有公布本赛道的精确作品提交日；第三方页面所列 2026-11-18 仍保持待核验，不写成官方截止日期。

## 2026-11-13｜补充缓存命中率的统计覆盖量

### 本次完成

- 在工作区、管理员总览与近七日趋势中，同时显示“缓存统计覆盖率”，说明供应商实际报告缓存字段的输入 Token 占全部输入 Token 的比例。
- 保留“暂无命中率样本”的状态，并明确显示覆盖率，避免把缺少供应商缓存遥测误读为命中率为 0%。
- 管理趋势接口新增每日输入 Token 汇总，为七日覆盖率提供正确分母。
- UI smoke 增加精确样例断言：管理员总览和近七日趋势应按测试数据得出 45.0% 覆盖率。
- 同步 README 与技术说明书工作稿中的缓存指标解释，并把 UI smoke 结果更新为 145 项。

### 验证与边界

- `npm run lint`、`npx tsc --noEmit`、`npm run build`、Prettier 与 `git diff --check` — 通过。
- 生产构建服务上的 UI smoke 使用隔离 SQLite 通过 145 项检查；人工查看手机管理台截图，统计文字和布局正常。
- 未发起 DeepSeek 请求；真实服务端缓存字段是否完整仍以供应商返回内容为准。

## 2026-11-13｜复核依赖安全与容器验收条件

- `npm audit --omit=dev --audit-level=moderate` 与完整 `npm audit --audit-level=moderate` 均通过，报告 0 个漏洞。
- 再次检查部署工具：当前环境没有 Docker CLI，也没有 Podman、nerdctl 或 Buildah；容器镜像构建仍需在具备容器引擎的环境中验收。
- 未运行模型请求；依赖审计未修改依赖清单或锁文件。

## 2026-11-13｜管理员用量增加项目级缓存命中率

- 管理员工作区用量行现在分别显示 Flash 输入 Token 缓存命中率与统计覆盖量；没有可用样本时明确显示“暂无样本”，不把缺失遥测当成 0% 命中。
- UI smoke 在原有工作区用量检查中增加精确值断言：测试目标 1,000/2,200 输入 Token 有缓存统计，350/1,000 命中，即命中率 35.0%、覆盖率 45.5%。该断言合并进现有检查项，UI smoke 总数仍为 145。
- `npm run lint`、`npx tsc --noEmit`、`npm run build`、Prettier、`git diff --check` 与生产构建服务上的 UI smoke 145 项通过；查看 320px 管理台截图，新增项目行数据可读。
- 使用隔离 SQLite 与模拟数据，未调用 DeepSeek API；这项统计只解释应用已采集的请求，不能还原启用埋点之前的历史命中率。

## 2026-11-13｜修正无缓存统计时的零命中误读

- 工作区用量、工作区 Markdown 导出、管理员总览与近七日趋势改为显示供应商报告的缓存命中量及其已统计输入分母；完全没有统计样本时显示“缓存命中暂无统计样本”。
- 增加 UI 回归覆盖：同时验证部分覆盖率、单工作区无缓存字段、管理员全局与趋势零样本状态，防止把缺失遥测显示成真实的 0 命中。
- `npm run smoke` 72 项、生产构建服务上的 `npm run smoke:ui` 147 项通过；`npm run lint`、`npx tsc --noEmit`、`npm run build`、Prettier 与 `git diff --check` 均通过。
- 查看手机管理台、路线选择页和 1366×768 工作区截图，新增统计可读、布局正常；采用隔离 SQLite 与模拟用量，没有调用 DeepSeek API。

## 2026-11-13｜复核桌面计时器代码交付包

- 将 `deliverables/VHFXNEX-Desktop-Timer-v1.0.zip` 解压到系统临时目录，确认包含运行入口、应用模块、测试和 README；归档项目没有第三方运行依赖。
- 在当前 Windows 环境通过 Python 字节码编译、5 项计时状态机单元测试，并确认 Tkinter 8.6 可用。
- 未启动桌面窗口，因此本次证据覆盖源码/核心逻辑和 GUI 依赖可用性；窗口在其他操作系统上的视觉与打包仍需目标环境复核。未调用 DeepSeek API。

## 2026-11-13｜修复桌面计时器窗口控件裁切

- Windows 高 DPI 下实机检查发现默认窗口的运行选项/底部按钮会被垂直空间挤压；压缩非必要留白，并把最小窗口尺寸设为 760×700，保留可调整大小的同时避免裁切。
- 在默认 980×720、980×700 和最小 760×700 尺寸下，人工确认两项运行选项、开始/暂停、重置按钮均完整显示；实际操作 5 分钟预设、开始倒计时、暂停和重置均正常。
- 修复后 `py -m compileall -q .` 与 5 项计时状态机单元测试通过。已更新桌面计时器 README 与交付 ZIP；此处 Windows GUI 验收不覆盖 macOS/Linux 的字体和窗口管理器差异。未调用 DeepSeek API。

## 2026-11-13｜复核联网搜索适配器

- 运行 `npm run smoke:search:adapter`，直接请求 DuckDuckGo 搜索 Next.js instrumentation 文档；返回 5 条含标题、摘要与安全 HTTP(S) 链接的结果，通过数量上限、URL 安全和重复链接检查。
- 本次未发起 DeepSeek 请求，因此只证明外部搜索适配器可用，不代表实时模型已调用工具，也不替代 SSE 来源展示与工作区持久化的真实端到端验收；这部分仍由模拟验收覆盖。

## 2026-11-13｜防止行动方案把现实待办误标完成

- 对照团队提供的活动方案材料发现，历史生成文档把联络学院、招募志愿者、现场布置等现实任务标成已完成，但工作台没有代为执行这些外部操作的工具。
- 加强执行提示，并在服务端保存行动方案时将 Markdown 勾选清单统一规范为未完成；围栏代码示例原样保留。工作台任务状态继续依据实际任务执行状态显示。
- `npm run smoke` 通过 73 项检查，覆盖有序/无序和大小写勾选标记及代码围栏保留；`npm run lint`、`npx tsc --noEmit`、`npm run build`、Prettier 与 `git diff --check` 通过。该修复只约束新生成的方案文档，不会自动改写已有工作区或 PDF。实时模型是否遵守其他非清单式完成描述仍待人工复核；本轮未调用 DeepSeek。

## 2026-11-13｜兼容旧版方案的清单状态

- 打开旧版 AI 初稿时，如果文档带有“Agent 生成的初版方案”标记且包含已勾选清单，预览、编辑和下载内容会将清单恢复为待办，并提示用户按实际进度复核；代码围栏中的示例保持原样。
- 用户可以在编辑器重新勾选并保存；保存后为文档增加用户编辑标记，后续打开不会再次重置。仅在用户保存时持久化，不会自动改写数据库中的旧文件。
- 加入浏览器回归，覆盖普通/大写勾选框、代码示例保留、编辑内容与 Markdown 下载。`npm run smoke:ui` 在独立临时 SQLite 的生产构建服务上通过 148 项；`npm run lint`、`npx tsc --noEmit`、`npm run build`、Prettier 与 `git diff --check` 通过。
- 默认端口的 UI smoke 首次读取了开发数据库中的既有用量，触发一条与本改动无关的覆盖率断言；没有修改用户工作区数据，改用独立临时数据库重跑通过。未调用 DeepSeek API。

## 2026-11-13｜让缓存统计验收兼容真实历史用量

- 移除 UI smoke 对全局缓存覆盖率固定为 38.2% 的假设；改为读取管理员接口的累计用量和近七日汇总，分别核对页面展示的缓存命中率与统计覆盖率。项目级固定样例仍验证精确命中值。
- 使用当前开发数据库的 SQLite 在线备份启动本地生产构建，完整浏览器回归通过 148 项；备份和测试产生的截图均位于系统临时目录，没有改写原数据库。未调用 DeepSeek API。
- 对开发服务器另行试跑时，缓存统计检查通过，但之后邀请弹窗在测试中途消失；生产构建回归中邀请创建/撤销正常。该现象只在本次开发服务器试跑复现，尚未定位到应用代码缺陷。

## 2026-11-13｜消除后台状态回归的烟测竞态

- 定位到开发烟测偶发读到另一个工作区状态的原因：测试先把附件交接设为可立即恢复，再同时插入第二个运行状态；页面刷新后，刚恢复的附件任务会更新得更晚。产品状态条按最近活动显示，因此旧断言受后台恢复时序影响。
- 调整测试夹具：先刷新并等待附件交接完成、待办队列清空，再单独插入运行状态，验证刷新恢复、跨工作区提示、进度问答和停止任务。没有更改产品执行行为。
- `npm run smoke:ui` 在本地开发服务器通过全部 148 项；`node --check scripts/ui-smoke.mjs` 与 `git diff --check` 通过。未调用模型 API。

## 2026-11-13｜补充请求级缓存命中率

- 管理台原本只展示按输入 Token 加权的缓存命中率，容易和“命中请求数占比”混为一谈。现在同步统计命中请求率（至少命中 1 个 Token 的已统计请求 / 有缓存遥测的请求）、Token 命中率（命中 Token / 已统计输入 Token）和覆盖率（有遥测的输入 Token / 全部输入 Token）。
- 新指标覆盖累计用量、近 7 日趋势和 DeepSeek Flash 项目明细；缺少缓存遥测的调用不算作未命中，无样本会明确显示“暂无样本”。这些都是应用实际收到并逐请求保存的供应商用量数据，不会反推 DeepSeek 控制台的其它 API Key 用量。
- API smoke 通过 73 项；浏览器 smoke 通过 148 项，样例同时验证了“1/2 请求命中但 25% Token 命中”和“无缓存统计样本”两种情形。ESLint、TypeScript、Prettier、脚本语法与 `git diff --check` 通过；未调用 DeepSeek API。

## 2026-11-13｜同步缓存指标与验收文档口径

- README 与技术说明书现在分别说明命中请求率、输入 Token 缓存命中率和统计覆盖率；标注请求率是本应用从逐请求供应商 Token 数据派生的指标，缺少缓存字段的请求不参与命中率分母。
- 修正技术说明书中遗留的 72/145 项验收数量，按当前证据记为 73 项 API smoke 和 148 项 UI smoke；接受矩阵的历史记录与当前结果保持可区分。
- 移除比赛准备文档中已经失效的临时截图 GUID，并明确烟测截图含隔离数据、不是最终演示证据；需要在部署环境冻结主演示场景后重新录制和核验产物。
- 本轮重新运行 `npm run smoke`（73 项）、`npm run smoke:ui`（148 项）、生产构建、`npx tsc --noEmit`、相关 ESLint、完整依赖审计（0 个漏洞）、浏览器密钥扫描与 `git diff --check`，均通过。又在 3101 端口启动生产构建服务，以隔离 SQLite 再跑 148 项浏览器 smoke；确认后台 worker 健康且 UI 正常。截图只存于系统临时目录，用于本机复核。未调用 DeepSeek API，也未提交代码。

## 后续记录规则

- 每次真实完成一个功能、修复或验收后，再新增对应记录并提交。
- 记录提交日期、具体变更、验证证据和仍存风险；未执行的检查不得写成通过。
- 团队分工按成员实际贡献填写，不以账号或提交数量推断贡献。

## 2026-11-13｜按 Agent 来源拆分缓存命中指标

- 管理员用量面板新增默认收起的来源明细，按规划 Agent、对话 Agent、工作台 Agent、连接诊断及历史/未分类行，展示命中请求数、请求命中率、输入 Token 命中率和遥测覆盖率。缺少缓存遥测的来源显示“暂无样本”，仍会计入覆盖率分母。
- `/api/admin/overview` 新增按来源聚合的数据；API smoke 覆盖规划、工作台和连接诊断样例，浏览器 smoke 验证规划来源的 Token 命中比例、覆盖率格式，以及对话来源缺少遥测时的无样本表现。
- `npm run smoke` 通过 73 项，`npm run smoke:ui` 通过 149 项，`npm run lint`、`npx tsc --noEmit`、Prettier 与 `git diff --check` 通过。未发起 DeepSeek API 请求，未提交或推送。

## 2026-11-13｜修正 CI 中 API smoke 缺少服务的问题

- 审查 GitHub Actions 发现 API smoke 在没有启动 VHFXNEX 服务时就运行；开发机本地检查曾因 3000 端口已有预览而掩盖这个 CI 缺陷。
- 调整步骤顺序为先准备隔离构建配置并构建，再启动生产服务器和后台 worker；CI 等待 `/api/health` 通过后，在临时 SQLite 上运行 73 项 API smoke，退出时关闭服务，并在失败时附带服务日志。整个流程仍不调用 DeepSeek。
- 本轮通过 `npm run lint`、`npx tsc --noEmit`、`npm run smoke:worker`、`npm run smoke:supervisor`、`npm run smoke:project`、`npm run smoke:telemetry`、`npm run check:client-secrets`、Prettier 与 `git diff --check`；生产构建成功。
- 在 3101 端口启动生产服务与后台 worker，使用独立临时 SQLite 验证 `/api/health` 并通过 73 项 API smoke；原有 3000 端口预览未重启。UI smoke 的 149 项结果来自本次 CI 工作流调整前的独立 UI 回归；本轮没有重复运行浏览器 UI。
- 手动复现时首次把 smoke 命令放在独立 PowerShell 进程，未传入临时数据库变量，造成 smoke 脚本把本地数据库用于密码迁移断言；在同一临时数据库路径下重跑后通过。未修改原数据库内容。构建与 API smoke 使用占位 Key，没有调用 DeepSeek。
- GitHub 托管运行仍待推送后确认；本轮未提交或推送。

## 2026-11-13｜更正比赛准备文档中的 UI 回归环境

- 将 Playwright UI smoke 的执行环境从“本地开发服务”更正为最近一次已记录的隔离本地生产构建服务与临时 SQLite；该回归没有调用 DeepSeek。
- 管理员用量说明进一步明确：命中请求率门槛是至少命中 1 个输入 Token；加入请求命中率与 Token 命中率不一致时的示例，避免用户把请求占比直接当作费用节省比例。
- 依据既有开发记录修正文档，没有重新运行浏览器回归，也没有改动用户数据库。`npx prettier --check`、`npx tsc --noEmit`、`npx eslint src/app/page.tsx` 和 `git diff --check` 通过；未调用 DeepSeek API。

## 2026-11-13｜将浏览器回归纳入 GitHub Actions

- 推送和 PR 工作流现在会安装与 Playwright 版本匹配的 Chromium，并在 API smoke 之后运行完整 UI smoke；服务使用临时 SQLite，`NEXORA_DISABLE_AI=1` 作为额外保护，避免 CI 消耗 DeepSeek 额度。
- 当前生产构建、`npm run smoke:project`、`npm run smoke:telemetry` 与工作流/文档格式检查通过。此前隔离服务上的 149 项 UI smoke 仍是最近一次浏览器回归证据；本轮没有重新跑 UI smoke，GitHub 托管执行结果需推送后确认。
- 未修改用户预览或数据库，未调用模型 API，未推送代码。

## 2026-11-13｜复核缓存命中率口径与提示前缀

- 对照 DeepSeek 官方缓存与 `user_id` 文档，复核项目“请求命中率”是本地根据逐请求缓存 Token 遥测派生的请求占比；费用影响应结合 Token 命中率、遥测覆盖率、输入/输出用量及调用时段判断。
- 检查规划、对话、工作台和复核入口：都按应用账户传递稳定的匿名 `user_id`；工作台将稳定执行规则置于系统提示前缀，动态日期和项目上下文后置。不同职责提示、工具定义及用户内容有差异，因此不能保证跨职责缓存命中。
- 在技术报告补充实现层面的缓存复用条件和隐私取舍。仅做源码与官方文档核对，没有发起真实模型请求、估算真实命中率或产生 API 费用；未改动运行中的服务或数据库。

## 2026-11-13｜复核依赖风险与部署验收边界

- 重新运行完整 `npm audit --audit-level=moderate`，当前锁定依赖报告 0 个已知漏洞；`npm audit --omit=dev` 也为 0。
- 检查 `Dockerfile`、`compose.yaml` 与 `.dockerignore`：容器端口仅绑定本机、SQLite 使用命名卷、Key 以只读环境文件挂载、运行镜像仅安装生产依赖。当前开发环境没有 Docker 或 Podman 命令，所以镜像构建和 Compose 启动仍未实机验收；部署文档继续标明此限制。
- 未修改运行中的预览或数据库，未调用模型 API，未创建镜像、提交或推送。

## 2026-11-13｜去重联网搜索返回的来源

- 搜索解析器现在会规范化结果链接并删除页面片段标记；同一网页即使以多个锚点重复返回，也只保留一条来源。
- `node scripts/search-adapter-smoke.mjs` 返回 5 条有效且不重复的来源，`git diff --check` 通过。该检查没有调用 AI 或消耗模型额度。

## 2026-11-13｜将搜索解析回归纳入 CI

- 将离线解析器检查与实时 DuckDuckGo 联网检查分开；离线检查覆盖页面片段去重和拒绝非 HTTP(S) 链接，并加入 GitHub Actions。实时网络检查仍单独运行，避免 CI 依赖搜索服务的可用性。
- 本地解析回归、联网搜索适配器 smoke、Prettier 和 `git diff --check` 通过。该流程不调用 DeepSeek；GitHub 托管 CI 仍待推送后确认。

## 2026-11-13｜校验生成代码中的 TypeScript 路径别名

- 静态交付检查现在会读取项目根目录的 `tsconfig.json` 或 `jsconfig.json` 中的 `compilerOptions.paths`，并验证所有匹配到的别名（包括 `@/`、`~/` 和自定义前缀）是否能解析到交付包内的文件；解析遵循 TypeScript 的最长前缀优先和映射目标回退规则。未声明在这些配置中的构建器别名保持兼容，不会误报。
- 新增有效映射、缺失目标、无 tsconfig、重叠映射优先级及多目标回退用例。`npm run smoke:project`、相关 ESLint、`npx tsc --noEmit` 与 `git diff --check` 通过。
- 校验仍只解析源码，不执行生成项目；未调用 DeepSeek API，未改动运行中的预览或数据库。

## 2026-11-13｜校验继承配置中的 TypeScript 路径别名

- 静态校验现在使用 TypeScript 配置解析器读取交付包内的 `extends` 配置，因此会按基配置实际位置解析继承的 `paths` 和 `baseUrl`；缺失的本地基配置会给出错误。
- 新增继承别名有效/失效、子配置覆写 `baseUrl`、本地缺失基配置用例，并确认省略 `node_modules` 的交付包不会因 `next/tsconfig` 这类外部依赖配置而误报。
- `npm run smoke:project`、相关 ESLint、`npx tsc --noEmit`、Prettier 和 `git diff --check` 均通过。校验只解析内存中的交付文件，不执行生成源码；本轮不调用模型 API，也不改动预览或数据库。

## 2026-11-14｜单独统计代码复核 Agent 用量

- 工作台内独立执行的代码复核请求现在使用 `reviewer` 来源标记；管理员总览、近七日趋势、项目 Token 汇总和按来源缓存统计均单独展示代码复核 Agent，避免把复核费用与工作台执行混在一起。
- API 与浏览器烟测增加独立来源样例，核对 Token 汇总、请求计数、缓存命中率和覆盖率能够正确显示。已有历史请求如果当时被记录为“工作台”，没有足够信息可靠区分复核调用，保持原分类；本次改动只影响新请求。
- `npm run smoke` 在隔离生产服务和临时 SQLite 上通过 75 项；`npm run smoke:ui` 通过 149 项，覆盖来源拆分、命中请求率、Token 命中率和覆盖率。浏览器回归先发现一条说明文案断言仍用旧口径，已更新后完整重跑通过。
- `npx tsc --noEmit`、定向 ESLint、Prettier、项目静态校验、遥测检查和 `git diff --check` 均通过；临时目录生产构建也通过。整个检查使用占位凭据，没有调用 DeepSeek API，未使用或修改用户预览数据库。

## 2026-11-14｜拆分记录思考 Token 用量

- 读取 DeepSeek 已返回的 `reasoning_tokens` 计数并随规划、对话、工作台和复核请求保存；用量明细可按全局、Agent 来源、工作区和近七日汇总查看，并明确说明思考 Token 已包含在输出 Token 中，不会重复计入费用。只存计数，不保存思考文本；历史记录或供应商未返回该字段时显示“暂无样本”。
- 为现有 SQLite 数据库增加向后兼容迁移；验证新建库的记录与统计，并用旧版 `ai_usage` 表启动隔离服务，确认迁移补齐两个用量字段。
- `npx tsc --noEmit`、ESLint、`npm run build`、`npm run smoke:project`、隔离 API smoke 75 项、浏览器 UI smoke 152 项及 `git diff --check` 通过。UI smoke 首次遇到邀请撤销控件的偶发时序失败，完整重跑通过。
- 全部 API/UI 测试使用临时 SQLite 和 `NEXORA_DISABLE_AI=1` 的隔离服务，没有调用 DeepSeek API，也未读取或修改用户预览数据库；临时测试服务已关闭。
- 复核浏览器流程时，将“本轮完成”提示断言移到演示执行刚结束的位置；邀请页测试会重新加载主页面，恢复的是持久化工作区记录，不应依赖页面内存中的临时状态。使用全新数据库再次运行后，152 项检查全部通过。API smoke 也已指向隔离服务的显式端口后通过 75 项。

## 2026-11-14｜锁定桌面计时器源码与交付 ZIP 一致

- 新增 `npm run smoke:desktop-timer`：逐项比较 `deliverables/desktop-timer` 与提交用 ZIP 的文件清单和内容，并在计时器项目根目录运行 Python 状态机单元测试，防止源码更新后 ZIP 遗留旧版本。
- 将该检查加入 GitHub Actions 与验收矩阵。当前归档的 9 个文件和源码一致，5 项 Python 单元测试通过。
- 检查只解压到内存并在项目目录生成 Python 测试缓存；没有运行桌面 GUI、调用模型 API 或修改用户预览数据库。

## 2026-11-14｜统一多 Agent 的稳定提示前缀

- 把安全、资料不可信和结果真实性规则抽成完全一致的静态系统提示前缀，并用于规划、对话、工作台与代码复核 Agent。动态日期、工作区内容、用户目标和角色专属指令仍放在前缀之后，避免改变各 Agent 的职责或默认深度思考模式。
- 新增 `npm run smoke:agent-prefix`，检查四类请求都引用同一前缀，纳入 GitHub Actions。结构回归只证明请求提示词有可复用前缀，不代表供应商实际命中；仍须以 DeepSeek 返回的缓存 Token 数据测量效果。
- 本轮未发送 DeepSeek 请求；实际命中率和费用变化尚无新样本，不能据此声称已节省额度。

## 2026-11-14｜实测并扩展跨 Agent 缓存前缀

- 首轮四角色短提示探测只含约 135 个输入 Token，均为 0 命中；工作台真实固定提示共 627 个输入 Token，后两次各命中 384 个。对照 DeepSeek 当前缓存规则后确认，短提示探测不能代表长系统提示的复用情况。
- 将通用前缀扩展为所有角色均适用的意图边界、证据与真实性、工具授权、关键决策、隐私和沟通规则；四个 Agent 的角色职责与工具范围仍保留在各自提示词中。
- 使用 `.env.local` 中的凭据、项目 HMAC 伪名算法和隔离测试 ID，依次发送 4 个极短、角色不同的直接 API 探测请求。供应商返回的输入 Token 为 546、550、550、549；缓存命中为 0、384、384、384；每次输出 1 Token。按当前公开价估算四次合计低于 $0.001；没有把测试请求写入应用用量数据库，也没有输出密钥或回答正文。
- 再用项目实际的 `@ai-sdk/deepseek` 与 `streamText` 流式路径重复三角色探测；输入为 545、545、544 Token，缓存命中为 0、384、384，且 `usage.raw` 确实包含供应商缓存命中/未命中字段。这证明应用所用 SDK 路径能读到本次缓存遥测；仍不是浏览器登录后完整工作区流程的验收。
- 该结果证明本次固定前缀可在这个受控样本里跨角色复用 384 个 Token；不证明完整工作区任务的长期命中率或账单节省比例。低于 384 Token 的初始短提示在本次样本中没有命中，后续仍需观察真实应用遥测。
- 扩大长度门槛后的 `npm run smoke:agent-prefix`、ESLint、Prettier 和 `npx tsc --noEmit` 通过。生产构建与浏览器密钥扫描在本轮最终提示词修改后继续复验；未运行完整工作区实时执行，也未提交或推送。

## 2026-11-14｜探测真实视频视觉请求链路

- 新增 `npm run smoke:video` 和纯蓝色 2 秒 MP4 样例；脚本在本机 Chromium 中验证视频附件生成关键帧，再通过隔离账号向真实规划接口发起一次 DeepSeek 视觉请求，并在结束时删除测试账号与工作区。
- 隔离服务日志确认注册成功、`POST /api/plan` 返回 HTTP 200、测试工作区删除成功；数据库复核显示用户、工作区、AI 用量和知识库记录均为 0，3457 隔离开发服务已停止，未触碰 3456 用户预览服务。
- 浏览器烟测进程结束后，最终输出句柄已失效；因此未取回脚本关于“识别蓝色画面”的断言结果和这次请求的 Token/缓存遥测。该次只记录为真实请求链路探测，不作为端到端视觉识别或命中率样本；不要把缺失的用量遥测写成 0。测试调用会产生一次真实 API 费用，精确 Token 和金额无法从本地记录恢复。
- 已加固 `smoke:video`：每次结束都会在系统临时目录写入精简 JSON 结果，记录当前失败阶段、识别断言、模型 Token/缓存遥测是否可用和测试数据清理情况；不会写入目标文本、图片内容、账户 ID 或 API Key。
- 随后用隔离数据库和 3457 端口重跑一次真实浏览器验收：视频帧已提交，模型正确识别蓝色，规划请求消耗 1,247 输入、1,701 输出，共 2,948 Token；缓存遥测可用，命中 0/1,247 输入 Token。烟测随机注册了新账号且只发出一次请求，因此这个零命中样本没有该隔离账号的历史缓存可复用，不能代表日常账号的请求命中率。隔离用户、工作区、用量和知识库行均为 0，测试报告已清理；此单次合成色块样例也不代表复杂真实视频质量。DeepSeek 平台会计入这次真实 API 调用。

## 2026-11-14｜完善语音无结果反馈

- 浏览器语音识别正常结束但没有最终转写时，现在显示“没有识别到语音，请说话后重试或直接输入”；明确的麦克风权限错误保留原有提示，成功转写继续保留浏览器音频处理说明。
- UI 烟测增加静音正常结束和浏览器 `no-speech` 错误分支，并覆盖成功转写、权限拒绝和浏览器不支持。隔离服务 3458、临时 SQLite 上运行 `npm run smoke:ui` 通过 152 个检查点；隔离数据库中的用户、工作区、AI 用量和知识库记录均为 0。3458 已停止，3456 用户预览服务保持运行。
- 组件与烟测脚本的 ESLint、TypeScript 和 Prettier 检查通过；本轮未调用 DeepSeek。

## 2026-11-14｜让 API smoke 在禁用 AI 的隔离环境中通过

- 复核 smoke 服务健康预检后，在 `NEXORA_DISABLE_AI=1` 的推荐隔离配置下发现环境变量解析用例受运行时开关影响：用例想验证 `.env.local` 解析，却继承了 AI 禁用状态，导致读取结果被正确屏蔽为空值。
- 在密钥解析断言前临时清除进程级禁用标记；紧接着仍单独验证禁用标记会屏蔽 Key，并在 `finally` 恢复调用者原始环境。README 的双终端隔离 smoke 示例因此可以原样执行。
- 使用临时 SQLite、隔离端口 3459 与 `NEXORA_DISABLE_AI=1` 运行 `npm run smoke`，76 个检查点通过；空闲端口负向回归也确认服务不可用时会在创建测试账号前给出简短指引。ESLint、TypeScript、Prettier、Node 脚本语法检查通过；本轮未调用 DeepSeek。
- 复查 `npm audit --audit-level=moderate` 与 `npm audit --omit=dev --audit-level=moderate`，全量和生产依赖均报告 0 个漏洞。
- 隔离服务已停止。临时目录中的 `vhfxnex-api-smoke-continued-20261114.sqlite` 删除操作被系统自动安全检查拒绝，因此保留该测试文件；未尝试绕过，未接触 3456 用户预览数据库。

## 2026-11-14｜隔离生产构建与 API/UI 回归复验

- 对当前工作树重新运行 ESLint、TypeScript、生成项目静态校验、Agent 稳定提示前缀、桌面计时器源码/ZIP 对比与 5 项单元测试、搜索解析、遥测隐私和浏览器密钥扫描，全部通过；`npm run build` 生产构建通过。
- 在 3486 回环端口启动隔离生产服务，使用全新系统临时 SQLite、独立会话密钥和 `NEXORA_DISABLE_AI=1` 重跑 API smoke 77 项、Playwright UI smoke 152 项；UI 检查覆盖首页 100% 桌面视口、聊天/路线选择、行动计划独立滚动、AbortError 恢复、下载预览、账户与手机布局。
- 复验没有访问 3456 预览服务，没有调用 DeepSeek，也没有读取或打印 API Key；隔离服务已停止。

## 2026-11-14｜压缩对话 Agent 的工作区上下文

- 对话 Agent 原先每次请求最多携带 60 项任务、12 份成果描述和源码路径；改为附带有界目标文本、已选路线、整体进度、最多 10 项未完成任务、最近 2 项已完成任务和最近 5 份成果摘要，不再携带成果正文或目录路径；每份成果最多保留 4 个文件名，明确标记被省略记录数量。
- 对话模型收到的摘要说明了省略含义，避免把未列出误当成不存在；工作台 Agent 仍从服务端读取完整状态。新增 API smoke 检查任务/成果计数、上下文大小上限和成果正文/内部路径未进入对话摘要。
- `npm run lint`、TypeScript、Prettier、`npm run build`、隔离 `npm run smoke` 78 项和 Playwright `npm run smoke:ui` 152 项通过；测试使用系统临时 SQLite 与 `NEXORA_DISABLE_AI=1`，没有调用 DeepSeek 或访问 3456 预览服务。
- 该调整减少大型工作区对话的重复上下文体积；实际 Token 与费用变化仍需依据后续真实请求遥测比较，不把代码层面的裁剪当作已确认账单节省。

## 2026-11-14｜核实官方 AI Web 赛道组队、截止与交付规则

- 通过 Boxuegu 官方赛道详情页调用的只读 GET 接口读取赛道 ID 10037：确认 2026 年第九届传智杯 AI WEB 网页开发挑战赛为团队赛、每队 3 人；官方报名区间为 2026-07-29 至 2026-11-18，作品提交截止日期为 2026-11-18。
- 摘录官方交付规则：GitHub/Gitee 仓库及 README/Git 历史/环境说明、5–8 分钟且至少 1080p 的 MP4 普通话演示、30 页以内 PDF 技术文档；公网演示为可选加分项，并需在评审期可用。记录官方评分六大维度及 AI 深度/创新细项。
- 官方详情对 11 月 18 日截止与后续“指导提交—评审反馈—最终省赛链接”的描述存在阶段歧义；参赛准备文档按较早日期做硬截止，并列出需从本队个人中心核对的入口/阶段问题。院校组别和校内推荐仍未知。
- 仅执行公开只读请求，没有登录、报名、缴费、联系主办方或调用 DeepSeek；更新参赛准备和技术说明工作稿，没有运行项目测试。

## 2026-11-14｜生成并视觉复核技术说明 PDF 工作稿

- 按当前技术说明 Markdown 工作稿生成 A4 PDF；仅收录一级章节的目录，避免目录跨页并去掉目录标题重复项。最终工作稿为 10 页，低于赛事 30 页限制。
- 使用 Poppler 渲染全部 10 页并检查联系表、封面、目录、正文、密集技术说明和附录页；中文显示、表格边界、页眉页脚和页码均可读，未发现截断或重叠。
- 该 PDF 仍明确标注为工作稿；团队与学校信息、正式演示证据、部署地址和评审账号尚待补齐，不能直接提交。只生成文档，没有调用 DeepSeek，也没有运行或改动应用服务与数据库。

## 2026-11-14｜整理脱敏主演示资料并修正活动场景口径

- 复核团队提供的两份旧活动文件时发现：导出策划里把联办、场地等未完成事项标成已完成；另一处又把“约 20 人”与 5–6 名志愿者混写，四个同时轮转的站点只安排了三名站点主持。这些旧文件未被改动，也不再直接作为公开演示附件。
- 新建脱敏演示资料包和结果验收表：明确以 20 名参与者、另加 5 名志愿者作为本次演示口径；四站同时开放、四名站点主持、一名现场统筹，第六人可选；75 分钟计划须覆盖轮转和换场。场地容量、日期、联办单位和实际物料保持待确认；健康结论要求可靠来源或移除。
- 更新 6 分 30 秒视频脚本与参赛准备/验收矩阵，区分“演示资料已准备”和“真实模型彩排尚未完成”。本轮只整理文档，没有调用 DeepSeek、运行应用或修改用户原始附件。
- 同步更新技术说明附录的事实核对清单并重新导出 PDF；仍为 10 页工作稿，逐页渲染复查封面、目录、正文表格和附录。默认系统 Python 缺少 `reportlab`，改用 Codex 随附 Python 运行环境完成，没有改动项目依赖。

## 2026-11-14｜为主演示资料增加口径一致性检查

- 增加机器可读的主演示场景约束，并新增 `npm run smoke:demo-kit`，核对参与者与志愿者数量、分组、站点、主持岗位、活动时长、预算、未确认事项及规划资料中的完成勾选。
- 将检查加入 GitHub Actions 和验收矩阵；该检查验证演示输入材料之间的一致性，不代表实时模型生成结果、下载产物或现场执行已通过。
- 本轮本地运行无模型静态检查；没有调用 DeepSeek、启动应用或接触预览数据库。

## 2026-11-14｜管理台增加逐请求 AI 用量账本

- 在管理员总览增加最近 100 次服务端 AI 调用明细，包含工作区、Agent 来源、模型、输入/输出/思考 Token、缓存命中/未命中、耗时和 Flash 当前价估值；账本不返回用户 ID、提示词或附件，也明确说明它不包含同一 DeepSeek Key 在其他应用中的调用。
- 管理台给逐请求账本补充 390px 移动卡片布局和溢出检查；API smoke 验证返回字段、数据值与敏感字段缺失，UI smoke 检查账本可见性、WCAG 2.2 AA 和窄屏布局。
- 隔离 SQLite、独立本地端口和 `NEXORA_DISABLE_AI=1` 下，API smoke 81 项、Playwright UI smoke 156 项通过；没有调用 DeepSeek，也未访问用户预览服务。视觉截图保存于系统临时目录，最终仍需人工确认管理员在真实数据下的使用体验。

## 2026-11-14｜支持导出逐请求用量 CSV

- 管理员可将当前最近 100 次 AI 调用下载为带 UTF-8 BOM 的 CSV，含北京时间、工作区、Agent、模型、操作、输入/输出/思考 Token、缓存命中/未命中、覆盖率、耗时和 Flash 当前价估值；不包含用户 ID、提示词或附件。
- 文本字段统一做 CSV 引号转义，并对以公式起始符开头的工作区/来源等字符串添加文本前缀，避免导入表格软件时执行公式；费用估算与 UI 使用同一算法。
- API smoke 校验 BOM、列值、命中计算、无敏感字段及公式注入防护；UI smoke 真实触发下载并读取文件。窄屏检查覆盖新增导出控件；API smoke 82 项、Playwright UI smoke 157 项、`npm run lint`、TypeScript、Prettier、`npm run build` 均通过。隔离数据库、独立端口、`NEXORA_DISABLE_AI=1` 下完成；未调用 DeepSeek，也未访问 3456 预览服务。

## 2026-11-14｜增加 Docker 部署配置静态安全回归

- 扩展 `.dockerignore`，让演示交付物、开发文档、烟测输出/夹具和 GitHub 工作流不进入 Docker 构建上下文；本地环境文件、数据库和备份继续排除，避免密钥、用户数据或非运行资源落入构建缓存。
- 新增 `npm run smoke:container` 并纳入 GitHub Actions，静态验证多阶段生产依赖、非 root 运行、受监督的 worker 启动、只读运行时密钥挂载、SQLite 持久卷、loopback 端口绑定、健康检查和重启/优雅停止设置；28 项检查通过。
- `npm run lint`、`npx tsc --noEmit`、Prettier、`node --check` 和容器静态 smoke 均通过。当前环境没有 Docker/Podman，因此没有声称容器镜像构建、容器启动或公网部署验收通过；这些仍需在有 Docker Engine 和部署主机的环境验证。

## 2026-11-14｜将容器实建与启动检查纳入 CI

- GitHub Actions 新增 Docker Engine 集成步骤：构建生产镜像，等待 Compose 健康检查通过，并从容器内确认服务运行身份不是 root、`/api/health` 可访问；失败时输出容器日志再清理。
- CI 用运行编号隔离命名卷与端口，清理仅作用于这次的临时数据；只把虚构的 CI 环境变量文件设为容器可读，不涉及真实 API Key。
- 容器静态 smoke 更新为 35 项并通过，覆盖 CI 实建/清理配置。当前本机仍无 Docker/Podman，且这次工作流修改尚未在 GitHub Actions 实际运行，因此镜像构建和容器健康结果仍待 CI 运行验证；没有调用 DeepSeek。

## 2026-11-14｜补全中文近似人数的可行性识别

- 活动需求识别补充中文大数、近似人数和口语计数写法，例如“一百多名学生”“50 余人”“数十名嘉宾”和“100 多个人”，避免已有到场人数却漏掉执行可行性复核。
- 保留“邀请多名学生参与”等没有人数范围的说法不触发复核，普通 Web 页面数量也不触发活动检查；新增对应正反例。
- ESLint、Prettier、`git diff --check`、直接识别样例和隔离生产 API smoke（82 个检查点）通过。烟测使用临时 SQLite 和独立端口并禁用 AI 调用；没有调用 DeepSeek，也没有访问用户预览服务。

## 2026-11-14｜确认最新提交通过完整 GitHub Actions CI

- 提交 `1ef4db0` 的 GitHub Actions 运行 #43591464828 全流程成功；覆盖 ESLint、TypeScript、worker 监督、项目静态校验、主演示资料一致性、桌面交付物、搜索解析、遥测隐私、生产构建、客户端密钥扫描、82 项 API smoke、160 项浏览器 UI smoke，以及 Docker 生产镜像和容器健康检查。
- 同步更新验收矩阵和参赛准备表中的 CI 证据链接，避免继续指向旧运行记录。该流水线关闭模型调用；本轮仍未产生 DeepSeek API 费用。

## 2026-11-14｜支持分批生成并恢复较完整的代码项目

- `create_project` 新增 `full`、`patch`、`append` 批次语义：每批最多 20 个文件/45,000 字符，最终项目最多 60 个文件、100,000 个字符及 100,000 UTF-8 字节。完整入口/README 和静态引用、依赖校验在合并最终批次后执行，未完成草稿通过工作区检查点保存，可在中断后续写；代码项目 ZIP 与持久化校验同步扩容。
- 补充批次合并、补丁覆盖/删除、项目总量与 UTF-8 限制、工具参数，以及执行检查点保留和清除草稿的 smoke 用例。`npm run smoke:project`、ESLint、TypeScript、Prettier、`git diff --check` 均通过；首次 smoke 揭露的“完整草稿空删除列表误判”已修复并通过复跑。
- 首次推送的 CI 生产构建、静态检查通过；API smoke 在旧断言处失败，原因是首批生成所需的宽松校验误影响了一次性完整项目。已将提前校验限定为 `full + complete`，保留不完整批次的合并后校验；项目 smoke、参数回归、ESLint、TypeScript 和 Prettier 已通过。修复后的完整 CI 待重跑确认。没有调用 DeepSeek，也未触碰未跟踪的 `output/`。
- 修复提交 `16fabbf` 的 GitHub Actions 运行 #43602412503 全流程成功：生产构建、客户端密钥扫描、82 项 API smoke、160 项 UI smoke 和 Docker 镜像健康检查通过；项目分批静态回归及其他工作流检查也通过。CI 使用临时数据库并禁用 AI，没有消耗 DeepSeek 配额。

## 2026-11-14｜补齐分批代码交付失败恢复回归

- 将代码批次合并、入口/README 要求和静态校验抽到纯投递函数，执行接口与回归检查共用同一实现；最终批次校验失败时会保留草稿，允许 Agent 通过后续 append 修复。
- 新增一条端到端批次逻辑回归：保存首批 README 与源码，模拟缺少入口的最终批次并确认拒绝，经过执行检查点恢复草稿，再追加 `index.html`，确认完整项目和本地引用检查通过。
- `npm run smoke:project`、隔离 API `npm run smoke`（82 项，`NEXORA_DISABLE_AI=1`）、全量 ESLint、TypeScript、生产构建、改动源码 Prettier 与 `git diff --check` 均通过；未调用 DeepSeek。隔离服务已停止，未触碰未跟踪的 `output/`。
- 追加复核多批次 `patch`：最终结果现在汇总所有被修改的路径及早期批次的删除路径，不再只报告最后一批；新增旧项目文件保留、变更覆盖、跨批删除和项目名称/说明保留断言。`npm run smoke:project`、TypeScript、定向 ESLint 与改动源码 Prettier 通过，未调用 DeepSeek。
