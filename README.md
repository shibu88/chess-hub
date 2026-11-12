# Chess Hub

Analysis, Training and Play against Stockfish — one codebase for the website and (from
Phase 6) an Android app. Built with Vite + plain JavaScript (ES modules) + CSS. No
framework, no TypeScript.

Guest mode does everything; signing in syncs saved games, training progress and settings.

## Requirements
- Node 20+ (developed on Node 24) and npm.

## Setup
```bash
npm install            # install dependencies
npm run copy-engine    # copy Stockfish 19 lite engine files into public/engine/
cp .env.example .env   # then fill in your Firebase web config (VITE_FIREBASE_*)
```
`.env` is git-ignored. On Windows PowerShell use `Copy-Item .env.example .env`.

## Commands
| Command             | What it does                                  |
| ------------------- | --------------------------------------------- |
| `npm run dev`       | Start the Vite dev server (http://localhost:5173) |
| `npm run build`     | Production build into `dist/`                 |
| `npm run preview`   | Serve the built `dist/` locally               |
| `npm test`          | Unit + engine tests (`node --test`)           |
| `npm run test:e2e`  | Playwright browser tests                      |
| `npm run copy-engine` | Re-copy the Stockfish engine files          |

## Routes (hash-based)
`#/analysis` · `#/training` · `#/play` · `#/about`. Play can start from a position with
`#/play?fen=...`.

## Deploy (Netlify)
Static hosting: build command `npm run build`, publish directory `dist` (see
`netlify.toml`). `npm run build && netlify deploy --prod`.

## Licences
This repository is **GPL-3.0** because it ships the Stockfish engine (GPL-3.0). See the
About page and `THIRD_PARTY_NOTICES.md` for full credits (Stockfish, chess.js, and others).
