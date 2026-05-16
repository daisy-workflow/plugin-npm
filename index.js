// npm — registry queries from a workflow. The action is selected
// per-node via the `operation` input.
//
// Wire it up:
//   1. `docker compose -f docker-compose.yml -f docker-compose.plugins.yml \
//          --profile npm up -d`
//      `npm run install-plugin -- --endpoint http://daisy-npm:8080`
//   2. (Optional) Create a workspace `generic` config holding
//      `registryUrl` and `token` if you want to point at a private
//      registry like JFrog Artifactory.

import { servePlugin } from "@daisy-workflow/plugin-sdk";
import fs from "node:fs";

import { resolveRegistry } from "./lib/client.js";
import { OPERATIONS }      from "./lib/actions.js";

const manifest = JSON.parse(
  fs.readFileSync(new URL("./manifest.json", import.meta.url), "utf8"),
);

servePlugin({
  manifest,
  async execute(input, ctx) {
    const { operation } = input || {};
    if (!operation) throw new Error("`operation` is required (see manifest enum for valid values)");

    const handler = OPERATIONS[operation];
    if (!handler) {
      throw new Error(
        `unknown operation "${operation}". Valid: ${Object.keys(OPERATIONS).join(", ")}`,
      );
    }

    // Resolve registry + token from the optional config / inputs. The
    // public registry needs no auth, so this is mostly a passthrough.
    const auth = resolveRegistry(ctx, input);
    const { status, result, url } = await handler(auth, input, ctx?.signal);
    return { ok: true, operation, status, result, url };
  },
  async readyz() { return true; },
});
