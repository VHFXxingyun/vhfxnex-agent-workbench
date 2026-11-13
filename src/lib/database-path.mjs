import path from "node:path";

export function resolveDatabasePath(
  configuredPath = process.env.GOALFLOW_DATABASE_PATH,
  cwd = process.cwd(),
) {
  return path.resolve(cwd, configuredPath || path.join("data", "goalflow.sqlite"));
}
