import * as vscode from "vscode"

/**
 * Tokenize a string into alternating string/number chunks so that
 * embedded integers (including negative ones, e.g. "-7") are compared
 * numerically instead of character-by-character.
 *
 * "a10" -> ["a", 10]
 * "-7"  -> [-7]
 * "a2"  -> ["a", 2]
 */
function tokenize(input: string): (string | number)[] {
  // Matches an optional leading '-' directly attached to digits (no space),
  // followed by digits and an optional decimal part.
  const parts = input.split(/(-?\d+(?:\.\d+)?)/g)
  const tokens: (string | number)[] = []
  for (const part of parts) {
    if (part === "") {
      continue
    }
    if (/^-?\d+(?:\.\d+)?$/.test(part)) {
      tokens.push(parseFloat(part))
    } else {
      tokens.push(part)
    }
  }
  return tokens
}

function compareTokens(
  a: (string | number)[],
  b: (string | number)[],
): number {
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const ta = a[i]
    const tb = b[i]

    if (ta === undefined) return -1
    if (tb === undefined) return 1

    if (typeof ta === "number" && typeof tb === "number") {
      if (ta !== tb) return ta - tb
      continue
    }

    // Mixed types or both strings: compare as strings.
    const sa = String(ta)
    const sb = String(tb)
    if (sa !== sb) {
      return sa.localeCompare(sb)
    }
  }
  return 0
}

function naturalCompare(a: string, b: string): number {
  return compareTokens(tokenize(a), tokenize(b))
}

interface LineInfo {
  line: number
  fullText: string
  key: string
}

/**
 * Given all selections in the editor, compute the "sort key" text for every
 * line touched by a selection. The key is the substring of the line that
 * falls inside the selection (not the whole line), unless the whole line is
 * covered by the selection.
 */
function computeLineKeys(
  document: vscode.TextDocument,
  selections: readonly vscode.Selection[],
): Map<number, string> {
  const keys = new Map<number, string>()

  for (const sel of selections) {
    if (sel.isEmpty) {
      continue // a bare cursor selects nothing; ignore it
    }

    let endLine = sel.end.line
    let endChar = sel.end.character

    // VS Code represents "select whole line(s) including trailing newline"
    // selections with an end position of character 0 on the line *after*
    // the last fully-selected line. Treat that boundary as exclusive so we
    // don't create a bogus empty key on the following line.
    if (endChar === 0 && endLine > sel.start.line) {
      endLine = endLine - 1
      endChar = document.lineAt(endLine).text.length
    }

    for (let line = sel.start.line; line <= endLine; line++) {
      const lineText = document.lineAt(line).text
      const startChar =
        line === sel.start.line ? sel.start.character : 0
      const stopChar = line === endLine ? endChar : lineText.length
      const segment = lineText.substring(startChar, stopChar)

      const existing = keys.get(line)
      keys.set(
        line,
        existing !== undefined ? existing + segment : segment,
      )
    }
  }

  return keys
}

/**
 * Group touched line numbers into contiguous runs. Non-adjacent selections
 * (e.g. lines 1-3 and 5-7, with line 4 untouched) become separate regions
 * that are sorted independently.
 */
function groupIntoRegions(touchedLines: number[]): number[][] {
  const sorted = [...touchedLines].sort((a, b) => a - b)
  const regions: number[][] = []
  let current: number[] = []

  for (const line of sorted) {
    if (
      current.length === 0 ||
      line === current[current.length - 1] + 1
    ) {
      current.push(line)
    } else {
      regions.push(current)
      current = [line]
    }
  }
  if (current.length > 0) {
    regions.push(current)
  }
  return regions
}

function wholeDocumentSelection(
  document: vscode.TextDocument,
): vscode.Selection {
  const lastLine = document.lineCount - 1
  const start = new vscode.Position(0, 0)
  const end = new vscode.Position(
    lastLine,
    document.lineAt(lastLine).text.length,
  )
  return new vscode.Selection(start, end)
}

function sortSelectedLines(
  editor: vscode.TextEditor,
  descending: boolean,
): Thenable<boolean> {
  const document = editor.document
  const hasRealSelection = editor.selections.some(
    (sel) => !sel.isEmpty,
  )

  // Nothing selected (just cursor(s), no highlighted text): treat the
  // whole document as the selection instead of prompting the user.
  const effectiveSelections: readonly vscode.Selection[] =
    hasRealSelection ?
      editor.selections
    : [wholeDocumentSelection(document)]

  const keys = computeLineKeys(document, effectiveSelections)
  const touchedLines = Array.from(keys.keys())

  if (touchedLines.length === 0) {
    return Promise.resolve(false)
  }

  const regions = groupIntoRegions(touchedLines)

  // Maps an original line number to the line number it will occupy after
  // sorting, so single-line selections can be re-placed on their line's
  // new position afterwards.
  const lineMap = new Map<number, number>()
  const originalSelections = [...editor.selections]

  return editor
    .edit((editBuilder) => {
      for (const region of regions) {
        if (region.length < 2) {
          continue // nothing to reorder
        }

        const infos: LineInfo[] = region.map((line) => ({
          line,
          fullText: document.lineAt(line).text,
          // Trim: a selection that starts/ends mid-line (e.g. after the
          // leading indentation on the first line, but at column 0 on
          // every other line in the region) produces keys with
          // inconsistent leading/trailing whitespace across lines. Since
          // the key is only used for ordering (fullText is still what
          // gets swapped in), stripping incidental whitespace here
          // prevents it from outranking the actual content during
          // comparison.
          key: (keys.get(line) as string).trim(),
        }))

        infos.sort((a, b) => {
          const cmp = naturalCompare(a.key, b.key)
          return descending ? -cmp : cmp
        })

        const firstLine = region[0]
        const lastLine = region[region.length - 1]
        const range = new vscode.Range(
          new vscode.Position(firstLine, 0),
          new vscode.Position(
            lastLine,
            document.lineAt(lastLine).text.length,
          ),
        )

        const newText = infos.map((i) => i.fullText).join("\n")
        editBuilder.replace(range, newText)

        infos.forEach((info, index) => {
          lineMap.set(info.line, firstLine + index)
        })
      }
    })
    .then((success) => {
      if (success) {
        repositionSingleLineSelections(
          editor,
          originalSelections,
          lineMap,
        )
      }
      return success
    })
}

/**
 * After the sort edit is applied, move any selection that was originally
 * confined to a single line so it stays on the same characters of that
 * line's content, now at the line's new position. Multi-line selections
 * are left as-is.
 */
function repositionSingleLineSelections(
  editor: vscode.TextEditor,
  originalSelections: readonly vscode.Selection[],
  lineMap: Map<number, number>,
): void {
  const newSelections = originalSelections.map((sel) => {
    if (sel.start.line !== sel.end.line) {
      return sel // multi-line selection: leave untouched
    }

    const newLine = lineMap.get(sel.start.line)
    if (newLine === undefined || newLine === sel.start.line) {
      return sel // line didn't move (or wasn't part of a sorted region)
    }

    const anchor = new vscode.Position(newLine, sel.anchor.character)
    const active = new vscode.Position(newLine, sel.active.character)
    return new vscode.Selection(anchor, active)
  })

  editor.selections = newSelections
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("line-sorter.sortAsc", () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) return
      sortSelectedLines(editor, false)
    }),
    vscode.commands.registerCommand("line-sorter.sortDesc", () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) return
      sortSelectedLines(editor, true)
    }),
  )
}

export function deactivate(): void {}
