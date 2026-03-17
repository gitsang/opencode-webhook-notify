# opencode-webhook-notify

OpenCode plugin that sends customizable webhook notifications on session completion and permission requests.

## Features

Sends webhook notifications for:

- `session.idle` (response/session completion)
- `permission.asked` (permission required)

Can also receive inbound webhook requests and forward them into a session as a new user message.

## Installation

```
npm i -g opencode-webhook-notify@latest
```

Add it to your `opencode.json` plugin list:

```json
{
  "plugin": ["opencode-webhook-notify@latest"]
}
```

## Configuration

Configure webhook settings in:

- `~/.config/opencode/opencode-webhook-notify.json`

### Config schema

```json
{
  "enabled": true,
  "webhookUrl": "https://example.com/webhook",
  "timeoutMs": 10000,
  "inbound": {
    "enabled": true,
    "host": "127.0.0.1",
    "port": 8787,
    "path": "/webhook/session-message",
    "token": "replace-with-random-secret",
    "mode": "promptAsync"
  },
  "events": {
    "idle": {
      "headers": {
        "Session": "{{session.id}}"
      },
      "body": {
        "text": "### {{title}}\n\n{{description}}\n\n**Model**: {{model.name}}\n**Session**: {{session.id}}\n\n### Response Completed\n\n{{assistant.text}}"
      }
    },
    "permission": {
      "headers": {
        "Session": "{{session.id}}"
      },
      "body": {
        "text": "### {{title}}\n\n{{description}}\n\n**Model**: {{model.name}}\n**Session**: {{session.id}}\n\n### Response Completed\n\n{{assistant.text}}"
      }
    }
  }
}
```

If `events.<event>.headers` or `events.<event>.body` is missing, the plugin falls back to a default text payload and standard `Content-Type: application/json` header.

### Inbound webhook (send message to session)

When `inbound.enabled` is `true`, the plugin starts a local HTTP endpoint:

- URL: `http://<host>:<port><path>`
- Method: `POST`
- Auth:
  - If `inbound.token` is set, provide either:
    - `Authorization: Bearer <token>`
    - `X-Webhook-Token: <token>`

#### Inbound payload schema

```json
{
  "sessionId": "ses_xxx",
  "text": "Please continue from the previous task",
  "noReply": false,
  "agent": "build",
  "model": {
    "providerID": "openrouter",
    "modelID": "anthropic/claude-sonnet-4"
  }
}
```

Accepted aliases:

- `sessionID` / `id` for `sessionId`
- `message` / `prompt` for `text`

`mode` behavior:

- `promptAsync` (default): enqueue immediately and return
- `prompt`: wait for synchronous prompt execution

#### Curl example

```bash
curl -X POST "http://127.0.0.1:8787/webhook/session-message" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer replace-with-random-secret" \
  -d '{
    "sessionId": "ses_abc123",
    "text": "请继续处理当前问题"
  }'
```

### Supported template tokens

- `{{event.type}}`
- `{{notification.type}}`
- `{{title}}`
- `{{description}}`
- `{{assistant.text}}`
- `{{session.id}}`
- `{{session.name}}`
- `{{project.path}}`
- `{{context.usage}}`
- `{{context.usagePercent}}`
- `{{tokens.total}}`
- `{{model.name}}`
- `{{color}}`
- `{{permission.command}}`
- `{{timestamp}}`

### Example

#### Mattermost

```json
{
  "enabled": true,
  "webhookUrl": "https://mattermost.example.com/hooks/token-here",
  "timeoutMs": 10000,
  "events": {
    "idle": {
      "body": {
        "text": "### {{title}}\n\n{{description}}\n---\n**Model**: {{model.name}}\n**Session**: {{session.id}}"
      }
    },
    "permission": {
      "body": {
        "text": "### {{title}}\n\n{{description}}\n---\n**Model**: {{model.name}}\n**Session**: {{session.id}}"
      }
    }
  }
}
```

## Development

1. Install dependencies: `bun install` (or `npm install`)
2. Type-check: `bun run typecheck` (or `npm run typecheck`)

## License

MIT
