import type { Plugin } from "@opencode-ai/plugin";

type NotificationKind = "idle" | "permission";
type InboundDispatchMode = "prompt" | "promptAsync";

interface NormalizedInboundWebhookConfig {
  enabled: boolean;
  host: string;
  port: number;
  path: string;
  token?: string;
  mode: InboundDispatchMode;
}

interface WebhookEventConfig {
  headers?: Record<string, string>;
  body?: JsonValue;
}

interface WebhookNotifyConfig {
  enabled?: boolean;
  webhookUrl?: string;
  timeoutMs?: number;
  inbound?: NormalizedInboundWebhookConfig;
  events?: {
    idle?: WebhookEventConfig;
    permission?: WebhookEventConfig;
  };
}

interface InboundWebhookPayload {
  sessionID?: unknown;
  sessionId?: unknown;
  id?: unknown;
  text?: unknown;
  message?: unknown;
  prompt?: unknown;
  noReply?: unknown;
  agent?: unknown;
  model?: unknown;
}

interface InboundModelSelection {
  providerID: string;
  modelID: string;
}

interface InboundSessionMessage {
  sessionId: string;
  text: string;
  noReply?: boolean;
  agent?: string;
  model?: InboundModelSelection;
}

interface SessionModelLimit {
  context?: number;
}

interface SessionModel {
  name?: string;
  limit?: SessionModelLimit;
}

interface SessionData {
  model?: SessionModel;
}

interface MessageTokens {
  input?: number;
  output?: number;
  cache?: {
    read?: number;
  };
}

interface MessagePartText {
  type: "text";
  text?: string;
}

interface MessagePartTool {
  type: "tool";
  state?: {
    status?: string;
    input?: unknown;
  };
}

type MessagePart = MessagePartText | MessagePartTool | { type?: string };

interface SessionMessage {
  role?: string;
  modelID?: string;
  tokens?: MessageTokens;
  parts?: MessagePart[];
  info?: {
    role?: string;
    modelID?: string;
    tokens?: MessageTokens;
  };
}

