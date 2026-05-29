# Contributing to Prism

Thanks for your interest in contributing! Prism is an open source project and we welcome contributions of all kinds.

## Quick Dev Setup

```bash
git clone https://github.com/IterationLabz/prism.git
cd prism
npm install
npm run dev
```

The app launches with hot-reload. Changes to renderer code update instantly; main process changes trigger an automatic restart.

## Code Style

- **TypeScript strict mode** — no `any` unless absolutely necessary
- **Functional React** — hooks only, no class components
- **Tailwind CSS** — for all styling; avoid inline styles
- **Main/renderer separation** — all Node.js work (DB, API calls, file system) stays in `src/main/`. The renderer communicates exclusively through IPC via the preload bridge. Never import Node.js modules in renderer code.

## Project Structure

```
src/
├── main/           # Electron main process (Node.js)
│   ├── db.ts       # SQLite database
│   ├── ipc.ts      # IPC request handlers
│   └── llm.ts      # LLM provider routing & streaming
├── preload.ts      # Context bridge (main ↔ renderer)
├── shared/         # Types and constants shared across processes
└── renderer/       # React UI
    └── src/
        ├── store.ts       # Zustand state management
        ├── components/    # UI components
        └── hooks/         # Custom React hooks
```

## Submitting Changes

1. **Fork** the repository
2. **Create a branch** from `main` (`git checkout -b feature/your-feature`)
3. **Make your changes** — keep commits focused and descriptive
4. **Test in both connection modes** — verify your changes work in both Direct API and Custom Endpoint modes
5. **Run a build check** — `npm run build` must complete without errors
6. **Open a Pull Request** — describe what you changed and why

## Reporting Bugs

When filing an issue, please include:

- **OS and version** (macOS 14.2, Windows 11, Ubuntu 24.04, etc.)
- **Node.js version** (`node --version`)
- **Steps to reproduce** the issue
- **Expected vs. actual behavior**
- **Console errors** — open DevTools with `Cmd+Option+I` / `Ctrl+Shift+I` and paste any errors from the Console tab

## Code of Conduct

Be respectful and constructive. We're building something useful together. Harassment, discrimination, and toxic behavior have no place here. If someone is being disrespectful, report it to the maintainers and we'll handle it.

## License

By contributing to Prism, you agree that your contributions will be licensed under the [MIT License](LICENSE).
