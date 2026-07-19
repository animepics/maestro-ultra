import WebSocket from "ws";
import { type JsonRpcMessage, JsonRpcMessageSchema } from "./protocol.ts";

export class CodexRpcError extends Error {
  override readonly name: string = "CodexRpcError";
  readonly method: string;
  readonly detail: string;
  constructor(method: string, detail: string) {
    super(`${method} failed: ${detail}`);
    this.method = method;
    this.detail = detail;
  }
}

export class CodexTimeoutError extends Error {
  override readonly name: string = "CodexTimeoutError";
  readonly what: string;
  constructor(what: string) {
    super(`timed out waiting for ${what}`);
    this.what = what;
  }
}

type MessageListener = (message: JsonRpcMessage) => void;

const CONNECT_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 60_000;

function frameText(data: WebSocket.Data): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

// Thin JSON-RPC-over-WebSocket client for the Codex app-server. Uses the `ws`
// package so the same code runs on Node and Bun (Node's built-in WebSocket
// cannot send the Authorization header). Requests resolve with the `result`
// payload; notifications and server-initiated requests fan out to listeners.
export class CodexClient {
  private nextId = 0;
  private readonly pending = new Map<number, (message: JsonRpcMessage) => void>();
  private readonly listeners = new Set<MessageListener>();

  private readonly ws: WebSocket;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (event) => {
      const parsed = JsonRpcMessageSchema.safeParse(JSON.parse(frameText(event.data)));
      if (!parsed.success) return;
      const message = parsed.data;
      if (typeof message.id === "number" && message.method === undefined) {
        const resolve = this.pending.get(message.id);
        if (resolve !== undefined) {
          this.pending.delete(message.id);
          resolve(message);
          return;
        }
      }
      for (const listener of this.listeners) listener(message);
    };
  }

  static async connect(url: string, token: string, clientName: string): Promise<CodexClient> {
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new CodexTimeoutError(`connection to ${url}`)),
        CONNECT_TIMEOUT_MS,
      );
      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = (event) => {
        clearTimeout(timer);
        reject(new CodexRpcError("connect", `${event.message} (${url})`));
      };
    });
    const client = new CodexClient(ws);
    await client.request("initialize", {
      clientInfo: { name: clientName, title: clientName, version: "0.2.0" },
      capabilities: { experimentalApi: true },
    });
    ws.send(JSON.stringify({ method: "initialized", params: {} }));
    return client;
  }

  request(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs: number = REQUEST_TIMEOUT_MS,
  ): Promise<unknown> {
    this.nextId += 1;
    const id = this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodexTimeoutError(`${method} response`));
      }, timeoutMs);
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        if (message.error !== undefined) {
          reject(new CodexRpcError(method, message.error.message));
          return;
        }
        resolve(message.result);
      });
      this.ws.send(JSON.stringify({ method, id, params }));
    });
  }

  // Reply to a server-initiated request (approval, user-input prompt).
  respond(id: number | string, result: Record<string, unknown>): void {
    this.ws.send(JSON.stringify({ id, result }));
  }

  onMessage(listener: MessageListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.ws.close();
  }
}
