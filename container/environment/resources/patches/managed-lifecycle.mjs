import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

export const MANAGED_LIFECYCLE_MODULE = 'lib/dsh-docker-managed-lifecycle.js'
const BIN_TARGET = 'lib/bin.js'
const BIN_IMPORT = 'import { prepareManagedInvocation } from "./dsh-docker-managed-lifecycle.js";'
const PROFILE_IMPORT = 'import { managedSigtermHandler, provideManagedLifecycle } from "./dsh-docker-managed-lifecycle.js";'
const BIN_DISPATCH = 'const invocation = parseDshArgs(process.argv.slice(2), readVersion());'
const BIN_DISPATCH_PATCHED = `${BIN_DISPATCH}\nconst managedExitCode = await prepareManagedInvocation(invocation);\nif (managedExitCode !== null) process.exit(managedExitCode);`
const SIGTERM = 'process.on("SIGTERM", () => {\n\t\tinterrupt(0);\n\t});'
const SIGTERM_PATCHED = 'process.on("SIGTERM", managedSigtermHandler(interrupt));'
const HOST_PROVIDER = 'hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, options.environment);'
const HOST_PROVIDER_PATCHED = `${HOST_PROVIDER}\n\t\tprovideManagedLifecycle(hostCtx);`

const ADAPTER_SOURCE = String.raw`import { request } from "node:http";

const API_PREFIX = "/_dsh_platform/api/v1/";
const REQUEST_TIMEOUT_MS = 3e3;
const RESTART_FALLBACK_MS = 10e3;
let managedSessionId = null;

function socketPath(name) {
	return process.env.DSH_PLATFORM_RUN + "/" + name;
}

function requestJson(socket, method, path, body) {
	return new Promise((resolveRequest, reject) => {
		const bytes = body === void 0 ? void 0 : Buffer.from(JSON.stringify(body));
		const req = request({
			socketPath: socket,
			method,
			path,
			headers: bytes === void 0 ? {} : {
				"content-type": "application/json",
				"content-length": bytes.byteLength
			}
		}, (response) => {
			const chunks = [];
			response.on("data", (chunk) => chunks.push(chunk));
			response.on("end", () => {
				let value = {};
				try {
					value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
				} catch {}
				if ((response.statusCode ?? 500) >= 400) {
					const error = new Error(value.error ?? "local API request failed");
					error.statusCode = response.statusCode;
					reject(error);
				} else resolveRequest(value);
			});
		});
		req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error("local API request timed out")));
		req.once("error", reject);
		req.end(bytes);
	});
}

function managedWeb(invocation) {
	return process.env.DSH_PLATFORM_MANAGED === "1"
		&& invocation?.mode === "profile"
		&& invocation.profile === "web";
}

async function management(method, path) {
	return requestJson(socketPath("management.sock"), method, API_PREFIX + path);
}

export async function prepareManagedInvocation(invocation) {
	if (!managedWeb(invocation)) return null;
	if (typeof process.env.DSH_PLATFORM_RUN !== "string" || process.env.DSH_PLATFORM_RUN === "") {
		console.error("dsh: managed lifecycle runtime directory is unavailable");
		return 1;
	}
	try {
		const claimed = await requestJson(socketPath("dsh-lifecycle.sock"), "POST", "/v1/runtime/claim", {
			launchToken: process.env.DSH_PLATFORM_LAUNCH_TOKEN ?? ""
		});
		if (typeof claimed.sessionId !== "string" || claimed.sessionId === "") throw new Error("invalid lifecycle claim response");
		managedSessionId = claimed.sessionId;
		delete process.env.DSH_PLATFORM_LAUNCH_TOKEN;
		return null;
	} catch (error) {
		if (error?.statusCode !== 409) {
			console.error("dsh: managed lifecycle broker is unavailable; refusing an unsupervised Web instance");
			return 1;
		}
	}

	let status;
	try {
		status = await management("GET", "status");
	} catch {
		console.error("dsh: DSH is managed by the container platform, but its Control Plane is unavailable");
		console.error("dsh: open /_dsh_platform/console/ after the Control Plane recovers");
		return 1;
	}
	const state = status?.dshLifecycle?.state;
	if (state === "stopped") {
		try {
			const task = await management("POST", "start-dsh");
			console.log("dsh: requested managed DSH start (task " + String(task.taskId) + ")");
			return 0;
		} catch (error) {
			console.error("dsh: managed DSH start was rejected: " + String(error?.message ?? error));
			return 1;
		}
	}
	if (state === "failed" || status?.recoveryMode != null) {
		console.error("dsh: managed DSH is in recovery mode; open /_dsh_platform/console/");
		return 1;
	}
	if (["running", "starting", "stopping", "restarting", "recovering"].includes(state)) {
		console.log("dsh: managed DSH is " + state + "; no second Web instance was started");
		return 0;
	}
	console.error("dsh: managed DSH state is unavailable; open /_dsh_platform/console/");
	return 1;
}

export function managedSigtermHandler(interrupt) {
	if (managedSessionId === null) return () => interrupt(0);
	let count = 0;
	let fallback;
	return () => {
		count += 1;
		if (count > 1) {
			if (fallback !== void 0) clearTimeout(fallback);
			interrupt(0);
			return;
		}
		void requestJson(socketPath("dsh-lifecycle.sock"), "POST", "/v1/runtime/signal", {
			sessionId: managedSessionId,
			signal: "SIGTERM"
		}).then(async ({ disposition }) => {
			if (disposition === "terminate") {
				interrupt(0);
				return;
			}
			if (disposition !== "request-restart") throw new Error("invalid lifecycle signal response");
			const task = await management("POST", "restart-dsh");
			console.log("dsh: requested managed DSH restart (task " + String(task.taskId) + ")");
			fallback = setTimeout(() => interrupt(0), RESTART_FALLBACK_MS);
			fallback.unref?.();
		}).catch(() => interrupt(0));
	};
}

export function provideManagedLifecycle(hostCtx) {
	if (managedSessionId === null) return;
	hostCtx.provide("dshPlatformLifecycle", Object.freeze({
		restart: () => management("POST", "restart-dsh")
	}));
}
`