interface EventLike {
  type?: string;
  properties?: Record<string, unknown>;
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonObject
  | JsonValue[];

interface JsonObject {
  [key: string]: JsonValue;
}

interface NotificationContext {
  eventType: string;
  notificationType: NotificationKind;
  title: string;
  description: string;
  color: number;
  sessionId: string;
  contextUsage: string;
  contextUsagePercent: number | null;
  totalTokens: number;
  modelName: string;
  pendingCommand: string;
  timestamp: string;
  assistantText: string;
}

const DEFAULT_CONFIG_PATH = `${Bun.env.HOME ?? ""}/.config/opencode/opencode-webhook-notify.json`;
const DEFAULT_INBOUND_HOST = "127.0.0.1";
const DEFAULT_INBOUND_PORT = 8787;
const DEFAULT_INBOUND_PATH = "/webhook/session-message";
const MAX_INBOUND_BODY_BYTES = 1024 * 1024;

let inboundServerState:
  | {
      key: string;
      server: {
        stop: (closeActiveConnections?: boolean) => void;
      };
    }
  | undefined;

export const WebhookNotificationPlugin: Plugin = async ({ client, project }) => {
  console.log("WebHook Notification Plugin initialized!");

  await initializeInboundWebhookServer(client, project);

  return {
    event: async ({ event }) => {
      if (!isRecord(event) || typeof event.type !== "string") {
        return;
      }

      const eventType = String(event.type);

      if (eventType === "session.idle") {
        await handleNotification(client, project, event, "idle");
      } else if (eventType === "permission.asked") {
        await handleNotification(client, project, event, "permission");
      }
    },
  };
};

async function handleNotification(
  client: unknown,
  project: unknown,
  event: EventLike,
  type: NotificationKind,
): Promise<void> {
  try {
    const config = await loadConfig(project);

    if (!config.enabled || !config.webhookUrl) {
      return;
    }

    const sessionId = getSessionId(event.properties);
    if (!sessionId) {
      return;
    }

    if (type === "idle") {
      await wait(1500);
    }

    const sessionClient = getSessionClient(client);
    if (!sessionClient) {
      return;
    }

    const [sessionRes, messagesRes] = await Promise.all([
      sessionClient.get({ path: { id: sessionId } }),
      sessionClient.messages({ path: { id: sessionId } }),
    ]);

    const session = unwrapData<SessionData>(sessionRes);
    const messages = unwrapData<SessionMessage[]>(messagesRes) ?? [];
    const details = analyzeMessages(messages, session, type);

    const title = type === "permission" ? "Permission Required" : "Response Completed";
    const description =
      type === "permission"
        ? "OpenCode is waiting for your authorization before it can continue."
        : details.lastText;
    const color = type === "permission" ? 0xffa500 : 0x00ff00;
    const timestamp = new Date().toISOString();

    const context: NotificationContext = {
      eventType: event.type ?? "unknown",
      notificationType: type,
      title,
      description,
      color,
      sessionId,
      contextUsage: details.contextUsage,
      contextUsagePercent: details.contextUsagePercent,
      totalTokens: details.totalTokens,
      modelName: details.modelName,
      pendingCommand: details.pendingCommand,
      timestamp,
      assistantText: details.lastText,
    };

    const eventConfig = config.events?.[type];
    const payload = eventConfig?.body
      ? renderTemplate(eventConfig.body, context)
      : createDefaultBody(context);
    const headers = renderHeaders(eventConfig?.headers, context);

    await postWebhook(config, payload, headers);
  } catch (error) {
    console.error("Webhook Notification Plugin Error:", error);
  }
}

async function initializeInboundWebhookServer(client: unknown, project: unknown): Promise<void> {
  if (typeof Bun === "undefined" || typeof Bun.serve !== "function") {
    return;
  }

  const config = await loadConfig(project);
  const inbound = config.inbound;

  if (!inbound?.enabled) {
    return;
  }

  const sessionClient = getSessionClient(client);
  if (!sessionClient) {
    console.warn("Webhook Notification Plugin: unable to resolve session client for inbound webhook server.");
    return;
  }

  if (typeof sessionClient.prompt !== "function" && typeof sessionClient.promptAsync !== "function") {
    console.warn("Webhook Notification Plugin: inbound webhook server requires session.prompt or session.promptAsync.");
    return;
  }

  const serverKey = `${inbound.host}:${inbound.port}${inbound.path}`;
  if (inboundServerState?.key === serverKey) {
    return;
  }

  if (inboundServerState) {
    inboundServerState.server.stop(true);
    inboundServerState = undefined;
  }

  const server = Bun.serve({
    hostname: inbound.host,
    port: inbound.port,
    fetch: async (request) => {
      return handleInboundWebhookRequest(request, inbound, sessionClient);
    },
  });

  inboundServerState = {
    key: serverKey,
    server,
  };

  console.log(
    `Webhook Notification Plugin inbound endpoint listening on http://${inbound.host}:${inbound.port}${inbound.path}`,
  );
}

function getSessionClient(client: unknown):
  | {
      get: (args: { path: { id: string } }) => Promise<unknown>;
      messages: (args: { path: { id: string } }) => Promise<unknown>;
      prompt?: (args: {
        path: { id: string };
        body: {
          parts: Array<{ type: "text"; text: string }>;
          noReply?: boolean;
          agent?: string;
          model?: { providerID: string; modelID: string };
        };
      }) => Promise<unknown>;
      promptAsync?: (args: {
        path: { id: string };
        body: {
          parts: Array<{ type: "text"; text: string }>;
          noReply?: boolean;
          agent?: string;
          model?: { providerID: string; modelID: string };
        };
      }) => Promise<unknown>;
    }
  | undefined {
  if (!isRecord(client)) {
    return undefined;
  }

  const maybeSession = client.session;
  if (!isRecord(maybeSession)) {
    return undefined;
  }

  const get = maybeSession.get;
  const messages = maybeSession.messages;
  const prompt = maybeSession.prompt;
  const promptAsync = maybeSession.promptAsync;

  if (typeof get !== "function" || typeof messages !== "function") {
    return undefined;
  }

  return {
    get: (args) => get.call(maybeSession, args) as Promise<unknown>,
    messages: (args) => messages.call(maybeSession, args) as Promise<unknown>,
    prompt:
      typeof prompt === "function"
        ? (args) => prompt.call(maybeSession, args) as Promise<unknown>
        : undefined,
    promptAsync:
      typeof promptAsync === "function"
        ? (args) => promptAsync.call(maybeSession, args) as Promise<unknown>
        : undefined,
  };
}

async function loadConfig(project: unknown): Promise<WebhookNotifyConfig> {
  void project;
  return readFileConfig(DEFAULT_CONFIG_PATH);
}

function normalizeConfig(input: Record<string, unknown>): WebhookNotifyConfig {
  const events = isRecord(input.events)
    ? {
        idle: normalizeEventConfig(input.events.idle),
        permission: normalizeEventConfig(input.events.permission),
      }
    : undefined;

  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : true,
    webhookUrl: typeof input.webhookUrl === "string" ? input.webhookUrl : undefined,
    timeoutMs: typeof input.timeoutMs === "number" ? input.timeoutMs : undefined,
    inbound: normalizeInboundConfig(input.inbound),
    events,
  };
}

