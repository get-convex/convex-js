#!/usr/bin/env node
import { spawnSync } from "child_process";

// Windows uses 'python', Unix uses 'python3'
const pythonCmd = process.platform === "win32" ? "python" : "python3";
const args = process.argv.slice(2);

const result = spawnSync(pythonCmd, args, {
  stdio: "inherit",
  shell: true,
});

process.exit(result.status);
