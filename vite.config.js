import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The farm lives in React state as class instances. Fast Refresh reloads a
 * module's *code* while keeping objects built from the old one, so editing a
 * model class leaves a live Farm whose prototype predates the change — and it
 * fails on the first call to a method that didn't exist yet. There is nothing
 * to patch: reload the page instead.
 */
const reloadOnModelChange = {
  name: "reload-on-model-change",
  handleHotUpdate({ file, server }) {
    if (!file.includes("/src/model/")) return undefined;
    (server.hot ?? server.ws).send({ type: "full-reload" });
    return [];
  },
};

export default defineConfig({
  plugins: [react(), reloadOnModelChange],
  // ClaudeMind asks /decide what an animal should want. Forwarding it keeps the
  // API key in the proxy, where the page cannot read it. Nothing else needs it,
  // and the farm still runs with no proxy at all — see src/model/minds/.
  // 127.0.0.1 rather than localhost: the proxy binds loopback v4, and localhost
  // can resolve to ::1 first, where nothing is listening.
  server: { proxy: { "/decide": "http://127.0.0.1:8787" } },
});
