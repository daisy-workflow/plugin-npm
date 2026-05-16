// Operation handlers for the npm plugin. One async function per
// operation, all sharing the registry client.

import {
  registryFetch,
  encodePackage,
  npmjsUrl,
  DOWNLOADS_HOST,
} from "./client.js";

// ── package.info ───────────────────────────────────────────────────────
// Two response shapes:
//   • With `version` set — return the manifest for that single version
//     (or dist-tag like "latest" / "beta"). Same shape as a
//     package.json — name, version, dependencies, scripts, dist, …
//   • Without `version` — return the full package document: name,
//     description, dist-tags, all versions, maintainers, etc. Large
//     payload, but useful for "what versions exist".
export async function packageInfo(auth, input, signal) {
  const { package: pkg, version, timeoutMs = 15000 } = input || {};
  if (!pkg) throw new Error("operation=package.info requires `package`");

  const path = version
    ? `/${encodePackage(pkg)}/${encodeURIComponent(version)}`
    : `/${encodePackage(pkg)}`;

  const { status, body } = await registryFetch(auth, path, { method: "GET" }, timeoutMs, signal);
  return {
    status,
    result: body,
    url:    npmjsUrl(pkg),
  };
}

// ── package.search ─────────────────────────────────────────────────────
// Uses the registry's /-/v1/search endpoint (size 1-250, from = offset).
// Slim down the response into { results, total } where each result is a
// flattened `{ name, version, description, keywords, date, score }` —
// the raw API response wraps everything in `package`/`score` nesting
// that's awkward to use in workflows.
export async function packageSearch(auth, input, signal) {
  const { query, size = 20, from = 0, timeoutMs = 15000 } = input || {};
  if (!query || !String(query).trim()) {
    throw new Error("operation=package.search requires `query`");
  }
  const qs = new URLSearchParams({
    text: String(query).trim(),
    size: String(Math.max(1, Math.min(250, Number(size) || 20))),
    from: String(Math.max(0, Number(from) || 0)),
  });
  const { status, body } = await registryFetch(
    auth,
    `/-/v1/search?${qs}`,
    { method: "GET" }, timeoutMs, signal,
  );
  const results = (body?.objects || []).map(o => ({
    name:        o.package?.name,
    version:     o.package?.version,
    description: o.package?.description,
    keywords:    o.package?.keywords || [],
    date:        o.package?.date,
    score:       o.score?.final ?? null,
    publisher:   o.package?.publisher?.username || null,
    links:       o.package?.links || {},
  }));
  return {
    status,
    result: {
      results,
      total: Number(body?.total ?? results.length),
      from,
      size,
    },
    url: null,
  };
}

// ── package.downloads ──────────────────────────────────────────────────
// The downloads API lives on a different host (api.npmjs.org) and only
// exists for the public registry. We bypass the configured registry
// here and always go to the public host — there's no equivalent on
// private mirrors.
export async function packageDownloads(auth, input, signal) {
  const { package: pkg, period = "last-week", timeoutMs = 15000 } = input || {};
  if (!pkg) throw new Error("operation=package.downloads requires `package`");

  // The downloads endpoint accepts the scope's `/` un-encoded but the
  // `@` must NOT be encoded. encodeURIComponent over-escapes — use a
  // direct concat.
  const path = `/downloads/point/${encodeURIComponent(period)}/${pkg}`;
  const url  = `${DOWNLOADS_HOST}${path}`;

  // Downloads endpoint is unauthenticated and always public; pass an
  // auth-stripped auth blob so we don't accidentally send a Bearer
  // token from a private-registry config to api.npmjs.org.
  const { status, body } = await registryFetch(
    { registry: "", token: null },
    url, { method: "GET" }, timeoutMs, signal,
  );
  return {
    status,
    result: body,                    // { downloads, start, end, package }
    url:    npmjsUrl(pkg),
  };
}

export const OPERATIONS = {
  "package.info":      packageInfo,
  "package.search":    packageSearch,
  "package.downloads": packageDownloads,
};
