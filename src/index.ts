import type { Plugin } from "@opencode-ai/plugin";

type NotificationKind = "idle" | "permission";

interface WebhookNotifyConfig {
  enabled?: boolean;
  webhookUrl?: string;
  username?: string;
  avatarUrl?: string;
  defaultTemplate?: "discord" | "mattermost";
  headers?: Record<string, string>;
  timeoutMs?: number;
  mattermostTemplate?: string;
  mattermostTemplates?: {
    idle?: string;
    permission?: string;
  };
  payloadTemplate?: JsonValue;
  payloadTemplates?: {
    idle?: JsonValue;
    permission?: JsonValue;
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

const DEFAULT_CONFIG_PATH = `${Bun.env.HOME ?? ""}/.config/opencode/webhook-notify-config.json`;

export const WebhookNotificationPlugin: Plugin = async ({ client, project }) => {
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

    const payloadTemplate = config.payloadTemplates?.[type] ?? config.payloadTemplate;
    const mattermostTemplate = config.mattermostTemplates?.[type] ?? config.mattermostTemplate;

    const payload = payloadTemplate
      ? renderTemplate(payloadTemplate, context)
      : config.defaultTemplate === "mattermost" || typeof mattermostTemplate === "string"
        ? createMattermostPayload(context, mattermostTemplate)
        : createDefaultPayload(config, context);

    await postWebhook(config, payload);
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
    get: (args) => get(args) as Promise<unknown>,
    messages: (args) => messages(args) as Promise<unknown>,
  };
}

async function loadConfig(project: unknown): Promise<WebhookNotifyConfig> {
  const projectConfig = getProjectConfig(project);
  const pluginConfig =
    (isRecord(projectConfig.webhookNotifications) ? projectConfig.webhookNotifications : undefined) ??
    (isRecord(projectConfig.webhookNotify) ? projectConfig.webhookNotify : undefined);

  const normalizedProjectConfig = pluginConfig ? normalizeConfig(pluginConfig) : {};

  if (normalizedProjectConfig.webhookUrl) {
    return normalizedProjectConfig;
  }

  const fileConfig = await readFileConfig(DEFAULT_CONFIG_PATH);
  return {
    ...fileConfig,
    ...normalizedProjectConfig,
  };
}

function getProjectConfig(project: unknown): Record<string, unknown> {
  if (!isRecord(project)) {
    return {};
  }

  const config = project.config;
  if (!isRecord(config)) {
    return {};
  }

  return config;
}

function normalizeConfig(input: Record<string, unknown>): WebhookNotifyConfig {
  const headers = isRecord(input.headers)
    ? Object.fromEntries(
        Object.entries(input.headers)
          .filter((entry): entry is [string, string] => typeof entry[1] === "string")
          .map(([key, value]) => [key, value]),
      )
    : undefined;

  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : true,
    webhookUrl: typeof input.webhookUrl === "string" ? input.webhookUrl : undefined,
    username: typeof input.username === "string" ? input.username : undefined,
    avatarUrl: typeof input.avatarUrl === "string" ? input.avatarUrl : undefined,
    defaultTemplate:
      input.defaultTemplate === "discord" || input.defaultTemplate === "mattermost"
        ? input.defaultTemplate
        : undefined,
    headers,
    timeoutMs: typeof input.timeoutMs === "number" ? input.timeoutMs : undefined,
    mattermostTemplate:
      typeof input.mattermostTemplate === "string" ? input.mattermostTemplate : undefined,
    mattermostTemplates: isRecord(input.mattermostTemplates)
      ? {
          idle:
            typeof input.mattermostTemplates.idle === "string"
              ? input.mattermostTemplates.idle
              : undefined,
          permission:
            typeof input.mattermostTemplates.permission === "string"
              ? input.mattermostTemplates.permission
              : undefined,
        }
      : undefined,
    payloadTemplate: isJsonValue(input.payloadTemplate) ? input.payloadTemplate : undefined,
    payloadTemplates: isRecord(input.payloadTemplates)
      ? {
          idle: isJsonValue(input.payloadTemplates.idle) ? input.payloadTemplates.idle : undefined,
          permission: isJsonValue(input.payloadTemplates.permission)
            ? input.payloadTemplates.permission
            : undefined,
        }
      : undefined,
  };
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

function createDefaultPayload(config: WebhookNotifyConfig, context: NotificationContext): JsonObject {
  const fields: JsonObject[] = [];

  if (context.notificationType === "permission") {
    fields.push({
      name: "Blocked Command / Action",
      value: `\`\`\`bash\n${context.pendingCommand || "Check terminal for details"}\n\`\`\``,
      inline: false,
    });
  }

  fields.push(
    { name: "Context Usage", value: context.contextUsage, inline: true },
    { name: "Total Tokens", value: `${context.totalTokens.toLocaleString()} tokens`, inline: true },
    { name: "Model", value: context.modelName, inline: true },
  );

  const trimmedDescription =
    context.description.length > 1500
      ? `${context.description.slice(0, 1497)}...`
      : context.description;

  const discordPayload: JsonObject = {
    username: config.username ?? "OpenCode Notifier",
    embeds: [
      {
        title: context.title,
        description: trimmedDescription,
        color: context.color,
        fields,
        footer: { text: `Session ID: ${context.sessionId}` },
        timestamp: context.timestamp,
      },
    ],
  };

  if (config.avatarUrl) {
    discordPayload.avatar_url = config.avatarUrl;
  }

  return {
    event: context.eventType,
    sessionId: context.sessionId,
    type: context.notificationType,
    title: context.title,
    description: context.description,
    contextUsage: context.contextUsage,
    contextUsagePercent: context.contextUsagePercent,
    totalTokens: context.totalTokens,
    model: context.modelName,
    pendingCommand: context.pendingCommand,
    timestamp: context.timestamp,
    discord: discordPayload,
  };
}

function createMattermostPayload(context: NotificationContext, template?: string): JsonObject {
  const fallback =
    context.notificationType === "permission"
      ? [
          `### ${context.title}`,
          "",
          context.description,
          "",
          `**Command**: \`${context.pendingCommand || "Check terminal for details"}\``,
          `**Model**: ${context.modelName}`,
          `**Context Usage**: ${context.contextUsage}`,
          `**Total Tokens**: ${context.totalTokens.toLocaleString()}`,
          `**Session**: ${context.sessionId}`,
        ].join("\n")
      : [
          `### ${context.title}`,
          "",
          context.assistantText,
          "",
          `**Model**: ${context.modelName}`,
          `**Context Usage**: ${context.contextUsage}`,
          `**Total Tokens**: ${context.totalTokens.toLocaleString()}`,
          `**Session**: ${context.sessionId}`,
        ].join("\n");

  const text = typeof template === "string" ? replaceTokens(template, context) : fallback;

  return {
    text,
    props: {
      card: `Session: ${context.sessionId}`,
      notificationType: context.notificationType,
      eventType: context.eventType,
    },
  };
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

async function postWebhook(config: WebhookNotifyConfig, payload: JsonValue): Promise<void> {
  if (!config.webhookUrl) {
    return;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(config.headers ?? {}),
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
