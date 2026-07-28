import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const command = process.argv[2];
if (!["build", "start"].includes(command)) {
  console.error("Verwendung: node raspberry/run-with-runtime.mjs build|start");
  process.exit(2);
}

const executable = fileURLToPath(
  new URL(
    `../node_modules/.bin/vinext${process.platform === "win32" ? ".cmd" : ""}`,
    import.meta.url,
  ),
);
const child = spawn(executable, [command], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    VEREINSKASSE_RUNTIME: "raspberry",
  },
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