function normalizeInboundConfig(input: unknown): NormalizedInboundWebhookConfig | undefined {
  if (!isRecord(input)) {
    return undefined;
  }

  const enabled = input.enabled === true;
  const host = typeof input.host === "string" && input.host.trim().length > 0
    ? input.host.trim()
    : DEFAULT_INBOUND_HOST;
  const port =
    typeof input.port === "number" && Number.isInteger(input.port) && input.port >= 1 && input.port <= 65535
      ? input.port
      : DEFAULT_INBOUND_PORT;
  const path = normalizeInboundPath(input.path);
  const token = typeof input.token === "string" && input.token.length > 0 ? input.token : undefined;
  const mode: InboundDispatchMode = input.mode === "prompt" ? "prompt" : "promptAsync";

  return {
    enabled,
    host,
    port,
    path,
    token,
    mode,
  };
}

function normalizeInboundPath(pathLike: unknown): string {
  if (typeof pathLike !== "string" || pathLike.trim().length === 0) {
    return DEFAULT_INBOUND_PATH;
  }

  const trimmed = pathLike.trim();
  if (trimmed === "/") {
    return trimmed;
  }

  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

async function handleInboundWebhookRequest(
  request: Request,
  inboundConfig: NormalizedInboundWebhookConfig,
  sessionClient: {
    prompt?: (args: {
      path: { id: string };
      body: {
        parts: Array<{ type: "text"; text: string }>;
        noReply?: boolean;
        agent?: string;
        model?: { providerID: string; modelID: string };
      };
    }) => Promise<unknown>;
    promptAsync?: (args: {
      path: { id: string };
      body: {
        parts: Array<{ type: "text"; text: string }>;
        noReply?: boolean;
        agent?: string;
        model?: { providerID: string; modelID: string };
      };
    }) => Promise<unknown>;
  },
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname !== inboundConfig.path) {
    return new Response("Not Found", { status: 404 });
  }

  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method Not Allowed" }, 405);
  }

  if (!isJsonContentType(request)) {
    return jsonResponse({ ok: false, error: "Unsupported Media Type" }, 415);
  }

  if (!isInboundBodySizeAllowed(request)) {
    return jsonResponse({ ok: false, error: "Payload Too Large" }, 413);
  }

  if (!isInboundRequestAuthorized(request, inboundConfig.token)) {
    return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  }

  const payload = await parseInboundPayload(request);
  if (!payload) {
    return jsonResponse({ ok: false, error: "Invalid JSON payload" }, 400);
  }

  const parsed = parseInboundSessionMessage(payload);
  if (!parsed.ok) {
    return jsonResponse({ ok: false, error: parsed.error }, 400);
  }

  try {
    await dispatchInboundMessage(sessionClient, parsed.data, inboundConfig.mode);
    return jsonResponse({ ok: true, sessionId: parsed.data.sessionId }, 200);
  } catch (error) {
    console.error("Webhook Notification Plugin inbound dispatch error:", error);
    return jsonResponse({ ok: false, error: "Failed to dispatch session message" }, 500);
  }
}

