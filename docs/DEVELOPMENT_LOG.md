# VHFXNEX 开发记录

本记录从项目基线提交后开始，按实际完成时间记录开发、验收与发布情况。未完成的工作会标为“待完成”，不把计划写成已实现内容，也不补造过去的提交历史。

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
- 本机生产服务 `/api/health` 实测返回 HTTP 200 与 `Cache-Control: no-store`；使用 Edge 跑 `npm run smoke:ui`，140 项全部通过。验收截图目录：`nexora-ui-smoke-a63e9743-aa39-40ab-9c35-bb130ec77e75`。
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

## 后续记录规则

- 每次真实完成一个功能、修复或验收后，再新增对应记录并提交。
- 记录提交日期、具体变更、验证证据和仍存风险；未执行的检查不得写成通过。
- 团队分工按成员实际贡献填写，不以账号或提交数量推断贡献。
