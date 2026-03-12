# opencode-webhook-notify

OpenCode plugin that sends customizable webhook notifications on session completion and permission requests.

## Features

- Sends webhook notifications for:
  - `session.idle` (response/session completion)
  - `permission.asked` (permission required)
- Uses the same event model as `opencode-discord-notification`
- Supports config from `opencode.json` and fallback config file
- Supports custom headers and request timeout
- Supports JSON payload templating with token replacement
- Supports built-in Mattermost payload templates (`{"text":"..."}`)

## Installation

Add it to your `opencode.json`:

```json
{
  "plugin": ["opencode-webhook-notify@0.1.0"]
}
```

## Configuration

You can configure via `opencode.json` under either:

- `webhookNotifications` (recommended)
- `webhookNotify` (legacy alias)

You can also store fallback config at:

- `~/.config/opencode/webhook-notify-config.json`

### Config schema

```json
{
  "enabled": true,
  "webhookUrl": "https://example.com/webhook",
  "username": "OpenCode Notifier",
  "avatarUrl": "https://opencode.ai/logo.png",
  "defaultTemplate": "mattermost",
  "timeoutMs": 10000,
  "headers": {
    "X-API-Key": "your-secret"
  },
  "mattermostTemplate": "### {{title}}\n\n{{description}}\n\n**Model**: {{model.name}}\n**Session**: {{session.id}}",
  "mattermostTemplates": {
    "idle": "### Response Completed\n\n{{assistant.text}}",
    "permission": "### Permission Required\n\nCommand: `{{permission.command}}`"
  },
  "payloadTemplate": {
    "event": "{{event.type}}",
    "title": "{{title}}",
    "description": "{{description}}",
    "sessionId": "{{session.id}}",
    "model": "{{model.name}}",
    "tokens": "{{tokens.total}}",
    "timestamp": "{{timestamp}}"
  },
  "payloadTemplates": {
    "idle": {
      "kind": "completion",
      "summary": "{{assistant.text}}"
    },
    "permission": {
      "kind": "permission",
      "blockedCommand": "{{permission.command}}"
    }
  }
}
```

Template priority:

1. `payloadTemplates.<event>`
2. `payloadTemplate`
3. `mattermostTemplates.<event>`
4. `mattermostTemplate`
5. `defaultTemplate: "mattermost"` fallback
6. Built-in default payload (includes Discord-compatible `discord` object)

### Mattermost example

If you set `defaultTemplate` to `"mattermost"`, the plugin sends a Mattermost-compatible payload like this:

```json
{
  "text": "### Hello\n\nThis is some text\nThis is more text.",
  "props": {
    "card": "Session: ...",
    "notificationType": "idle",
    "eventType": "session.idle"
  }
}
```

Equivalent webhook test (as you shared):

```bash
curl -X POST -H 'Content-Type: application/json' https://mattermost.example/hooks/xxxx -d '{"text":"### Hello\n\nThis is some text\nThis is more text."}'
```

### Supported template tokens

- `{{event.type}}`
- `{{notification.type}}`
- `{{title}}`
- `{{description}}`
- `{{assistant.text}}`
- `{{session.id}}`
- `{{context.usage}}`
- `{{context.usagePercent}}`
- `{{tokens.total}}`
- `{{model.name}}`
- `{{color}}`
- `{{permission.command}}`
- `{{timestamp}}`

## Development

1. Install dependencies: `bun install` (or `npm install`)
2. Type-check: `bun run typecheck` (or `npm run typecheck`)

## License

MIT
