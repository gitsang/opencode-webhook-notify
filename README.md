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
  "timeoutMs": 10000,
  "headers": {
    "X-API-Key": "your-secret"
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

If `payloadTemplates.<event>` exists, it is used for that event. Otherwise `payloadTemplate` is used. If no template is defined, a default payload is sent (including a Discord-compatible object in `discord`).

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
