# Sort Selected Lines (Region + Numeric Aware)

Sorts selected lines ascending or descending, with three key behaviors:

1. **Sorts by only the selected part of each line.** If you select just
   the last 3 characters of a line, that line is reordered based on those
   3 characters — not the whole line — but the *entire line* still moves
   as a unit.
2. **Non-contiguous selections become separate regions.** If you select
   lines 1-3 and 5-7 (skipping line 4), lines 1-3 are sorted among
   themselves, line 4 is left untouched, and lines 5-7 are sorted among
   themselves, independently.
3. **Numeric-aware ("natural") ordering.** Embedded numbers are compared
   as numbers, not character-by-character, so `a2` sorts before `a10`,
   and a leading `-` directly attached to digits is treated as a negative
   number (`-7` sorts before `7`), not as a bare minus sign.

## Usage

1. Make one or more selections in the editor (multi-cursor / multi-select
   works — hold Ctrl/Cmd or Alt+drag to select multiple regions).
2. Run one of:
   - `Sort Selected Lines: Ascending`
   - `Sort Selected Lines: Descending`

   via the Command Palette, the editor right-click menu, or the keybindings:
   - `Ctrl+Alt+S` then `Ctrl+Alt+A` — ascending
   - `Ctrl+Alt+S` then `Ctrl+Alt+D` — descending

## Development

```bash
npm install
npm run compile
```

Then press `F5` in VS Code to launch an Extension Development Host and try
it out.
