#!/usr/bin/env node
//
// `npx wrangler login` from WSL2 when the browser runs on Windows.
//
// Symptom: you authorize in Chrome, the page says "Authorization granted to
// Wrangler", and the terminal never comes back — no credentials are written.
//
// Cause: Chrome opens TWO connections to the callback server (the second is a
// speculative one it keeps idle). Wrangler exchanges the auth code successfully,
// then calls `server.close(cb)`, whose callback only fires once EVERY connection
// is gone. Node closes the connection that carried the request, but the idle
// speculative one keeps the server — and the login promise — open forever.
//
// Fix: keep port 8976 (hard-coded in the OAuth redirect_uri) in front of a relay
// that opens an upstream socket only when a request actually arrives, and drops
// it once the response is through. Wrangler's own server listens on 8977, so it
// never sees Chrome's idle socket.
//
//   Usage:  node scripts/wrangler-login-wsl.mjs [extra wrangler login flags]
//
// Anything else (native Linux, macOS) can keep using plain `npx wrangler login`.
import net from "node:net";
import { spawn } from "node:child_process";

const PUBLIC_PORT = 8976; // what the OAuth redirect_uri points at
const INNER_PORT = 8977; // where wrangler's callback server actually listens
const DRAIN_MS = 500; // grace period after the response before cutting upstream

const clients = new Set();

const relay = net.createServer((client) => {
  clients.add(client);
  client.on("error", () => {});
  client.on("close", () => clients.delete(client));

  let upstream = null;
  client.on("data", (chunk) => {
    // Lazy connect: an idle speculative socket sends nothing, so wrangler never
    // sees it — that is the whole point of this relay.
    if (!upstream) {
      upstream = net.connect(INNER_PORT, "127.0.0.1");
      upstream.on("error", () => client.destroy());
      upstream.on("close", () => {
        upstream = null;
      });
      upstream.on("data", (data) => {
        client.write(data);
        // Response delivered (and the token already exchanged): let go of the
        // socket so wrangler's server.close() can finally complete.
        const socket = upstream;
        setTimeout(() => socket.destroy(), DRAIN_MS);
      });
    }
    upstream.write(chunk);
  });
});

relay.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `✗ port ${PUBLIC_PORT} is busy — stop whatever holds it (a previous \`wrangler login\`?) and retry.`
    );
  } else {
    console.error(err);
  }
  process.exit(1);
});

relay.listen(PUBLIC_PORT, "localhost", () => {
  const child = spawn(
    "npx",
    ["--yes", "wrangler", "login", "--callback-port", String(INNER_PORT), ...process.argv.slice(2)],
    { stdio: "inherit" }
  );
  child.on("exit", (code) => {
    // Chrome's idle socket would keep this process alive too.
    for (const client of clients) client.destroy();
    relay.close();
    process.exit(code ?? 1);
  });
});