function isInboundRequestAuthorized(request: Request, token: string | undefined): boolean {
  if (!token) {
    return true;
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return secureTokenEquals(authHeader.slice("Bearer ".length).trim(), token);
  }

  const tokenHeader = request.headers.get("x-webhook-token");
  return tokenHeader ? secureTokenEquals(tokenHeader, token) : false;
}

function secureTokenEquals(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const maxLength = Math.max(leftBytes.length, rightBytes.length);

  let diff = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < maxLength; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return diff === 0;
}

function isJsonContentType(request: Request): boolean {
  const contentType = request.headers.get("content-type");
  if (!contentType) {
    return false;
  }

  const [mimeType = ""] = contentType.split(";");
  return mimeType.trim().toLowerCase() === "application/json";
}

function isInboundBodySizeAllowed(request: Request): boolean {
  const contentLength = request.headers.get("content-length");
  if (!contentLength) {
    return true;
  }

  const bytes = Number(contentLength);
  if (!Number.isFinite(bytes) || bytes < 0) {
    return false;
  }

  return bytes <= MAX_INBOUND_BODY_BYTES;
}

async function parseInboundPayload(request: Request): Promise<InboundWebhookPayload | undefined> {
  try {
    const parsed = await request.json();
    return isRecord(parsed) ? (parsed as InboundWebhookPayload) : undefined;
  } catch {
    return undefined;
  }
}

function parseInboundSessionMessage(
  payload: InboundWebhookPayload,
): { ok: true; data: InboundSessionMessage } | { ok: false; error: string } {
  const sessionId = firstNonEmptyString(payload.sessionId, payload.sessionID, payload.id);
  if (!sessionId) {
    return { ok: false, error: "Missing sessionId" };
  }

  const text = firstNonEmptyString(payload.text, payload.message, payload.prompt);
  if (!text) {
    return { ok: false, error: "Missing text (or message/prompt)" };
  }

  const model = parseInboundModelSelection(payload.model);

  return {
    ok: true,
    data: {
      sessionId,
      text,
      noReply: typeof payload.noReply === "boolean" ? payload.noReply : undefined,
      agent: typeof payload.agent === "string" && payload.agent.length > 0 ? payload.agent : undefined,
      model,
    },
  };
}

function parseInboundModelSelection(input: unknown): InboundModelSelection | undefined {
  if (!isRecord(input)) {
    return undefined;
  }

  const providerID = typeof input.providerID === "string" ? input.providerID : undefined;
  const modelID = typeof input.modelID === "string" ? input.modelID : undefined;

  if (!providerID || !modelID) {
    return undefined;
  }

  return { providerID, modelID };
}

