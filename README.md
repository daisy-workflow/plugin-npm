# npm plugin for Daisy-workflow

One Daisy node that queries the npm registry. The action is selected
per-node via the **operation** dropdown.

## Operations

| operation            | What it does                                                                  |
|----------------------|-------------------------------------------------------------------------------|
| `package.info`       | Get metadata for a package. With `version` set, returns just that manifest.   |
| `package.search`     | Full-text search over the registry. Paginated via `size` + `from`.            |
| `package.downloads`  | Download stats for a package over `last-day`, `last-week`, `last-month`, or `last-year`. |

**No publish / install operations.** Those need privileged worker setup
and rarely make sense in a workflow context. If you need them, the
builtin `shell.exec` plugin can run `npm publish` directly.

## Auth

The public registry (`https://registry.npmjs.org`) requires no auth.
The plugin works out of the box.

For **private registries** (JFrog Artifactory, GitHub Packages,
Verdaccio, etc.), either pass `registryUrl` + `token` directly on the
node, or store them in a workspace `generic` config and reference it
via the `config` input:

| Config key   | Example                                              |
|--------------|------------------------------------------------------|
| `registryUrl`| `https://npm.pkg.github.com`                         |
| `token`      | `ghp_…` (sent as `Authorization: Bearer <token>`)    |

Node-level inputs win over the config.

The `package.downloads` operation always hits the public
`api.npmjs.org` host — private registries don't host the downloads API.

## Install

```bash
docker compose -f docker-compose.yml -f docker-compose.plugins.yml \
  --profile npm up -d

npm run install-plugin -- --endpoint http://daisy-npm:8080
```

## Per-operation inputs

- `package.info` — `package` (required), `version` (optional — a specific
  version or a dist-tag like `latest` / `beta`)
- `package.search` — `query` (required), `size` (1–250, default 20),
  `from` (default 0)
- `package.downloads` — `package` (required), `period` (default
  `last-week`)

Shared by every op: `registryUrl`, `token`, `config`, `timeoutMs`.

## Output envelope

```json
{
  "ok":        true,
  "operation": "package.info",
  "status":    200,
  "result":    { "name": "@daisy-workflow/plugin-sdk", "dist-tags": { "latest": "0.1.0" }, "versions": { ... } },
  "url":       "https://www.npmjs.com/package/@daisy-workflow/plugin-sdk"
}
```

Operation-specific `result`:

- `package.info` (no version) → full package document with every version
- `package.info` (with version) → that single version's manifest (package.json)
- `package.search` → `{ results: [{ name, version, description, keywords, date, score, publisher, links }], total, from, size }`
- `package.downloads` → `{ downloads: <number>, start, end, package }`

## Example workflows

**Notify Slack when a package publishes a new version** — schedule
trigger → `package.info` → `transform` comparing `dist-tags.latest`
against a ctx memory variable → `slack.send` if different →
`memory.set` to persist the new version.

**Audit a package's popularity before adopting** — `package.info` to
verify the package exists → `package.downloads` (last-month) →
`package.search` for `keywords:<topic>` to compare against alternatives
→ aggregate the results in a `transform` node.

## Files

```
plugins-external/npm/
├── manifest.json        # node schema
├── index.js             # servePlugin entry, dispatches by operation
├── lib/
│   ├── client.js        # registry resolver + fetch wrapper
│   └── actions.js       # one handler per operation
├── package.json
├── Dockerfile
└── README.md
```
