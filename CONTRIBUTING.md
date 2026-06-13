# Contributing

Contributions are welcome. Here is how to get started in under 5 minutes.

## Prerequisites

- Node.js >= 20
- pnpm >= 10
- A running MongoDB instance

## Local setup

```bash
git clone https://github.com/deniscuciuc/db-analyzer-mongo.git
cd db-analyzer-mongo
pnpm install
cp analyzerrc.example.json .analyzerrc.json
# edit .analyzerrc.json with your local connection details
pnpm build
node dist/index.js --help
```

## Development workflow

```bash
pnpm build
pnpm lint
pnpm lint:fix
```

## Submitting a pull request

1. Fork the repository and create a branch: `git checkout -b fix/my-fix`
2. Make your changes
3. Run `pnpm lint && pnpm build` - both must pass
4. Open a PR against `main` with a clear description of what changed and why

## Coding standards

- TypeScript strict mode - no `any`
- Biome formatting (tab indent, enforced by CI)
- No new runtime dependencies without discussion in an issue first

## Reporting bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md).
Always include: MongoDB version, Node.js version, OS, the command you ran, and the full output.