async function dispatchInboundMessage(
  sessionClient: {
    prompt?: (args: {
      path: { id: string };
      body: {
        parts: Array<{ type: "text"; text: string }>;
        noReply?: boolean;
        agent?: string;
        model?: { providerID: string; modelID: string };
      };
    }) => Promise<unknown>;
    promptAsync?: (args: {
      path: { id: string };
      body: {
        parts: Array<{ type: "text"; text: string }>;
        noReply?: boolean;
        agent?: string;
        model?: { providerID: string; modelID: string };
      };
    }) => Promise<unknown>;
  },
  message: InboundSessionMessage,
  mode: InboundDispatchMode,
): Promise<void> {
  const body: {
    parts: Array<{ type: "text"; text: string }>;
    noReply?: boolean;
    agent?: string;
    model?: { providerID: string; modelID: string };
  } = {
    parts: [{ type: "text", text: message.text }],
  };

  if (typeof message.noReply === "boolean") {
    body.noReply = message.noReply;
  }
  if (message.agent) {
    body.agent = message.agent;
  }
  if (message.model) {
    body.model = message.model;
  }

  if (mode === "prompt" && typeof sessionClient.prompt === "function") {
    await sessionClient.prompt({ path: { id: message.sessionId }, body });
    return;
  }

  if (typeof sessionClient.promptAsync === "function") {
    await sessionClient.promptAsync({ path: { id: message.sessionId }, body });
    return;
  }

  if (typeof sessionClient.prompt === "function") {
    await sessionClient.prompt({ path: { id: message.sessionId }, body });
    return;
  }

  throw new Error("session prompt API is not available");
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

function jsonResponse(payload: JsonValue, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function normalizeEventConfig(input: unknown): WebhookEventConfig | undefined {
  if (!isRecord(input)) {
    return undefined;
  }

  const headers = isRecord(input.headers)
    ? Object.fromEntries(
        Object.entries(input.headers)
          .filter((entry): entry is [string, string] => typeof entry[1] === "string")
          .map(([key, value]) => [key, value]),
      )
    : undefined;

  const body = isJsonValue(input.body) ? input.body : undefined;

  if (!headers && body === undefined) {
    return undefined;
  }

  return { headers, body };
}

async function readFileConfig(configPath: string): Promise<WebhookNotifyConfig> {
  if (typeof Bun === "undefined") {
    return {};
  }

  try {
    const configFile = Bun.file(configPath);
    if (!(await configFile.exists())) {
      return {};
    }

    const parsed = await configFile.json();
    if (!isRecord(parsed)) {
      return {};
    }

    return normalizeConfig(parsed);
  } catch {
    return {};
  }
}

function getSessionId(properties: Record<string, unknown> | undefined): string | undefined {
  if (!properties) {
    return undefined;
  }

  const candidates = [properties.sessionID, properties.sessionId, properties.id];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  return undefined;
}

function analyzeMessages(messages: SessionMessage[], session: SessionData | undefined, type: NotificationKind) {
  let lastText = "Response completed.";
  let modelName = session?.model?.name ?? "Unknown";
  let totalTokens = 0;
  let pendingCommand = "";

  const assistantMessages = messages.filter((message) => getRole(message) === "assistant");

  for (const message of assistantMessages) {
    const tokens = message.info?.tokens ?? message.tokens;
    if (tokens) {
      const turnTotal =
        (tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.cache?.read ?? 0);
      totalTokens += turnTotal;
    }

    if (type === "permission") {
      const command = getPendingCommand(message.parts);
      if (command) {
        pendingCommand = command;
      }
    }
  }

  const lastAssistant = assistantMessages[assistantMessages.length - 1];
  if (lastAssistant) {
    const text = extractText(lastAssistant.parts);
    if (text) {
      lastText = text;
    }

    const modelId = lastAssistant.info?.modelID ?? lastAssistant.modelID;
    if (modelId) {
      modelName = modelId;
    }
  }

  const contextLimit = session?.model?.limit?.context;
  const contextUsagePercent =
    typeof contextLimit === "number" && contextLimit > 0
      ? Number(((totalTokens / contextLimit) * 100).toFixed(2))
      : null;

  return {
    lastText,
    modelName,
    totalTokens,
    pendingCommand,
    contextUsagePercent,
    contextUsage: contextUsagePercent === null ? "N/A" : `${contextUsagePercent.toFixed(2)}%`,
  };
}

function getRole(message: SessionMessage): string | undefined {
  return message.info?.role ?? message.role;
}

function getPendingCommand(parts: MessagePart[] | undefined): string | undefined {
  if (!parts) {
    return undefined;
  }

  for (const part of parts) {
    if (part.type !== "tool") {
      continue;
    }

    if (!("state" in part)) {
      continue;
    }

    const state = part.state;
    if (!state || (state.status !== "pending" && state.status !== "running")) {
      continue;
    }

    if (!isRecord(state.input)) {
      return "";
    }

    const command = state.input.command;
    if (typeof command === "string" && command.length > 0) {
      return command;
    }

    const filePath = state.input.filePath;
    if (typeof filePath === "string" && filePath.length > 0) {
      return filePath;
    }

    return JSON.stringify(state.input);
  }

  return undefined;
}

function extractText(parts: MessagePart[] | undefined): string {
  if (!parts) {
    return "";
  }

  return parts
    .filter((part): part is MessagePartText => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();
}

function createDefaultBody(context: NotificationContext): JsonObject {
  const text =
    context.notificationType === "permission"
      ? [
          `### ${context.title}`,
          "",
          context.description,
          "",
          `**Model**: ${context.modelName}`,
          `**Session**: ${context.sessionId}`,
          "",
          "### Permission Required",
          "",
          `Command: \`${context.pendingCommand || "Check terminal for details"}\``,
        ].join("\n")
      : [
          `### ${context.title}`,
          "",
          context.description,
          "",
          `**Model**: ${context.modelName}`,
          `**Session**: ${context.sessionId}`,
          "",
          "### Response Completed",
          "",
          context.assistantText,
        ].join("\n");

  return { text };
}

function renderHeaders(
  headers: Record<string, string> | undefined,
  context: NotificationContext,
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, replaceTokens(value, context)]),
  );
}

