export function superviseProcesses(next, worker, { handleSignals = true } = {}) {
  let shuttingDown = false;
  let exitCode = 0;
  let nextExited = false;
  let workerExited = !worker;

  return new Promise((resolve) => {
    const cleanup = () => {
      if (!nextExited || !workerExited || !handleSignals) return;
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onInterrupt);
    };
    const settle = () => {
      cleanup();
      if (nextExited && workerExited) resolve(exitCode);
    };
    const stopChildren = (code, reason) => {
      if (shuttingDown) return;
      shuttingDown = true;
      exitCode = code;
      if (reason) console.error(reason);
      if (next.exitCode === null && next.signalCode === null) next.kill();
      if (worker && worker.exitCode === null && worker.signalCode === null) worker.kill();
      settle();
    };
    const onInterrupt = () => stopChildren(0);

    if (handleSignals) {
      process.on("SIGINT", onInterrupt);
      process.on("SIGTERM", onInterrupt);
    }

    next.once("error", (error) => {
      stopChildren(1, `Could not start the Next.js server: ${error.message}`);
    });
    next.once("close", (code) => {
      nextExited = true;
      if (!shuttingDown) {
        shuttingDown = true;
        exitCode = code ?? 1;
        if (worker && worker.exitCode === null && worker.signalCode === null) worker.kill();
      }
      settle();
    });

    if (worker) {
      worker.once("error", (error) => {
        stopChildren(1, `Could not start the workbench worker: ${error.message}`);
      });
      worker.once("close", (code, signal) => {
        workerExited = true;
        if (!shuttingDown) {
          stopChildren(
            1,
            `工作区后台任务服务意外退出（${signal || `exit ${code}`}），正在关闭网页服务以触发恢复。`,
          );
        }
        settle();
      });
    }
  });
}
