import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveHost } from "./hosts.ts";

describe("resolveHost default", () => {
  it("falls back to loopback on an unknown machine when HOST is unset", () => {
    // Given / When
    const target = resolveHost({}, "anybox");
    // Then: universal default — works on any machine running an app-server
    assert.equal(target.url, "ws://127.0.0.1:18789");
    assert.deepEqual(target.tokenSource, {
      kind: "command",
      command: `cat "$HOME/.codex-gui-cli-remote/secrets/ws-capability-token"`,
    });
  });

  it("uses the registered URL when the current machine is a known alias", () => {
    // Given: mengmotaMac's app-server binds its tailscale IP, not loopback
    // When
    const target = resolveHost({}, "mengmotaMac");
    // Then
    assert.equal(target.url, "ws://100.90.145.97:18789");
    assert.deepEqual(target.tokenSource, {
      kind: "command",
      command: `cat "$HOME/.codex-gui-cli-remote/secrets/ws-capability-token"`,
    });
  });
});

describe("resolveHost known aliases", () => {
  it("maps mengmotaHost to its tailscale IP with ssh token fetch from another machine", () => {
    // Given / When
    const target = resolveHost({ host: "mengmotaHost" }, "mengmotaMac");
    // Then
    assert.equal(target.url, "ws://100.68.81.17:18789");
    assert.deepEqual(target.tokenSource, {
      kind: "command",
      command: "ssh mengmotaHost 'cat ~/.codex-gui-cli-remote/secrets/ws-capability-token'",
    });
  });

  it("reads the token locally when the alias names the current machine", () => {
    // Given / When
    const source = resolveHost({ host: "mengmotaHost" }, "mengmotaHost").tokenSource;
    // Then
    assert.ok(source.kind === "command");
    assert.ok(source.command.startsWith("cat "));
  });
});

describe("resolveHost universal forms", () => {
  it("passes a ws:// URL through unchanged", () => {
    // Given / When
    const target = resolveHost({ host: "ws://10.0.0.5:9999" }, "anybox");
    // Then
    assert.equal(target.url, "ws://10.0.0.5:9999");
  });

  it("treats an unknown name as an ssh-reachable host on the default port", () => {
    // Given / When
    const target = resolveHost({ host: "otherbox" }, "anybox");
    // Then
    assert.equal(target.url, "ws://otherbox:18789");
    assert.deepEqual(target.tokenSource, {
      kind: "command",
      command: "ssh otherbox 'cat ~/.codex-gui-cli-remote/secrets/ws-capability-token'",
    });
  });

  it("honors an explicit port in name:port form while ssh-ing to the bare name", () => {
    // Given / When
    const target = resolveHost({ host: "otherbox:2222" }, "anybox");
    // Then
    assert.equal(target.url, "ws://otherbox:2222");
    const source = target.tokenSource;
    assert.ok(source.kind === "command");
    assert.ok(source.command.includes("ssh otherbox "));
  });

  it("uses a literal token from CODEX_WS_TOKEN over any file or ssh lookup", () => {
    // Given / When
    const target = resolveHost({ host: "ws://10.0.0.5:9999", token: "sekrit" }, "anybox");
    // Then
    assert.deepEqual(target.tokenSource, { kind: "literal", token: "sekrit" });
  });
});