function renderTemplate(template: JsonValue, context: NotificationContext): JsonValue {
  if (typeof template === "string") {
    return replaceTokens(template, context);
  }

  if (Array.isArray(template)) {
    return template.map((item) => renderTemplate(item, context));
  }

  if (template && typeof template === "object") {
    const rendered: JsonObject = {};
    for (const [key, value] of Object.entries(template)) {
      rendered[key] = renderTemplate(value, context);
    }
    return rendered;
  }

  return template;
}

function replaceTokens(input: string, context: NotificationContext): string {
  return input.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, tokenName: string) => {
    const value = getContextValue(context, tokenName);
    if (value === undefined || value === null) {
      return "";
    }
    return String(value);
  });
}

function getContextValue(context: NotificationContext, tokenName: string): string | number | null | undefined {
  switch (tokenName) {
    case "event.type":
      return context.eventType;
    case "notification.type":
      return context.notificationType;
    case "title":
      return context.title;
    case "description":
      return context.description;
    case "assistant.text":
      return context.assistantText;
    case "session.id":
      return context.sessionId;
    case "context.usage":
      return context.contextUsage;
    case "context.usagePercent":
      return context.contextUsagePercent;
    case "tokens.total":
      return context.totalTokens;
    case "model.name":
      return context.modelName;
    case "color":
      return context.color;
    case "permission.command":
      return context.pendingCommand;
    case "timestamp":
      return context.timestamp;
    default:
      return undefined;
  }
}

async function postWebhook(
  config: WebhookNotifyConfig,
  payload: JsonValue,
  eventHeaders?: Record<string, string>,
): Promise<void> {
  if (!config.webhookUrl) {
    return;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(eventHeaders ?? {}),
  };

  const controller = new AbortController();
  const timeout = config.timeoutMs && config.timeoutMs > 0 ? config.timeoutMs : 10000;
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const responseBody = await response.text().catch(() => "");
      const details = responseBody ? ` - ${responseBody}` : "";
      throw new Error(`HTTP ${response.status}${details}`);
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

function unwrapData<T>(response: unknown): T | undefined {
  if (isRecord(response) && "data" in response) {
    return response.data as T;
  }

  return response as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  if (isRecord(value)) {
    return Object.values(value).every(isJsonValue);
  }

  return false;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default WebhookNotificationPlugin;
