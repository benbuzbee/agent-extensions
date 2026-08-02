# agent-extensions

A marketplace of plugins for agentic harnesses (Claude Code, OpenCode, Pi, etc).

## Plugins

### `useful-skills`

- **`tech-diagrams`** — Boxes-and-arrows technical diagrams (architecture, data flow, state machines, ER, class hierarchies). Takes a custom agent-friendly `.yaml` grammar and can render to `.svg` or `.excalidraw`.
- **`htmldocs`** — Reviewable HTML documentation (issue logs, architecture specs, handoffs, runbooks) that reads well for humans _and_ parses predictably for agents. Supports SVG diagrams well.

## Install (Claude Code)

```
/plugin marketplace add benbuzbee/agent-extensions
/plugin install useful-skills@agent-extensions
/reload-plugins
```

For local development against a checkout, swap the first line for `/plugin marketplace add <absolute-path-to-this-repo>`.

## Layout

```
agent-extensions/
├── .claude-plugin/
│   └── marketplace.json        # Marketplace catalog (lists plugins)
└── plugins/
    └── useful-skills/
        ├── .claude-plugin/plugin.json
        └── skills/
            ├── tech-diagrams/
            └── htmldocs/
```

## Contributing

PRs welcome, but don't expect urgency. Repo may change shape with no notice as the needs evolve.

Working on `htmldocs`? See [its developer setup](plugins/useful-skills/skills/htmldocs/DEVELOPING.md).

## Authorship

Created by Ben Buzbee on personal time, personal equipment, and personal token spend. Copyright is held solely by the author under the terms of the LICENSE file, and these works are not assigned to any employer. Copy and use under the MIT License below.

## License

MIT — see [LICENSE](LICENSE). Copyright held by Ben Buzbee.
