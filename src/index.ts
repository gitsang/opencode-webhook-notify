import type { Plugin } from "@opencode-ai/plugin";

const PLUGIN_DIR = import.meta.dir;

async function getPackageVersion(): Promise<string> {
  try {
    const result = Bun.spawnSync(["git", "describe", "--tags", "--always", "--dirty"], {
      cwd: PLUGIN_DIR,
    });
    if (result.exitCode === 0) {
      return result.stdout.toString().trim();
    }
  } catch {}

  try {
    const packageUrl = import.meta.resolve("../package.json");
    const packageFile = Bun.file(new URL(packageUrl));
    const pkg = (await packageFile.json()) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

const PACKAGE_VERSION = await getPackageVersion();

type NotificationKind = "idle" | "permission";

interface WebhookEventConfig {
  headers?: Record<string, string>;
  body?: JsonValue;
}

interface WebhookNotifyConfig {
  enabled?: boolean;
  webhookUrl?: string;
  timeoutMs?: number;
  events?: {
    idle?: WebhookEventConfig;
    permission?: WebhookEventConfig;
  };
}

interface SessionModelLimit {
  context?: number;
}

interface SessionModel {
  name?: string;
  limit?: SessionModelLimit;
}

interface SessionData {
  title?: string;
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
  sessionName: string;
  projectPath: string;
  contextUsage: string;
  contextUsagePercent: number | null;
  totalTokens: number;
  modelName: string;
  pendingCommand: string;
  timestamp: string;
  assistantText: string;
}

const DEFAULT_CONFIG_PATH = `${Bun.env.HOME ?? ""}/.config/opencode/opencode-webhook-notify.json`;

export const WebhookNotificationPlugin: Plugin = async ({ client, project, directory }) => {
  console.log(`WebHook Notification Plugin ${PACKAGE_VERSION} initialized!`)

  return {
    event: async ({ event }) => {
      if (!isRecord(event) || typeof event.type !== "string") {
        return;
      }

      const eventType = String(event.type);

      if (eventType === "session.idle") {
        await handleNotification(client, project, directory, event, "idle");
      } else if (eventType === "permission.asked") {
        await handleNotification(client, project, directory, event, "permission");
      }
    },
  };
};

async function handleNotification(
  client: unknown,
  project: unknown,
  directory: string,
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
      sessionName: session?.title ?? "",
      projectPath: directory,
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

function getSessionClient(client: unknown):
  | {
      get: (args: { path: { id: string } }) => Promise<unknown>;
      messages: (args: { path: { id: string } }) => Promise<unknown>;
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

  if (typeof get !== "function" || typeof messages !== "function") {
    return undefined;
  }

  return {
    get: (args) => get.call(maybeSession, args) as Promise<unknown>,
    messages: (args) => messages.call(maybeSession, args) as Promise<unknown>,
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
    events,
  };
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
    case "session.title":
      return context.sessionName;
    case "directory":
      return context.projectPath;
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
