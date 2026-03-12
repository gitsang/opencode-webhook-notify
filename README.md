# opencode-webhook-notify

OpenCode plugin that sends customizable webhook notifications on session completion and permission requests.

## Features

Sends webhook notifications for:

- `session.idle` (response/session completion)
- `permission.asked` (permission required)

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
