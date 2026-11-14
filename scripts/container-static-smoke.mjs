import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [dockerfile, dockerIgnore, compose, workflow] = await Promise.all([
  readFile("Dockerfile", "utf8"),
  readFile(".dockerignore", "utf8"),
  readFile("compose.yaml", "utf8"),
  readFile(".github/workflows/ci.yml", "utf8"),
]);
let checks = 0;

function check(condition, message) {
  checks += 1;
  assert.ok(condition, message);
}

function hasLine(source, pattern) {
  return pattern.test(source);
}

const normalizedIgnore = dockerIgnore.replaceAll("\\", "/");
for (const [pattern, description] of [
  [/^\.env\*$/m, "all local environment files must be excluded from the build context"],
  [/^!\.env\.example$/m, "the safe environment template may be included"],
  [/^data\/?$/m, "local database and model data must be excluded"],
  [/^backups\/?$/m, "database backups must be excluded"],
  [/^deliverables\/?$/m, "competition deliverables must not enter image build layers"],
  [/^docs\/?$/m, "development documents must not enter image build layers"],
  [/^output\/?$/m, "generated smoke output must not enter the build context"],
  [/^scripts\/fixtures\/?$/m, "smoke fixtures must not enter the build context"],
]) {
  check(hasLine(normalizedIgnore, pattern), description);
}

const runnerIndex = dockerfile.indexOf(" AS runner");
const runner = runnerIndex >= 0 ? dockerfile.slice(runnerIndex) : "";
const productionDependenciesStart = dockerfile.indexOf(" AS production-dependencies");
const productionDependenciesEnd = dockerfile.indexOf(" AS runner");
const productionDependencies =
  productionDependenciesStart >= 0 && productionDependenciesEnd > productionDependenciesStart
    ? dockerfile.slice(productionDependenciesStart, productionDependenciesEnd)
    : "";

check(
  /FROM\s+node:24-bookworm-slim\s+AS\s+dependencies/i.test(dockerfile),
  "dependency stage must use the pinned Node 24 base image",
);
check(
  /FROM\s+node:24-bookworm-slim\s+AS\s+builder/i.test(dockerfile),
  "build stage must use the pinned Node 24 base image",
);
check(
  /FROM\s+node:24-bookworm-slim\s+AS\s+production-dependencies/i.test(dockerfile),
  "production dependency stage must use the pinned Node 24 base image",
);
check(
  /FROM\s+node:24-bookworm-slim\s+AS\s+runner/i.test(dockerfile),
  "runtime stage must use the pinned Node 24 base image",
);
check(
  /RUN\s+npm\s+ci\s+--omit=dev/m.test(productionDependencies),
  "runtime dependencies must be installed without development packages",
);
check(
  /COPY\s+--from=production-dependencies\s+\/app\/node_modules\s+\.\/node_modules/m.test(runner),
  "runtime must use the production-only dependency stage",
);
check(
  /^USER\s+node\s*$/m.test(runner),
  "the runtime process must run as the unprivileged node user",
);
check(
  /chown\s+-R\s+node:node\s+\/app\/data\s+\/app\/\.next/.test(runner),
  "runtime writable paths must be owned by node",
);
check(
  !/^\s*COPY\b.*\.env(?:\.|\s|$)/im.test(dockerfile),
  "the image must never copy a local environment file",
);
check(
  !/^\s*(?:ARG|ENV)\s+(?:DEEPSEEK_API_KEY|SESSION_SECRET)\s*=/im.test(dockerfile),
  "secret values must not be build arguments or image environment defaults",
);
check(
  /scripts\/next\.mjs/.test(runner) && /scripts\/process-supervisor\.mjs/.test(runner),
  "runtime must include the supervised server launcher",
);
check(
  /scripts\/workbench-worker\.mjs/.test(runner),
  "runtime must include the persistent workbench worker",
);
check(
  /CMD\s+\[\s*"node"\s*,\s*"scripts\/next\.mjs"/m.test(runner),
  "container startup must use the supervised Next.js launcher",
);

check(
  /127\.0\.0\.1:\$\{GOALFLOW_HOST_PORT:-3000\}:3000/.test(compose),
  "the app port must bind to loopback by default and allow an isolated CI port",
);
check(
  !/0\.0\.0\.0:3000:3000/.test(compose),
  "the app port must not be exposed directly to the public network",
);
check(
  /name:\s*\$\{GOALFLOW_VOLUME_NAME:-vhfxnex_goalflow_data\}/.test(compose),
  "the persistent volume must keep its stable default name and allow isolated CI storage",
);
check(
  /goalflow_data:\/app\/data/.test(compose),
  "SQLite and local model data must use the named persistent volume",
);
check(
  /source:\s*\.\/\.env\.local[\s\S]*?target:\s*\/app\/\.env\.local[\s\S]*?read_only:\s*true/.test(
    compose,
  ),
  "the local environment file must be mounted read-only at runtime",
);
check(
  /fetch\('http:\/\/127\.0\.0\.1:3000\/api\/health'\)/.test(compose),
  "container healthcheck must call the application health endpoint",
);
check(
  /restart:\s*unless-stopped/.test(compose),
  "the app must restart after an unexpected container exit",
);
check(
  /stop_grace_period:\s*30s/.test(compose),
  "the container must allow time for worker shutdown",
);
check(
  /docker compose -p "\$project" up --build --detach --wait --wait-timeout 180/.test(workflow),
  "CI must build the image and wait for its application healthcheck",
);
check(
  /docker compose -p "\$project" down --volumes --remove-orphans/.test(workflow),
  "CI must remove only its isolated container volume after the smoke run",
);
check(
  /GOALFLOW_VOLUME_NAME="vhfxnex-ci-data-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}"/.test(
    workflow,
  ),
  "CI must use a unique throwaway data volume",
);
check(
  /GOALFLOW_HOST_PORT=39217/.test(workflow),
  "CI must avoid colliding with the app smoke server",
);
check(
  /chmod 0644 \.env\.local/.test(workflow),
  "the fake CI env file must be readable by the non-root container user",
);
check(/process\.getuid\(\) === 0/.test(workflow), "CI must verify the app process is not root");

console.log(
  `✓ Container configuration static smoke passed: ${checks} checks. This validates CI wiring but does not replace a successful Docker image build or deployment.`,
);
