# Third-party notices

Chess Hub bundles and depends on the open-source software below. Because it
ships the Stockfish engine (GPL-3.0), **this repository as a whole is licensed
under GPL-3.0** (see `LICENSE`).

## Bundled at runtime

### Stockfish 19 — GPL-3.0-or-later
The chess engine, served from `public/engine/` and run in a Web Worker.
- Upstream: https://stockfishchess.org/ · source: https://github.com/official-stockfish/Stockfish
- JS/WASM build: https://github.com/nmrugg/stockfish.js (npm `stockfish@19.0.1`)
- Full licence text: `public/engine/Copying.txt`
- Files and SHA-256 (as shipped in this repo):
  - `stockfish-19-lite-single.js`  — `ccb130d7ff29408531c47d859a49f91d59d4f482d05a53eb1a3231a4f624c91a`
  - `stockfish-19-lite-single.wasm` — `ee4f115bdb2d32cadf96cada104a05b5ec257d7ad6f57582190b49bc71f096de`
  - `Copying.txt` — `0b383d5a63da644f628d99c33976ea6487ed89aaa59f0b3257992deac1171e6b`

### chess.js 1.4.0 — BSD-2-Clause
Move generation, SAN/FEN/PGN and rules. © Jeff Hlywa.
- https://github.com/jhlywa/chess.js

### Firebase JS SDK 12.19.0 — Apache-2.0
Authentication and Firestore. © Google.
- https://github.com/firebase/firebase-js-sdk

### Capacitor 8 and plugins — MIT
The Android app (Phase 6) runs the web bundle in a Capacitor WebView. Bundled
into the APK: `@capacitor/core`, `@capacitor/android`, `@capacitor/app`,
`@capacitor/status-bar`, `@capacitor/splash-screen`, `@capacitor/filesystem`,
`@capacitor/share`, `@capacitor-firebase/authentication` and
`@capacitor-community/keep-awake`. © Ionic and the Capacitor Community.
- https://github.com/ionic-team/capacitor

### idb 8.0.4 — ISC
IndexedDB helper. © Jake Archibald. https://github.com/jakearchibald/idb

### fflate 0.8.3 — MIT
ZIP/deflate (used for file uploads). https://github.com/101arrowz/fflate

### Lichess data — CC0-1.0
Public-domain data shipped under `public/`, generated from Lichess open data.
- Puzzles (`public/puzzles/*.json`) from the
  [Lichess puzzle database](https://database.lichess.org/#puzzles).
- Opening names (`public/openings.json`) from
  [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings).

## Ported source

### cbh2pgn — MIT
`src/importers/chessbase.js` ports the ChessBase `.cbg` move decoder and its
move tables (`CB_*_ENC`, `DEOBFUSCATE_2B`) from asdfjkl/cbh2pgn, with
python-chess replaced by chess.js. The Scid (`src/importers/scid.js`) and
ChessBase readers were written from format notes in nloding/scidtopgn,
asdfjkl/si4spec and itshak/cbvault, which were consulted as references.
- https://github.com/asdfjkl/cbh2pgn

```
MIT License

Copyright (c) 2022 Dominik Klein

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Build / test tooling (not shipped to users)
- Vite 6.4.5 — MIT — https://github.com/vitejs/vite
- Playwright — Apache-2.0 — https://github.com/microsoft/playwright