function exactlyOnce(source, pattern, name, path) {
  const matches = [...source.matchAll(pattern)]
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${name} in ${path}, found ${String(matches.length)}. The upstream package may have changed; review this patch before building.`)
  }
  return matches[0]
}

function replaceOnce(source, before, after, name, path) {
  const count = source.split(before).length - 1
  if (count !== 1) {
    throw new Error(`Expected exactly one ${name} in ${path}, found ${String(count)}. The upstream package may have changed; review this patch before building.`)
  }
  return source.replace(before, after)
}

function profileImplementation(dshRoot, binSource) {
  const binMatch = exactlyOnce(
    binSource,
    /const \{ runProfile \} = await import\("(\.\/profile-boot-[A-Za-z0-9_-]+\.js)"\);/g,
    'dynamic Web Profile import',
    join(dshRoot, BIN_TARGET),
  )
  const wrapperPath = join(dshRoot, 'lib', basename(binMatch[1]))
  const wrapper = readFileSync(wrapperPath, 'utf8')
  if (wrapper.includes(SIGTERM) && wrapper.includes(HOST_PROVIDER)) return wrapperPath
  const implementation = exactlyOnce(
    wrapper,
    /import \{[^\n;]*\brunProfile\b[^\n;]*\} from "(\.\/profile-boot-[A-Za-z0-9_-]+\.js)";/g,
    'Profile implementation import',
    wrapperPath,
  )
  return join(dshRoot, 'lib', basename(implementation[1]))
}

export function applyPatch(dshRoot) {
  const root = resolve(dshRoot)
  const binPath = join(root, BIN_TARGET)
  const bin = readFileSync(binPath, 'utf8')
  const profilePath = profileImplementation(root, bin)
  let profile = readFileSync(profilePath, 'utf8')
  if (readFileSync(binPath, 'utf8').includes(BIN_IMPORT)) throw new Error('Managed lifecycle Patch is already applied')
  if (existsSync(join(root, MANAGED_LIFECYCLE_MODULE))) throw new Error('Managed lifecycle adapter path already exists')
  exactlyOnce(bin, /^#!\/usr\/bin\/env node$/gm, 'DSH bin shebang', binPath)
  let patchedBin = bin.replace(/^#!\/usr\/bin\/env node$/m, `#!/usr/bin/env node\n${BIN_IMPORT}`)
  patchedBin = replaceOnce(patchedBin, BIN_DISPATCH, BIN_DISPATCH_PATCHED, 'DSH invocation dispatch', binPath)
  profile = `${PROFILE_IMPORT}\n${profile}`
  profile = replaceOnce(profile, SIGTERM, SIGTERM_PATCHED, 'Web Profile SIGTERM handler', profilePath)
  profile = replaceOnce(profile, HOST_PROVIDER, HOST_PROVIDER_PATCHED, 'Web Profile host provider', profilePath)
  writeFileSync(join(root, MANAGED_LIFECYCLE_MODULE), ADAPTER_SOURCE)
  writeFileSync(profilePath, profile)
  writeFileSync(binPath, patchedBin)
}

export function verifyPatch(dshRoot) {
  const root = resolve(dshRoot)
  const binPath = join(root, BIN_TARGET)
  const bin = readFileSync(binPath, 'utf8')
  const profilePath = profileImplementation(root, bin)
  const profile = readFileSync(profilePath, 'utf8')
  const adapter = readFileSync(join(root, MANAGED_LIFECYCLE_MODULE), 'utf8')
  if (bin.split(BIN_IMPORT).length - 1 !== 1 || bin.split(BIN_DISPATCH_PATCHED).length - 1 !== 1) {
    throw new Error(`Managed lifecycle bin Patch verification failed for ${binPath}`)
  }
  if (profile.split(PROFILE_IMPORT).length - 1 !== 1
    || profile.split(SIGTERM_PATCHED).length - 1 !== 1
    || profile.split(HOST_PROVIDER_PATCHED).length - 1 !== 1
    || profile.includes(SIGTERM)) {
    throw new Error(`Managed lifecycle Profile Patch verification failed for ${profilePath}`)
  }
  for (const marker of ['prepareManagedInvocation', 'managedSigtermHandler', 'provideManagedLifecycle']) {
    if (!adapter.includes(`export function ${marker}`) && !adapter.includes(`export async function ${marker}`)) {
      throw new Error(`Managed lifecycle adapter is missing ${marker}`)
    }
  }
}
