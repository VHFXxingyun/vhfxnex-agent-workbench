import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { superviseProcesses } from "./process-supervisor.mjs";

function waitWithin(promise, timeoutMs = 5_000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Process supervisor smoke timed out.")), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

const unexpectedNext = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  stdio: "ignore",
  windowsHide: true,
});
const failingWorker = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(7), 200)"], {
  stdio: "ignore",
  windowsHide: true,
});
const errors = [];
const originalError = console.error;
console.error = (message) => errors.push(String(message));
let unexpectedExit;
try {
  unexpectedExit = await waitWithin(
    superviseProcesses(unexpectedNext, failingWorker, { handleSignals: false }),
  );
} finally {
  console.error = originalError;
  if (unexpectedNext.exitCode === null && unexpectedNext.signalCode === null) unexpectedNext.kill();
  if (failingWorker.exitCode === null && failingWorker.signalCode === null) failingWorker.kill();
}
assert.equal(unexpectedExit, 1, "Unexpected worker exit must fail the supervised service.");
assert.match(errors.join("\n"), /后台任务服务意外退出/);
assert.ok(
  unexpectedNext.exitCode !== null || unexpectedNext.signalCode !== null,
  "Unexpected worker exit must stop the web process.",
);

const cleanNext = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), 150)"], {
  stdio: "ignore",
  windowsHide: true,
});
const idleWorker = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  stdio: "ignore",
  windowsHide: true,
});
const cleanExit = await waitWithin(
  superviseProcesses(cleanNext, idleWorker, { handleSignals: false }),
);
assert.equal(cleanExit, 0, "A clean web shutdown should stop the worker without an error.");
assert.ok(
  idleWorker.exitCode !== null || idleWorker.signalCode !== null,
  "A clean web shutdown must stop the worker.",
);

console.log(
  "✓ Process supervisor stops the web app on worker failure and shuts down both cleanly.",
);
