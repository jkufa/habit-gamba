import { loadBaseEnv } from "@habit-gamba/env";

const env = loadBaseEnv();
let shuttingDown = false;

console.log(`bot worker online logLevel=${env.LOG_LEVEL}`);

function shutdown(signal: string) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`bot worker shutting down signal=${signal}`);
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

setInterval(() => {
  if (!shuttingDown) {
    console.log("bot worker heartbeat");
  }
}, 60_000);
