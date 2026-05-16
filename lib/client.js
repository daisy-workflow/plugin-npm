// Shared npm registry client.
//
// Two endpoints in play:
//   • Registry — https://registry.npmjs.org (or any compatible mirror).
//     Hosts package metadata, search, and tarballs.
//   • Downloads API — https://api.npmjs.org/downloads. Hosted by npm
//     Inc. separately from the registry; private mirrors don't have
//     equivalents, so we use the public host even when a custom
//     registryUrl is configured.
//
// No auth needed for the public registry. For private registries a
// bearer token is supported via the `token` input or a workspace config.

export const PUBLIC_REGISTRY  = "https://registry.npmjs.org";
export const DOWNLOADS_HOST   = "https://api.npmjs.org";

// Resolve effective registry + token. Order:
//   1. Node-level inputs (registryUrl, token)
//   2. Workspace config named via `config` (registryUrl, token)
//   3. Default: public registry, no token
export function resolveRegistry(ctx, input) {
  const cfg = input?.config && ctx?.config?.[input.config]
    ? ctx.config[input.config]
    : null;
  const registryUrl =
    (input?.registryUrl && String(input.registryUrl)) ||
    (cfg?.registryUrl  && String(cfg.registryUrl))    ||
    PUBLIC_REGISTRY;
  const token =
    (input?.token && String(input.token)) ||
    (cfg?.token   && String(cfg.token))   ||
    null;
  return {
    registry: registryUrl.replace(/\/+$/, ""),
    token,
  };
}

// fetch wrapper. Merges a per-call timeout with the engine's abort
// signal so a workflow cancel tears the request down cleanly. Returns
// { status, body, url } on 2xx; throws with status + body on non-2xx.
export async function registryFetch({ registry, token }, path, init = {}, timeoutMs = 15000, signal) {
  const ac = new AbortController();
  const t  = setTimeout(
    () => ac.abort(new Error(`npm request timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );
  const onUpstreamAbort = () => ac.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) ac.abort(signal.reason);
    else signal.addEventListener("abort", onUpstreamAbort, { once: true });
  }

  const headers = {
    "Accept":     "application/json",
    "User-Agent": "daisy-workflow-npm/0.1",
    ...(init.headers || {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  try {
    const url = path.startsWith("http") ? path : `${registry}${path}`;
    const res = await fetch(url, { ...init, headers, signal: ac.signal });
    const text = await res.text();
    let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!res.ok) {
      const msg = body?.error || body?.message || `HTTP ${res.status}`;
      const err = new Error(`npm ${init.method || "GET"} ${path} failed: ${msg}`);
      err.status = res.status;
      err.body   = body;
      throw err;
    }
    return { status: res.status, body, url };
  } finally {
    clearTimeout(t);
    if (signal) signal.removeEventListener?.("abort", onUpstreamAbort);
  }
}

// npm packages can be scoped (@scope/name). The registry expects the
// scope's `@` and `/` to be percent-encoded.
export function encodePackage(name) {
  // encodeURIComponent does the right thing on both bare and scoped names.
  // (e.g. "@daisy-workflow/plugin-sdk" → "%40daisy-workflow%2Fplugin-sdk")
  return encodeURIComponent(name);
}

// Build the canonical npmjs.com page for a package. Useful as a UI
// deep-link, even when the actual call hits a private registry.
export function npmjsUrl(name) {
  return `https://www.npmjs.com/package/${name}`;
}
