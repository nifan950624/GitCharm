import * as vscode from 'vscode';

/**
 * The one editor tab opened by picking a file in the log diff tree.
 * The next file replaces it, the same way a working-tree comparison does.
 */
let opened: { tab: vscode.Tab; original?: string; modified?: string } | null = null;
let tail: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>): Promise<void> {
  const run = tail.then(task, task);
  tail = run.then(() => undefined, () => undefined);
  return run;
}

function endKey(uri: vscode.Uri): string {
  return `${uri.scheme}\0${uri.path}\0${uri.query}`;
}

function isOpen(tab: vscode.Tab): boolean {
  return vscode.window.tabGroups.all.some(group => group.tabs.includes(tab));
}

function tabsWithEnds(original: string, modified: string): vscode.Tab[] {
  const found: vscode.Tab[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (input instanceof vscode.TabInputTextDiff && endKey(input.original) === original && endKey(input.modified) === modified) {
        found.push(tab);
      }
    }
  }
  return found;
}

function tabsOf(kind: 'diff' | 'text'): vscode.Tab[] {
  const found: vscode.Tab[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (kind === 'diff' ? tab.input instanceof vscode.TabInputTextDiff : tab.input instanceof vscode.TabInputText) found.push(tab);
    }
  }
  return found;
}

async function closeTabs(tabs: vscode.Tab[]): Promise<void> {
  const unique: vscode.Tab[] = [];
  const seen = new Set<vscode.Tab>();
  for (const tab of tabs) {
    if (seen.has(tab) || !isOpen(tab)) continue;
    seen.add(tab);
    unique.push(tab);
  }
  if (unique.length === 0) return;
  await vscode.window.tabGroups.close(unique, true);
}

async function closePrevious(): Promise<void> {
  if (!opened) return;
  const previous = opened;
  opened = null;
  const extra = previous.original && previous.modified ? tabsWithEnds(previous.original, previous.modified) : [];
  await closeTabs([previous.tab, ...extra]);
}

function remember(tab: vscode.Tab | undefined): void {
  if (!tab) return;
  if (tab.input instanceof vscode.TabInputTextDiff) {
    opened = { tab, original: endKey(tab.input.original), modified: endKey(tab.input.modified) };
    return;
  }
  opened = { tab };
}

/** Opens a file diff in the tab already used for the log diff tree. */
export function openReplacingDiff(original: vscode.Uri, modified: vscode.Uri, title: string): Promise<void> {
  return enqueue(async () => {
    const originalKey = endKey(original);
    const modifiedKey = endKey(modified);
    if (opened?.original === originalKey && opened.modified === modifiedKey && isOpen(opened.tab)) return;
    // Close the previous file first. Closing after vscode.diff also closes the tab just opened:
    // a preview editor reuses the same tab, so the new diff matches the close set and disappears.
    await closePrevious();
    const before = new Set(tabsOf('diff'));
    await vscode.commands.executeCommand('vscode.diff', original, modified, title, { preview: true });
    const added = tabsOf('diff').filter(tab => !before.has(tab));
    const matched = tabsWithEnds(originalKey, modifiedKey);
    remember(added[added.length - 1] ?? matched[matched.length - 1]);
  });
}

/** Opens a conflicted file in that same tab. */
export function openReplacingText(uri: vscode.Uri): Promise<void> {
  return enqueue(async () => {
    const key = endKey(uri);
    const current = opened?.tab.input;
    if (opened && !opened.original && current instanceof vscode.TabInputText && endKey(current.uri) === key && isOpen(opened.tab)) return;
    await closePrevious();
    const before = new Set(tabsOf('text'));
    await vscode.commands.executeCommand('vscode.open', uri, { preview: true });
    const added = tabsOf('text').filter(tab => !before.has(tab));
    const matched = tabsOf('text').filter(tab => tab.input instanceof vscode.TabInputText && endKey(tab.input.uri) === key);
    remember(added[added.length - 1] ?? matched[matched.length - 1]);
  });
}
