# 单机 Docker 部署

此方案把 VHFXNEX 部署到一台 Linux 主机或本地 Docker Desktop，使用 Docker 命名卷保存 SQLite 数据库和本地语义模型缓存。应用仅运行一个实例；它不适用于无持久磁盘的平台、多副本或多主机横向扩容。

## 首次启动

需要 Docker Engine 与 Docker Compose v2。先在项目根目录准备 `.env.local`；已有该文件时保留原内容，不要覆盖 API Key：

```powershell
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
```

在 `.env.local` 中配置：

- `SESSION_SECRET`：至少 32 字节的随机值。
- `ADMIN_EMAIL`：评审/管理员账号注册时使用的邮箱。
- `DEEPSEEK_API_KEY`：如需实时 AI 功能，填写服务端 API Key；留空会进入演示模式。

可用 Node.js 生成会话密钥，然后手动粘贴到文件：

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

准备主机备份目录（备份含用户资料和工作区数据，请限制主机文件权限）：

```powershell
New-Item -ItemType Directory -Force backups | Out-Null
```

Linux 主机应让容器 UID 1000 可写该目录，同时仅允许管理员读取备份。

启动和检查：

```powershell
docker compose up --build -d
docker compose ps
docker compose logs -f app
```

本机访问 <http://localhost:3000>。Compose 将 `.env.local` 以只读文件挂载到容器，密钥不会写进镜像；SQLite 数据库与 `data/models` 语义模型缓存保存在名为 `vhfxnex_goalflow_data` 的持久卷中。

默认 SQLite 路径为 `data/goalflow.sqlite`。如设置 `GOALFLOW_DATABASE_PATH`，Web 服务、worker 和数据库备份命令会读取同一文件；Docker 部署时请把自定义路径放在 `/app/data` 持久卷内，避免容器重建后数据丢失。

容器以 Node 镜像自带的非 root `node` 用户（UID 1000）运行。在 Linux 主机上请确认这个用户可以读取 `.env.local`；不要为了挂载而把密钥文件设为所有用户可读。

健康检查访问 `/api/health`：它会验证 SQLite 可读，并确认后台 worker 在最近 20 秒内写入了心跳。`npm run dev` / `npm start` 由启动脚本同时监督网页和 worker；worker 意外退出时会关闭网页进程，使容器的重启策略可以恢复整组服务。Compose 的 healthcheck 负责报告异常状态，进程退出由启动脚本和容器重启策略处理。

## 更新、停止和数据保留

```powershell
docker compose up --build -d
docker compose stop
docker compose start
docker compose down
```

`docker compose down` 会保留命名卷。**不要运行 `docker compose down -v`，除非确定要永久删除数据库和模型缓存。**请定期备份 Docker 卷；部署前也应验证备份可恢复。SQLite 只支持此方案中的单实例本地卷，不要把同一个数据库卷挂给多个应用实例或放在不保证文件锁语义的网络盘上。

创建与检查数据库备份：

```powershell
docker compose exec app npm run db:backup
docker compose exec app npm run db:verify -- /backups/备份文件名.sqlite
```

备份文件默认写入主机项目目录下的 `backups/`，已加入 Git 与 Docker 忽略列表；可在 `.env.local` 通过 `GOALFLOW_BACKUP_DIR` 指定其他位置。恢复时必须先停掉 Web 服务和 worker；恢复脚本会在覆盖前创建一份安全快照，并要求显式确认：

```powershell
docker compose stop app
docker compose run --rm --no-deps app npm run db:restore -- /backups/备份文件名.sqlite --confirm-offline
docker compose start app
```

可以先在隔离数据目录验证备份恢复，不要拿唯一备份直接覆盖生产数据。备份应复制到主机之外的安全位置，避免主机故障同时损坏数据库和备份。

## 公网访问

端口默认只绑定 `127.0.0.1`。公网评审时应在主机上配置 HTTPS 反向代理，将流量转发到本机 `3000` 端口；不要直接把应用端口暴露到公网。反向代理若要让限流读取真实客户端地址，只在代理链完全可信且转发规则正确时，才在 `.env.local` 设置准确的 `NEXORA_TRUSTED_PROXY_HOPS`。

发布前仍需单独确认主机、TLS 域名、管理员评审账号、备份恢复和真实评审流程。这个配置解决单机持久化部署，不代表已经完成公网部署或上线验收。
