const TOKEN_PATH = ".codex-gui-cli-remote/secrets/ws-capability-token";
const DEFAULT_PORT = 18789;

// Known aliases whose ws URL differs from plain DNS resolution of the name.
const HOST_ALIASES: Readonly<Record<string, string>> = {
  mengmotaHost: "ws://100.68.81.17:18789",
  mengmotaMac: "ws://100.90.145.97:18789",
};

export type TokenSource =
  | { readonly kind: "literal"; readonly token: string }
  | { readonly kind: "command"; readonly command: string };

export type HostTarget = {
  readonly name: string;
  readonly url: string;
  readonly tokenSource: TokenSource;
};

const LOCAL_TOKEN_COMMAND = `cat "$HOME/${TOKEN_PATH}"`;

function sshTokenCommand(host: string): string {
  return `ssh ${host} 'cat ~/${TOKEN_PATH}'`;
}

// Universal HOST resolution:
//   unset          -> this machine's app-server (own alias URL, else loopback)
//   known alias    -> its registered URL
//   ws://... URL   -> passed through (token: env override or local file)
//   name[:port]    -> ws://name:port (DNS/tailscale MagicDNS), token via ssh name
// env.token (CODEX_WS_TOKEN) always wins over file/ssh lookup.
export function resolveHost(
  env: { readonly host?: string; readonly token?: string },
  localHostname: string,
): HostTarget {
  const host = env.host === "" ? undefined : env.host;
  const literal: TokenSource | undefined =
    env.token !== undefined && env.token !== "" ? { kind: "literal", token: env.token } : undefined;

  if (host === undefined) {
    // App-servers may bind a specific interface (e.g. the tailscale IP), so a
    // known alias matching this machine beats plain loopback.
    const ownAlias = Object.keys(HOST_ALIASES).find((alias) => localHostname.includes(alias));
    const aliasUrl = ownAlias !== undefined ? HOST_ALIASES[ownAlias] : undefined;
    return {
      name: ownAlias ?? "local",
      url: aliasUrl ?? `ws://127.0.0.1:${DEFAULT_PORT}`,
      tokenSource: literal ?? { kind: "command", command: LOCAL_TOKEN_COMMAND },
    };
  }

  if (host.startsWith("ws://") || host.startsWith("wss://")) {
    return {
      name: host,
      url: host,
      tokenSource: literal ?? { kind: "command", command: LOCAL_TOKEN_COMMAND },
    };
  }

  const [name = host, port] = host.split(":", 2);
  const aliasUrl = HOST_ALIASES[name];
  const url = aliasUrl ?? `ws://${name}:${port ?? DEFAULT_PORT}`;
  const isLocal = localHostname.includes(name);
  return {
    name,
    url,
    tokenSource: literal ?? {
      kind: "command",
      command: isLocal ? LOCAL_TOKEN_COMMAND : sshTokenCommand(name),
    },
  };
}
