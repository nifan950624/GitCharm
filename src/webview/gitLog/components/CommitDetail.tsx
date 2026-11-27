import React, { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import type { CommitNode, RepoMeta, MergeParentCommit } from '../../shared/types';
import { getVsCodeApi } from '../../shared/vscodeApi';
import type { LogToHostMsg, HostToLogMsg, IconThemeData, CommitSelectionMode } from '../../../host/types/messages';
import { commitRevision } from '../utils/commitSelection';
import type { CommitSelection } from '../utils/commitSelection';
import { Codicon } from '../../shared/Codicon';
import { groupRefs, branchColor, tagColor, headColor, primaryBranchColor } from '../utils/refs';
import { formatDateTime } from '../../shared/dateUtils';
import type { RefGroup } from '../utils/refs';
import { isPrimaryBranch } from '../../shared/branchUtils';
import { AuthorAvatar } from '../../shared/AuthorAvatar';
import { forgeSha } from '../../shared/avatars';
import { CommitRow } from '../../shared/CommitRow';
import { FileTreeView } from '../../shared/FileTreeView';
import { GenericFileTree } from '../../shared/GenericFileTree';
import { handleTreeNavKeyDown } from '../../shared/keyboardNav';
import type { ChangedFile } from '../../../host/types/messages';
import * as l10n from '@vscode/l10n';
import { plural } from '../../shared/l10n';
import { ResizeHandle } from '../../shared/ResizeHandle';
import { fileMatchesPath } from '../utils/pathFilter';

function generateId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

interface FileContextMenuProps {
  x: number;
  y: number;
  file: { path: string; status: string };
  onShowDiff: () => void;
  onShowCombinedDiff: () => void;
  onEditSource: () => void;
  onFileHistory: () => void;
  onCompareWith: () => void;
  onCherryPickFile: () => void;
  onRevertFile: () => void;
  onRevealExplorer: () => void;
  onRevealOS: () => void;
  onClose: () => void;
  canApplyCommitChanges: boolean;
  /** An uncommitted file: there is no revision to compare with or combine. */
  isWorkingTree?: boolean;
}

function FileContextMenu({ x, y, onShowDiff, onShowCombinedDiff, onEditSource, onFileHistory, onCompareWith, onCherryPickFile, onRevertFile, onRevealExplorer, onRevealOS, onClose, canApplyCommitChanges, isWorkingTree }: FileContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const { offsetWidth: w, offsetHeight: h } = el;
    const margin = 4;
    setPos({
      x: Math.max(margin, Math.min(x, window.innerWidth  - w - margin)),
      y: Math.max(margin, Math.min(y, window.innerHeight - h - margin)),
    });
  }, [x, y]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener('mousedown', h, true);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('mousedown', h, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    left: pos?.x ?? x,
    top: pos?.y ?? y,
    visibility: pos ? 'visible' : 'hidden',
    background: 'var(--vscode-menu-background)',
    border: '1px solid var(--vscode-menu-border, var(--vscode-panel-border))',
    borderRadius: '4px',
    padding: '3px 0',
    zIndex: 9999,
    minWidth: '160px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
  };

  const itemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '4px 12px',
    fontSize: '12px',
    cursor: 'pointer',
    color: 'var(--vscode-menu-foreground)',
    userSelect: 'none',
  };

  const hoverStyle = { background: 'var(--vscode-menu-selectionBackground)', color: 'var(--vscode-menu-selectionForeground)' };

  const Item = ({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) => {
    const [hovered, setHovered] = useState(false);
    return (
      <div
        style={{ ...itemStyle, ...(hovered ? hoverStyle : {}) }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => { onClick(); onClose(); }}
      >
        <Codicon name={icon} style={{ fontSize: '13px', flexShrink: 0 }} />
        {label}
      </div>
    );
  };

  const openLeft = (pos?.x ?? x) > window.innerWidth * 0.6;

  return (
    <div ref={menuRef} style={menuStyle} onContextMenu={e => e.preventDefault()}>
      <Item icon="diff" label={l10n.t('Show Diff')} onClick={onShowDiff} />
      <Item icon="history" label={l10n.t('Show File History')} onClick={onFileHistory} />
      {!isWorkingTree && (
        <>
          <Item icon="diff-multiple" label={l10n.t('Show Combined Diff')} onClick={onShowCombinedDiff} />
          <Item icon="git-compare" label={l10n.t('Compare with…')} onClick={onCompareWith} />
        </>
      )}
      {canApplyCommitChanges && (
        <>
          <Item icon="git-commit" label={l10n.t('Cherry-Pick Selected Changes')} onClick={onCherryPickFile} />
          <Item icon="discard" label={l10n.t('Revert Selected Changes')} onClick={onRevertFile} />
        </>
      )}
      <div style={{ height: '1px', background: 'var(--vscode-menu-separatorBackground, var(--vscode-panel-border))', margin: '4px 0' }} />
      <Submenu icon="go-to-file" label={l10n.t('Go to')} openLeft={openLeft} itemStyle={itemStyle} hoverStyle={hoverStyle}>
        <Item icon="go-to-file" label={l10n.t('Edit Source')} onClick={onEditSource} />
        <Item icon="list-tree" label={l10n.t('Reveal in Explorer')} onClick={onRevealExplorer} />
        <Item icon="folder-opened" label={l10n.t('Reveal in File Manager')} onClick={onRevealOS} />
      </Submenu>
    </div>
  );
}

function Submenu({ icon, label, openLeft, itemStyle, hoverStyle, children }: {
  icon: string;
  label: string;
  openLeft: boolean;
  itemStyle: React.CSSProperties;
  hoverStyle: React.CSSProperties;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <div style={{ ...itemStyle, ...(open ? hoverStyle : {}), paddingRight: '8px' }}>
        <Codicon name={icon} style={{ fontSize: '13px', flexShrink: 0 }} />
        <span style={{ flex: 1 }}>{label}</span>
        <Codicon name="chevron-right" style={{ fontSize: '12px', opacity: 0.7 }} />
      </div>
      {open && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: openLeft ? undefined : 'calc(100% - 4px)',
          right: openLeft ? 'calc(100% - 4px)' : undefined,
          background: 'var(--vscode-menu-background)',
          border: '1px solid var(--vscode-menu-border, var(--vscode-panel-border))',
          borderRadius: '4px',
          padding: '3px 0',
          minWidth: '180px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          zIndex: 1,
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

function DirHistoryMenu({ x, y, onShowHistory, onClose }: { x: number; y: number; onShowHistory: () => void; onClose: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [hovered, setHovered] = useState(false);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const margin = 4;
    setPos({
      x: Math.max(margin, Math.min(x, window.innerWidth - el.offsetWidth - margin)),
      y: Math.max(margin, Math.min(y, window.innerHeight - el.offsetHeight - margin)),
    });
  }, [x, y]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener('mousedown', h, true);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('mousedown', h, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      onContextMenu={e => e.preventDefault()}
      style={{
        position: 'fixed',
        left: pos?.x ?? x,
        top: pos?.y ?? y,
        visibility: pos ? 'visible' : 'hidden',
        background: 'var(--vscode-menu-background)',
        border: '1px solid var(--vscode-menu-border, var(--vscode-panel-border))',
        borderRadius: '4px',
        padding: '3px 0',
        zIndex: 9999,
        minWidth: '160px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
      }}
    >
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 12px', fontSize: '12px', cursor: 'pointer',
          color: hovered ? 'var(--vscode-menu-selectionForeground)' : 'var(--vscode-menu-foreground)',
          background: hovered ? 'var(--vscode-menu-selectionBackground)' : 'transparent',
          userSelect: 'none',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => { onShowHistory(); onClose(); }}
      >
        <Codicon name="history" style={{ fontSize: '13px', flexShrink: 0 }} />
        {l10n.t('Show History')}
      </div>
    </div>
  );
}

interface Props {
  commit: CommitNode | null;
  /** Full (multi-line) commit message body — only used in twoColumnLayout mode's expanded "Commit message" section. Falls back to `commit.message` (subject only) when omitted. */
  fullMessage?: string;
  /** Several commits picked together: shows what they change instead of `commit`'s details. */
  selection?: CommitSelection;
  /** Set when the selection can switch between its combined changes and a snapshot diff. */
  onSelectionModeChange?: (mode: CommitSelectionMode) => void;
  files: FileEntry[];
  selectedFile: { path: string; status: string; repoId?: string } | null;
  loadingFiles: boolean;
  repoColor?: string;
  /** Colors of the repos, to tell apart the file groups of a selection spanning several. */
  repoColors?: Record<string, string>;
  repos: RepoMeta[];
  iconTheme?: IconThemeData | null;
  onSelectFile: (file: { path: string; status: string }) => void;
  onClose?: () => void;
  refColors?: Map<string, string>;
  themeVersion?: number;
  activeProfile?: { name: string; gitName: string; gitEmail: string; builtIn?: 'local' | 'global' };
  /** Hides the "Open extended commit detail" button — used when this component IS the extended/full detail view, so the button would otherwise be a dead no-op there. */
  hideExtendedDetailButton?: boolean;
  /** Renders the commit header (author/hash/dates/refs/message/merge list) and the file list
   * side by side instead of stacked — for use in a full-page context (the "Open Full Detail"
   * panel) where there's room for two columns, unlike the narrow Log Panel sidebar this
   * component is otherwise embedded in. */
  twoColumnLayout?: boolean;
  /** Log path filter. Merge-parent file lists use the same path as the diff tree. */
  pathFilter?: { path: string; follow: boolean };
}

const STATUS_COLORS: Record<string, string> = {
  M: 'var(--vscode-gitDecoration-modifiedResourceForeground)',
  A: 'var(--vscode-gitDecoration-addedResourceForeground)',
  D: 'var(--vscode-gitDecoration-deletedResourceForeground)',
  R: 'var(--vscode-gitDecoration-renamedResourceForeground, #73c991)',
  C: 'var(--vscode-gitDecoration-addedResourceForeground)',
  // Uncommitted files only
  U: 'var(--vscode-gitDecoration-untrackedResourceForeground)',
  '!': 'var(--vscode-gitDecoration-conflictingResourceForeground)',
};

/** A changed file — of one commit, or of a selection (then with its repo and, combined, the revisions it spans). */
interface FileEntry { path: string; status: string; added?: number; removed?: number; oldPath?: string; repoId?: string; baseRef?: string; headRef?: string; }

function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? 'var(--vscode-foreground)';
}

const CHANGED_FILE_STATUS: Record<string, ChangedFile['status']> = {
  A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'added', U: 'added',
};

/** Maps the Log Panel's single-letter file status (from a raw git diff) to FileTreeView's ChangedFile shape. */
function toChangedFile(f: { path: string; status: string; added?: number; removed?: number; oldPath?: string }): ChangedFile {
  return {
    path: f.path, oldPath: f.oldPath,
    status: CHANGED_FILE_STATUS[f.status] ?? 'modified',
    additions: f.added, deletions: f.removed,
  };
}

/* ─── Badge helpers ───────────────────────────────────────────────────────── */

function remoteLabel(group: RefGroup): string {
  const r = group.remoteName || 'remote';
  return `${r}/${group.label}`;
}

function badgeTitle(group: RefGroup): string {
  if (group.isRemoteHead) return l10n.t('Remote HEAD ({0})', `${group.remoteName}/HEAD`);
  if (group.isDetached && group.isHead) return l10n.t('HEAD (detached)');
  if (group.isTag) return l10n.t('Tag: {0}', group.label);
  if (group.isRemote) return l10n.t('Remote: {0}', remoteLabel(group));
  return l10n.t('Local: {0}', group.label);
}

function RefBadgeIcon({ group }: { group: RefGroup }) {
  const s: React.CSSProperties = { fontSize: '11px', flexShrink: 0, lineHeight: 1 };
  if (group.isRemoteHead) return <Codicon name="milestone" style={s} />;
  if (group.isDetached && group.isHead) return <Codicon name="warning" style={s} />;
  if (group.isTag) return <Codicon name="tag" style={s} />;
  if (group.isRemote) return <Codicon name="cloud" style={s} />;
  return <Codicon name="git-branch" style={s} />;
}

/** A row listing a commit (of a selection, or merged by a merge commit) — clicking it opens the commit's full detail. */
function OpenDetailRow({ repoId, hash, style, children }: { repoId: string; hash: string; style: React.CSSProperties; children: React.ReactNode }) {
  const [hovered, setHovered] = useState(false);
  const open = () => getVsCodeApi().postMessage({ type: 'LOG_OPEN_EXTENDED_DETAIL', repoId, hash } satisfies LogToHostMsg);
  return (
    <div
      role="button"
      tabIndex={0}
      style={{ ...style, ...styles.openDetailRow(hovered) }}
      title={l10n.t('Open Full Detail')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={open}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
    >
      {children}
    </div>
  );
}

const TREE_MIN_HEIGHT = 24;
const DETAIL_MIN_HEIGHT = 28;
const DETAIL_SLOPE_KEY = 'gitcharm.split.log.detailInfoSlope';
/** Initial share of new height taken by the log. The tree takes the rest, and its share rises as the pane grows. */
const DETAIL_SLOPE_DEFAULT = 0.35;

function readDetailSlope(): number {
  try {
    const n = Number(localStorage.getItem(DETAIL_SLOPE_KEY));
    return Number.isFinite(n) && n >= 0.05 && n <= 4 ? n : DETAIL_SLOPE_DEFAULT;
  } catch {
    return DETAIL_SLOPE_DEFAULT;
  }
}

function writeDetailSlope(slope: number) {
  try { localStorage.setItem(DETAIL_SLOPE_KEY, String(Math.round(slope * 1000) / 1000)); } catch { /* storage unavailable */ }
}

interface DetailSplitMeasure {
  spare: number;
  room: number;
  content: number;
  limit: number;
}

/** Border-box height that fits the message. Read from the inner content, not the scroller:
 *  the scroller's scrollHeight grows with the height just assigned to it, so a resize loop shakes the pane. */
function contentBoxHeight(info: HTMLElement, content: HTMLElement | null): number {
  if (!content) return info.scrollHeight;
  const style = getComputedStyle(info);
  const pad = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  const border = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
  return content.offsetHeight + pad + border;
}

/** Space the log and the tree can share, and how tall the log's content wants to be. */
function measureDetailSplit(root: HTMLElement, info: HTMLElement, content: HTMLElement | null): DetailSplitMeasure {
  let fixed = 0;
  for (const child of Array.from(root.children)) {
    if (child === info || !(child instanceof HTMLElement)) continue;
    const style = getComputedStyle(child);
    if (style.display === 'none' || style.position === 'absolute' || style.position === 'fixed') continue;
    if (parseFloat(style.flexGrow) > 0) continue;
    fixed += child.offsetHeight;
  }
  const pair = Math.max(0, root.clientHeight - fixed);
  const contentHeight = Math.round(contentBoxHeight(info, content));
  return {
    spare: Math.max(0, pair - TREE_MIN_HEIGHT - DETAIL_MIN_HEIGHT),
    room: Math.max(0, contentHeight - DETAIL_MIN_HEIGHT),
    content: contentHeight,
    limit: Math.max(DETAIL_MIN_HEIGHT, pair - TREE_MIN_HEIGHT),
  };
}

/** Log height eases toward the message, so later growth goes to the tree. */
function infoGain(spare: number, room: number, slope: number): number {
  if (spare <= 0 || room <= 0 || slope <= 0) return 0;
  return Math.min(room, spare, room * (1 - Math.exp(-slope * spare / room)));
}

function heightFromSlope(measure: DetailSplitMeasure, slope: number): number {
  const gain = infoGain(measure.spare, measure.room, slope);
  const cap = measure.content > 0 ? measure.content : measure.limit;
  return Math.max(DETAIL_MIN_HEIGHT, Math.min(measure.limit, cap, DETAIL_MIN_HEIGHT + gain));
}

function slopeFor(spare: number, room: number, gain: number): number {
  if (spare <= 0 || room <= 0 || gain <= 0) return 0.05;
  if (gain >= room - 0.5) return 4;
  const ratio = Math.min(0.995, gain / room);
  const slope = -(room / spare) * Math.log(1 - ratio);
  return Math.min(4, Math.max(0.05, slope));
}

function applyInfoHeight(info: HTMLElement, height: number) {
  const px = `${Math.round(height)}px`;
  if (info.style.height === px) return;
  info.style.flex = '0 0 auto';
  info.style.height = px;
  info.style.maxHeight = px;
  info.style.minHeight = `${DETAIL_MIN_HEIGHT}px`;
}

function sidebarAuthor(commit: CommitNode, activeProfile?: { gitName: string; gitEmail: string }): { name: string; email: string } {
  if (commit.isStash || commit.isWorkingTree) {
    return { name: activeProfile?.gitName ?? l10n.t('You'), email: activeProfile?.gitEmail ?? '' };
  }
  return { name: commit.authorName, email: commit.authorEmail };
}

/* ─── Main component ──────────────────────────────────────────────────────── */

export function CommitDetail({ commit, fullMessage, selection, onSelectionModeChange, files, selectedFile, loadingFiles, repoColor, repoColors, repos, iconTheme, onSelectFile, onClose, refColors, activeProfile, hideExtendedDetailButton, twoColumnLayout, pathFilter }: Props) {
  // Most of the pane is about one commit; a selection only reuses the file list
  const range = !!selection;
  // Same id/rule as CommitList.tsx's injection — that component isn't always mounted alongside
  // this one (e.g. the standalone "Full Detail" panel), so this component injects its own copy
  // of the [data-top-action-btn] hover rule its own toolbar buttons rely on. The shared id makes
  // this a no-op when CommitList.tsx already injected it.
  useEffect(() => {
    const id = 'gitcharm-log-action-btn-hover';
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id;
    s.textContent = `[data-log-action-btn]:hover { background: var(--vscode-toolbar-hoverBackground) !important; opacity: 1 !important; }
[data-top-action-btn]:hover { background: var(--vscode-toolbar-hoverBackground) !important; opacity: 1 !important; }
[data-ctx-item]:hover { background: var(--vscode-menu-selectionBackground) !important; color: var(--vscode-menu-selectionForeground) !important; }`;
    document.head.appendChild(s);
  }, []);

  const [viewMode, setViewMode] = useState<'tree' | 'flat'>('tree');
  const [allExpanded, setAllExpanded] = useState<boolean | null>(null);
  // Per-directory overrides on top of the Expand All/Collapse All default — cleared whenever
  // that default changes (including switching view mode, which resets allExpanded to null).
  const [dirOverrides, setDirOverrides] = useState<Set<string>>(new Set());
  const isDirOpen = (dirPath: string) => {
    const defaultOpen = allExpanded ?? true;
    return dirOverrides.has(dirPath) ? !defaultOpen : defaultOpen;
  };
  const toggleDir = (dirPath: string) => {
    setDirOverrides(prev => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath); else next.add(dirPath);
      return next;
    });
  };
  const applyAllExpanded = (value: boolean | null) => {
    setAllExpanded(value);
    setDirOverrides(new Set());
  };
  const [mergeCommits, setMergeCommits] = useState<MergeParentCommit[]>([]);
  const [loadingMerge, setLoadingMerge] = useState(false);
  // Expanding a merged-commit row only shows its files inline (like the PR detail's
  // commit list) — it never affects the file list/context-menu in the right sidebar,
  // which always stays on the commit this panel is showing.
  const [expandedMergeHash, setExpandedMergeHash] = useState<string | null>(null);
  const [mergeCommitFiles, setMergeCommitFiles] = useState<Record<string, Array<{ path: string; status: string; added?: number; removed?: number; oldPath?: string }>>>({});
  const [mergeCommitFilesLoading, setMergeCommitFilesLoading] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setMergeCommitFiles({});
    setMergeCommitFilesLoading({});
    setExpandedMergeHash(null);
  }, [commit?.hash, pathFilter?.path, pathFilter?.follow]);
  const pendingRef = useRef<Map<string, (msg: HostToLogMsg) => void>>(new Map());
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; file: FileEntry } | null>(null);
  const [dirMenu, setDirMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const [refsExpanded, setRefsExpanded] = useState(false);
  const [descendantBranches, setDescendantBranches] = useState<{ local: string[]; remote: string[]; tags: string[] }>({ local: [], remote: [], tags: [] });
  const [loadingDescendants, setLoadingDescendants] = useState(false);
  const [descendantsExpanded, setDescendantsExpanded] = useState(false);
  // Repo groups of a multi-repo selection's file list the user folded away
  const [collapsedRepoGroups, setCollapsedRepoGroups] = useState<Set<string>>(new Set());
  const toggleRepoGroup = (repoId: string) => {
    setCollapsedRepoGroups(prev => {
      const next = new Set(prev);
      if (next.has(repoId)) next.delete(repoId); else next.add(repoId);
      return next;
    });
  };

  // Repos of the selection, in the order their files are grouped
  const selectionRepoIds = useMemo(
    () => selection ? [...new Set(selection.commits.map(c => c.repoId))] : [],
    [selection],
  );
  const multiRepoSelection = selectionRepoIds.length > 1;
  const repoName = useMemo(() => {
    if (!commit || multiRepoSelection) return null;
    return repos.find(r => r.id === commit.repoId)?.name ?? null;
  }, [commit, multiRepoSelection, repos]);
  // A repo color only helps tell repos apart — with a single repo in the workspace
  // there's nothing to distinguish it from, so the name stays in the plain foreground color.
  const effectiveRepoColor = repos.length > 1 ? repoColor : undefined;

  // A stash entry has 2-3 parents (base + index + untracked commits) but is never a
  // real merge — never show the Merged Commits section for one.
  const isMerge = !range && !commit?.isStash && (commit?.parents.length ?? 0) >= 2;
  // Shown only once the list has loaded — a "(0)" while loading would read as "no commits".
  const mergeCountSuffix = !loadingMerge && mergeCommits.length > 0 ? ` (${mergeCommits.length})` : '';

  // Only refs that point AT this commit — never branches that merely contain it.
  // Order: HEAD, tags, primary locals, other locals, primary remotes, other remotes.
  // Shared between the Log Panel's and Full Detail's "Branches" rendering below.
  const branchBadges = useMemo(() => {
    if (!commit) return [];
    const refGroups = groupRefs(commit.refs);
    const other = (g: RefGroup) => !g.isHead && !g.isTag;
    const pick = (f: (g: RefGroup) => boolean) => refGroups.filter(f);
    return [
      ...pick(g => g.isHead),
      ...pick(g => g.isTag),
      ...pick(g => other(g) && g.isLocal && isPrimaryBranch(g.label)),
      ...pick(g => other(g) && g.isLocal && !isPrimaryBranch(g.label)),
      ...pick(g => other(g) && !g.isLocal && isPrimaryBranch(g.label)),
      ...pick(g => other(g) && !g.isLocal && !isPrimaryBranch(g.label)),
    ];
  }, [commit]);

  const nonDetachedBranchHead = branchBadges.find(g => g.isHead && !g.isDetached && !g.isRemoteHead);

  function renderBranchBadge(g: RefGroup) {
    const isSpecialHead = g.isRemoteHead || (g.isHead && g.isDetached);
    const rid = commit!.repoId;
    const remoteRefKey = g.remoteName ? `${rid}:${g.remoteName}/${g.label}` : null;
    const resolvedRefColor = (remoteRefKey ? refColors?.get(remoteRefKey) : undefined) ?? refColors?.get(`${rid}:${g.label}`);
    const color = g.isTag ? tagColor() : isSpecialHead ? headColor() : (resolvedRefColor ?? branchColor(g.label, false));
    const label = g.isRemoteHead ? `${g.remoteName}/HEAD` : g.isRemote ? remoteLabel(g) : g.label;
    return (
      <span key={g.key} style={styles.refBadge(color, (g.isHead || g.isDetached) && !g.isRemoteHead)} title={badgeTitle(g)}>
        <RefBadgeIcon group={g} />
        {label}
      </span>
    );
  }

  // A stash's refs: its relative name first (the same badge as its row in the log), then the
  // branch it was made on
  function stashBadges() {
    if (!commit?.isStash) return null;
    const refColor = (commit as CommitNode & { dotColor?: string }).dotColor ?? tagColor();
    return (
      <>
        {commit.stashRef && (
          <span style={styles.refBadge(refColor)} title={commit.stashRef}>
            <Codicon name="git-stash" style={{ fontSize: '11px', flexShrink: 0, lineHeight: 1 }} />
            {commit.stashRef}
          </span>
        )}
        {commit.stashBranch && (
          <span style={styles.refBadge(branchColor(commit.stashBranch, false))}>
            <Codicon name="git-branch" style={{ fontSize: '11px', flexShrink: 0, lineHeight: 1 }} />
            {commit.stashBranch}
          </span>
        )}
      </>
    );
  }

  useEffect(() => {
    const handler = (event: MessageEvent<HostToLogMsg>) => {
      const msg = event.data;
      if (!msg?.type) return;
      if ('requestId' in msg && msg.requestId && pendingRef.current.has(msg.requestId as string)) {
        const resolve = pendingRef.current.get(msg.requestId as string)!;
        pendingRef.current.delete(msg.requestId as string);
        resolve(msg);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  useEffect(() => { setRefsExpanded(false); }, [commit?.hash, range]);

  // Descendant branches/tags — those that contain this commit without pointing at it
  // directly — are fetched separately from the exact-match refs shown as badges above,
  // so a lazy `git branch --contains` scan never blocks or clutters the primary view.
  // Full Detail only — the Log Panel's compact commit detail hides this section entirely.
  useEffect(() => {
    setDescendantsExpanded(false);
    if (!twoColumnLayout || range || !commit || commit.isStash) { setDescendantBranches({ local: [], remote: [], tags: [] }); setLoadingDescendants(false); return; }
    setLoadingDescendants(true);
    const reqId = generateId();
    pendingRef.current.set(reqId, (msg) => {
      if (msg.type === 'LOG_COMMIT_BRANCHES_RESULT') {
        setDescendantBranches(msg.branches);
        setLoadingDescendants(false);
      }
    });
    getVsCodeApi().postMessage({
      type: 'LOG_REQUEST_COMMIT_BRANCHES',
      requestId: reqId,
      repoId: commit.repoId,
      hash: commit.hash,
    } satisfies LogToHostMsg);
  }, [commit?.hash, range, twoColumnLayout]);

  useEffect(() => {
    setExpandedMergeHash(null);
    setMergeCommitFiles({});
    setMergeCommitFilesLoading({});
    if (range || !commit || !isMerge || commit.isStash) { setMergeCommits([]); return; }
    setLoadingMerge(true);
    const reqId = generateId();
    pendingRef.current.set(reqId, (msg) => {
      if (msg.type === 'LOG_MERGE_COMMITS_RESULT') {
        setMergeCommits(msg.commits);
        setLoadingMerge(false);
      }
    });
    getVsCodeApi().postMessage({
      type: 'LOG_REQUEST_MERGE_COMMITS',
      requestId: reqId,
      repoId: commit.repoId,
      hash: commit.hash,
      parents: commit.parents,
    } satisfies LogToHostMsg);
  }, [commit?.hash, range]);

  function openVscodeDiff(file: FileEntry, hash?: string, combined?: boolean) {
    onSelectFile(file);
    if (selection) {
      const repoId = file.repoId ?? commit?.repoId;
      if (!repoId) return;
      getVsCodeApi().postMessage({
        type: 'LOG_OPEN_RANGE_FILE_DIFF',
        repoId,
        hashes: selection.commits.filter(c => c.repoId === repoId).map(commitRevision),
        filePath: file.path,
        fileStatus: file.status,
        oldPath: file.oldPath,
        baseRef: file.baseRef,
        headRef: file.headRef,
      } satisfies LogToHostMsg);
      return;
    }
    if (!commit) return;
    if (commit.isWorkingTree) {
      getVsCodeApi().postMessage({
        type: 'LOG_OPEN_WORKING_TREE_FILE_DIFF',
        repoId: commit.repoId,
        filePath: file.path,
        fileStatus: file.status,
        oldPath: file.oldPath,
      } satisfies LogToHostMsg);
      return;
    }
    getVsCodeApi().postMessage({
      type: 'LOG_OPEN_FILE_DIFF',
      repoId: commit.repoId,
      hash: hash ?? commit.hash,
      filePath: file.path,
      fileStatus: file.status,
      oldPath: file.oldPath,
      parents: commit.parents,
      combined,
    } as LogToHostMsg);
  }

  const handleCtxShowDiff = useCallback(() => {
    if (!ctxMenu || !commit) return;
    openVscodeDiff(ctxMenu.file);
    setCtxMenu(null);
  }, [ctxMenu, commit]);

  const handleCtxShowCombinedDiff = useCallback(() => {
    if (!ctxMenu || !commit) return;
    openVscodeDiff(ctxMenu.file, undefined, true);
    setCtxMenu(null);
  }, [ctxMenu, commit]);

  const handleCtxEditSource = useCallback(() => {
    if (!ctxMenu || !commit) return;
    getVsCodeApi().postMessage({ type: 'LOG_OPEN_FILE', repoId: commit.repoId, filePath: ctxMenu.file.path } as LogToHostMsg);
    setCtxMenu(null);
  }, [ctxMenu, commit]);

  const handleCtxRevertFile = useCallback(() => {
    if (!ctxMenu || !commit || commit.isStash) return;
    const reqId = generateId();
    getVsCodeApi().postMessage({
      type: 'LOG_REVERT_FILE',
      requestId: reqId,
      repoId: commit.repoId,
      hash: commit.hash,
      filePath: ctxMenu.file.path,
      fileStatus: ctxMenu.file.status,
    } as LogToHostMsg);
    setCtxMenu(null);
  }, [ctxMenu, commit]);

  const handleCtxCherryPickFile = useCallback(() => {
    if (!ctxMenu || !commit || commit.isStash) return;
    const reqId = generateId();
    getVsCodeApi().postMessage({
      type: 'LOG_CHERRY_PICK_FILE',
      requestId: reqId,
      repoId: commit.repoId,
      hash: commit.hash,
      filePath: ctxMenu.file.path,
      oldPath: ctxMenu.file.oldPath,
    } as LogToHostMsg);
    setCtxMenu(null);
  }, [ctxMenu, commit]);

  const handleCtxRevealExplorer = useCallback(() => {
    if (!ctxMenu || !commit) return;
    getVsCodeApi().postMessage({ type: 'LOG_REVEAL_IN_EXPLORER', repoId: commit.repoId, filePath: ctxMenu.file.path } as LogToHostMsg);
    setCtxMenu(null);
  }, [ctxMenu, commit]);

  const handleCtxRevealOS = useCallback(() => {
    if (!ctxMenu || !commit) return;
    getVsCodeApi().postMessage({ type: 'LOG_REVEAL_IN_OS', repoId: commit.repoId, filePath: ctxMenu.file.path } as LogToHostMsg);
    setCtxMenu(null);
  }, [ctxMenu, commit]);

  const handleCtxFileHistory = useCallback(() => {
    if (!ctxMenu || !commit) return;
    getVsCodeApi().postMessage({ type: 'LOG_SHOW_FILE_HISTORY', repoId: commit.repoId, filePath: ctxMenu.file.path } as LogToHostMsg);
    setCtxMenu(null);
  }, [ctxMenu, commit]);

  const handleCtxCompareWith = useCallback(() => {
    if (!ctxMenu || !commit) return;
    getVsCodeApi().postMessage({
      type: 'LOG_COMPARE_FILE_WITH',
      repoId: commit.repoId,
      hash: commit.hash,
      filePath: ctxMenu.file.path,
    } as LogToHostMsg);
    setCtxMenu(null);
  }, [ctxMenu, commit]);

  function toggleMergeCommit(c: MergeParentCommit) {
    if (expandedMergeHash === c.hash) {
      setExpandedMergeHash(null);
      return;
    }
    setExpandedMergeHash(c.hash);
    if (mergeCommitFiles[c.hash]) return;
    setMergeCommitFilesLoading(s => ({ ...s, [c.hash]: true }));
    const reqId = generateId();
    pendingRef.current.set(reqId, (msg) => {
      if (msg.type === 'LOG_COMMIT_FILES') {
        setMergeCommitFiles(s => ({ ...s, [c.hash]: msg.files }));
        setMergeCommitFilesLoading(s => ({ ...s, [c.hash]: false }));
      }
    });
    getVsCodeApi().postMessage({
      type: 'LOG_REQUEST_COMMIT_FILES',
      requestId: reqId,
      repoId: commit!.repoId,
      hash: c.hash,
      ...(pathFilter?.path ? { filterPath: pathFilter.path, ...(pathFilter.follow ? { filterFollow: true } : {}) } : {}),
    } satisfies LogToHostMsg);
  }

  const detailRootRef = useRef<HTMLDivElement | null>(null);
  const detailPaneRef = useRef<HTMLDivElement | null>(null);
  const detailContentRef = useRef<HTMLDivElement | null>(null);
  const detailSlopeRef = useRef(readDetailSlope());
  const detailDragRef = useRef(false);
  // Same pane size and message height already produced this log height. Applying it again
  // feeds the resize observer and the log pane shakes while the panel is dragged.
  const detailLayoutKeyRef = useRef('');

  const layoutDetailSplit = useCallback(() => {
    if (twoColumnLayout || detailDragRef.current) return;
    const root = detailRootRef.current;
    const info = detailPaneRef.current;
    if (!root || !info) return;
    const measure = measureDetailSplit(root, info, detailContentRef.current);
    const key = `${Math.round(root.clientWidth)}x${Math.round(root.clientHeight)}:${measure.content}`;
    if (key === detailLayoutKeyRef.current) return;
    const next = heightFromSlope(measure, detailSlopeRef.current);
    detailLayoutKeyRef.current = key;
    applyInfoHeight(info, next);
  }, [twoColumnLayout]);

  useLayoutEffect(() => {
    detailLayoutKeyRef.current = '';
    layoutDetailSplit();
  }, [layoutDetailSplit, commit, fullMessage, selection]);

  const hasCommit = !!commit;
  useEffect(() => {
    const root = detailRootRef.current;
    if (!root || twoColumnLayout) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => layoutDetailSplit());
    });
    observer.observe(root);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [layoutDetailSplit, twoColumnLayout, hasCommit]);

  const onDetailInfoResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const info = detailPaneRef.current;
    const root = detailRootRef.current;
    if (!info || !root) return;
    detailDragRef.current = true;
    const startY = e.clientY;
    const startH = info.offsetHeight;

    const onMove = (ev: MouseEvent) => {
      const measure = measureDetailSplit(root, info, detailContentRef.current);
      const next = Math.max(DETAIL_MIN_HEIGHT, Math.min(measure.limit, measure.content || measure.limit, startH + (startY - ev.clientY)));
      applyInfoHeight(info, next);
      detailSlopeRef.current = slopeFor(measure.spare, measure.room, Math.max(0, next - DETAIL_MIN_HEIGHT));
    };
    const onUp = () => {
      detailDragRef.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      writeDetailSlope(detailSlopeRef.current);
      detailLayoutKeyRef.current = '';
      layoutDetailSplit();
    };

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [layoutDetailSplit]);

  if (!commit) {
    return (
      <div style={styles.empty}>
        <span style={styles.emptyText}>{l10n.t('Select a commit to view details')}</span>
      </div>
    );
  }

  const combined = selection?.mode === 'combined';

  const activeFiles = files;
  const activeLoading = loadingFiles;
  const activeHash = commit?.hash;

  // `dirPrefix` keeps apart the expanded folders of each repo of a selection
  const renderFileTree = (treeFiles: FileEntry[], dirPrefix: string) => (
    <GenericFileTree<FileEntry>
      files={treeFiles}
      viewMode={viewMode}
      compact
      basePad={dirPrefix ? REPO_GROUP_BASE_PAD : undefined}
      iconTheme={iconTheme}
      statusColor={statusColor}
      statusLetter={f => f}
      isDirOpen={dir => isDirOpen(dirPrefix + dir)}
      toggleDir={dir => toggleDir(dirPrefix + dir)}
      isFileSelected={f => selectedFile?.path === f.path && (!f.repoId || !selectedFile.repoId || selectedFile.repoId === f.repoId)}
      isFileContextActive={f => ctxMenu?.file.path === f.path}
      onOpenFile={f => openVscodeDiff(f, activeHash)}
      onContextMenuFile={range ? undefined : (e, f) => { setDirMenu(null); setCtxMenu({ x: e.clientX, y: e.clientY, file: f }); }}
      onContextMenuDir={range ? undefined : (e, dirPath) => { setCtxMenu(null); setDirMenu({ x: e.clientX, y: e.clientY, path: dirPath }); }}
    />
  );

  return (
    <div
      ref={twoColumnLayout ? undefined : detailRootRef}
      className={twoColumnLayout ? 'commit-detail-two-column' : undefined}
      style={twoColumnLayout ? styles.containerTwoColumn : styles.container}
      onContextMenu={e => e.preventDefault()}
    >
      {/* Commit header */}
      <div
        ref={twoColumnLayout ? undefined : detailPaneRef}
        className={twoColumnLayout ? 'commit-detail-two-column-header' : undefined}
        style={twoColumnLayout ? styles.headerTwoColumn : { ...styles.header, ...styles.sidebarDetails }}
      >
        <div ref={twoColumnLayout ? undefined : detailContentRef} style={twoColumnLayout ? styles.detailContentPassthrough : styles.detailContent}>
        {selection ? (
          <>
            {twoColumnLayout && repoName && (
              <div style={styles.repoRow}>
                <Codicon name="repo" style={styles.repoIcon} />
                <span style={styles.repoName(effectiveRepoColor)}>{repoName}</span>
              </div>
            )}
            {twoColumnLayout && (
              <div style={styles.rangeTitle}>
                <span>{combined ? l10n.t('Combined changes') : l10n.t('Compare commits')}</span>
              </div>
            )}
            {combined ? (
              <>
                {twoColumnLayout && (
                  <div style={styles.rangeHint}>
                    {multiRepoSelection
                      ? l10n.t('Changes introduced by {0} commits in {1} repositories', selection.commits.length, selectionRepoIds.length)
                      : l10n.t('Changes introduced by {0} commits', selection.commits.length)}
                  </div>
                )}
                <div style={styles.selectionList}>
                  {[...selection.commits].reverse().map(c => (
                    <OpenDetailRow key={`${c.repoId}:${c.hash}`} repoId={c.repoId} hash={c.hash} style={styles.selectionRow}>
                      {multiRepoSelection && <span style={styles.selectionRepoDot(repoColors?.[c.repoId])} />}
                      <span style={styles.hash}>{c.isStash ? (c.stashRef ?? c.shortHash) : c.shortHash}</span>
                      <span style={styles.selectionMessage}>{c.message}</span>
                    </OpenDetailRow>
                  ))}
                </div>
              </>
            ) : (
              <>
                {twoColumnLayout && <div style={styles.rangeHint}>{l10n.t('Changes between the selected snapshots')}</div>}
                <div style={styles.hashRow}>
                  <span style={styles.hash}>{selection.commits[0].shortHash}</span>
                  <Codicon name="arrow-right" style={{ fontSize: '11px', opacity: 0.6 }} />
                  <span style={styles.hash}>{selection.commits[selection.commits.length - 1].shortHash}</span>
                </div>
              </>
            )}
          </>
        ) : (
          <>
        {!twoColumnLayout && (() => {
          const author = sidebarAuthor(commit, activeProfile);
          const hash = commit.isWorkingTree ? '' : (commit.isStash ? (commit.stashRef ?? commit.shortHash) : commit.shortHash);
          return (
            <div>
              <div style={{ ...styles.summaryMessage, color: primaryBranchColor(), ...(commit.isWorkingTree ? { fontStyle: 'italic' as const } : {}) }}>
                {commit.isWorkingTree ? l10n.t('Uncommitted Changes') : (fullMessage || commit.message)}
              </div>
              <div style={styles.summaryMeta}>
                {hash && <span style={styles.summaryHash}>{hash}</span>}
                {l10n.t('Author')} {author.name}{author.email ? ` <${author.email}>` : ''}, {formatDateTime(commit.authorDate)}
              </div>
            </div>
          );
        })()}
        {!twoColumnLayout && commit.isWorkingTree && (
          <div style={styles.refsRow}>
            {commit.workingTreeBranch ? (
              <span style={styles.refBadge(refColors?.get(`${commit.repoId}:${commit.workingTreeBranch}`) ?? branchColor(commit.workingTreeBranch, false))} title={l10n.t('Local: {0}', commit.workingTreeBranch)}>
                <Codicon name="git-branch" style={{ fontSize: '11px', flexShrink: 0, lineHeight: 1 }} />
                {commit.workingTreeBranch}
              </span>
            ) : (
              <span style={styles.refBadge(headColor(), true)}>
                <Codicon name="warning" style={{ fontSize: '11px', flexShrink: 0, lineHeight: 1 }} />
                {l10n.t('HEAD (detached)')}
              </span>
            )}
          </div>
        )}
        {!twoColumnLayout && commit.isStash && (
          <div style={styles.refsRow}>{stashBadges()}</div>
        )}
        {twoColumnLayout && commit.isWorkingTree ? (
          <div>
            <div style={styles.hashRow}>
              <span style={{ ...styles.message, fontStyle: 'italic' }}>{l10n.t('Uncommitted Changes')}</span>
            </div>
            <div style={styles.authorRow}>
              <AuthorAvatar authorName={activeProfile?.gitName ?? l10n.t('You')} authorEmail={activeProfile?.gitEmail ?? ''} size={32} isYou={!activeProfile} />
              <div style={styles.meta}>
                <span>{activeProfile?.gitName ?? l10n.t('You')}</span>
                {activeProfile?.gitEmail && (
                  <>
                    <span style={styles.dot}>·</span>
                    <span>{activeProfile.gitEmail}</span>
                  </>
                )}
                <span style={styles.dot}>·</span>
                <span>{formatDateTime(commit.authorDate)}</span>
              </div>
            </div>
            <div style={styles.refsRow}>
              {commit.workingTreeBranch ? (
                <span style={styles.refBadge(refColors?.get(`${commit.repoId}:${commit.workingTreeBranch}`) ?? branchColor(commit.workingTreeBranch, false))} title={l10n.t('Local: {0}', commit.workingTreeBranch)}>
                  <Codicon name="git-branch" style={{ fontSize: '11px', flexShrink: 0, lineHeight: 1 }} />
                  {commit.workingTreeBranch}
                </span>
              ) : (
                <span style={styles.refBadge(headColor(), true)}>
                  <Codicon name="warning" style={{ fontSize: '11px', flexShrink: 0, lineHeight: 1 }} />
                  {l10n.t('HEAD (detached)')}
                </span>
              )}
            </div>
          </div>
        ) : twoColumnLayout && commit.isStash ? (
          <div>
            <div style={styles.detailsLabel}>{l10n.t('Author')}</div>
            <div style={styles.authorRowTwoColumn}>
              <AuthorAvatar authorName={activeProfile?.gitName ?? l10n.t('You')} authorEmail={activeProfile?.gitEmail ?? ''} size={32} isYou={!activeProfile} />
              <div style={styles.authorMeta}>
                <span style={styles.authorName}>{activeProfile?.gitName ?? l10n.t('You')}</span>
                {activeProfile?.gitEmail && <span style={styles.authorEmail}>{activeProfile.gitEmail}</span>}
              </div>
            </div>
          </div>
        ) : twoColumnLayout ? (
          <div>
            <div style={styles.detailsLabel}>{l10n.t('Author')}</div>
            <div style={styles.authorRowTwoColumn}>
              <AuthorAvatar authorName={commit.authorName} authorEmail={commit.authorEmail} size={32} repoId={commit.repoId} sha={forgeSha(commit)} />
              <div style={styles.authorMeta}>
                <span style={styles.authorName}>{commit.authorName}</span>
                <span style={styles.authorEmail}>{commit.authorEmail}</span>
              </div>
            </div>
          </div>
        ) : null}
        {twoColumnLayout && (
          <div>
            <div style={styles.detailsLabel}>{l10n.t('Details')}</div>
            <div style={styles.detailsGrid}>
              <span style={styles.detailsKey}>{l10n.t('Hash')}</span>
              <span style={styles.detailsVal}>{commit.isStash ? (commit.stashHash ?? commit.hash) : commit.hash}</span>
              <span style={styles.detailsKey}>{l10n.t('Author date')}</span>
              <span style={styles.detailsValNormal}>{formatDateTime(commit.authorDate)}</span>
              <span style={styles.detailsKey}>{l10n.t('Commit date')}</span>
              <span style={styles.detailsValNormal}>{formatDateTime(commit.committerDate)}</span>
              {repoName && (
                <>
                  <span style={styles.detailsKey}>{l10n.t('Repository')}</span>
                  <span style={styles.detailsValNormal}>{repoName}</span>
                </>
              )}
            </div>
          </div>
        )}
        {twoColumnLayout && (commit.isStash || branchBadges.length > 0) && (() => {
          if (commit.isStash) {
            return (
              <div>
                <div style={styles.detailsLabel}>{l10n.t('Branches')}</div>
                <div style={styles.refsRow}>{stashBadges()}</div>
              </div>
            );
          }
          const LIMIT = 5;
          const visible = refsExpanded ? branchBadges : branchBadges.slice(0, LIMIT);
          const hiddenCount = branchBadges.length - LIMIT;
          return (
            <div>
              <div style={styles.detailsLabel}>{l10n.t('Branches')}</div>
              <div style={refsExpanded ? styles.refsRowExpanded : styles.refsRow}>
                {nonDetachedBranchHead && (
                  <span style={styles.refBadge(headColor(), true)} title={`HEAD → ${nonDetachedBranchHead.label}`}>
                    <Codicon name="arrow-right" style={{ fontSize: '9px', flexShrink: 0, lineHeight: 1 }} />
                    HEAD
                  </span>
                )}
                {visible.map(renderBranchBadge)}
                {!refsExpanded && hiddenCount > 0 && (
                  <span
                    style={styles.refsShowMore}
                    onClick={() => setRefsExpanded(true)}
                    title={l10n.t('Show {0} more', hiddenCount)}
                  >
                    {l10n.t('+{0} more', hiddenCount)}
                  </span>
                )}
                {refsExpanded && branchBadges.length > LIMIT && (
                  <span
                    style={{ ...styles.refsShowMore, width: '100%', marginTop: '2px' }}
                    onClick={() => setRefsExpanded(false)}
                  >
                    {l10n.t('Show less')}
                  </span>
                )}
              </div>
            </div>
          );
        })()}

        {twoColumnLayout && !commit.isStash && (() => {
          const total = descendantBranches.local.length + descendantBranches.remote.length + descendantBranches.tags.length;
          if (!loadingDescendants && total === 0) return null;
          const DLIMIT = 8;
          type DescBadge = { kind: 'local' | 'remote' | 'tag'; name: string };
          const allDescBadges: DescBadge[] = [
            ...descendantBranches.local.map(name => ({ kind: 'local' as const, name })),
            ...descendantBranches.remote.map(name => ({ kind: 'remote' as const, name })),
            ...descendantBranches.tags.map(name => ({ kind: 'tag' as const, name })),
          ];
          const visibleDesc = descendantsExpanded ? allDescBadges : allDescBadges.slice(0, DLIMIT);
          const hiddenDescCount = allDescBadges.length - DLIMIT;
          return (
            <div>
              <div style={styles.detailsLabel}>{l10n.t('Descendant Branches')}</div>
              {loadingDescendants && <div style={styles.mergeLoading}>{l10n.t('Loading...')}</div>}
              {!loadingDescendants && (
                <div style={styles.refsRow}>
                  {visibleDesc.map(b => (
                    <span
                      key={`${b.kind}:${b.name}`}
                      style={styles.refBadge(b.kind === 'tag' ? tagColor() : branchColor(b.name, false), false)}
                      title={l10n.t('{0} contains this commit', b.name)}
                    >
                      <Codicon
                        name={b.kind === 'tag' ? 'tag' : b.kind === 'remote' ? 'cloud' : 'git-branch'}
                        style={{ fontSize: '11px', flexShrink: 0, lineHeight: 1 }}
                      />
                      {b.name}
                    </span>
                  ))}
                  {!descendantsExpanded && hiddenDescCount > 0 && (
                    <span
                      style={styles.refsShowMore}
                      onClick={() => setDescendantsExpanded(true)}
                      title={l10n.t('Show {0} more', hiddenDescCount)}
                    >
                      {l10n.t('+{0} more', hiddenDescCount)}
                    </span>
                  )}
                  {descendantsExpanded && allDescBadges.length > DLIMIT && (
                    <span
                      style={{ ...styles.refsShowMore, width: '100%', marginTop: '2px' }}
                      onClick={() => setDescendantsExpanded(false)}
                    >
                      {l10n.t('Show less')}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {twoColumnLayout && (
          <div>
            <div style={styles.detailsLabel}>{l10n.t('Commit message')}</div>
            <pre style={styles.commitMessageBlock}>{fullMessage || commit.message}</pre>
          </div>
        )}

        {/* Merged commits section — a minimal hash+message list in the Log Panel,
            an expanded one with author/date/stats in Full Detail. */}
        {twoColumnLayout && isMerge && (
          <div style={twoColumnLayout ? undefined : styles.mergeSection}>
            {twoColumnLayout ? (
              <div style={styles.detailsLabel}>{l10n.t('Merged Commits')}{mergeCountSuffix}</div>
            ) : (
              <div style={styles.mergeSectionTitle}>
                <Codicon name="git-merge" style={{ fontSize: '11px', opacity: 0.7 }} />
                <span>{l10n.t('Merged commits')}{mergeCountSuffix}</span>
              </div>
            )}
            {loadingMerge && <div style={styles.mergeLoading}>{l10n.t('Loading...')}</div>}
            {!loadingMerge && mergeCommits.length === 0 && (
              <div style={styles.mergeLoading}>{l10n.t('No commits found')}</div>
            )}
            {!loadingMerge && !twoColumnLayout && mergeCommits.length > 0 && (
              <div style={styles.mergeCommitsListMinimal}>
                {mergeCommits.map(c => (
                  <OpenDetailRow key={c.hash} repoId={commit.repoId} hash={c.hash} style={styles.mergeCommitRowMinimal}>
                    <span style={styles.mergeHash}>{c.shortHash}</span>
                    <span style={styles.mergeMessage}>{c.message}</span>
                  </OpenDetailRow>
                ))}
              </div>
            )}
            {!loadingMerge && twoColumnLayout && mergeCommits.length > 0 && (
              // Same bordered-list container as the Pull Request detail's commit list.
              <div style={styles.mergeCommitsList}>
                {mergeCommits.map((c, i) => (
                  <CommitRow
                    key={c.hash}
                    commit={{
                      hash: c.hash, shortHash: c.shortHash, message: c.message,
                      authorName: c.authorName, authorEmail: c.authorEmail, authoredAt: c.authorDate,
                      filesChanged: c.filesChanged, additions: c.additions, deletions: c.deletions,
                    }}
                    expanded={expandedMergeHash === c.hash}
                    isLast={i === mergeCommits.length - 1}
                    onToggle={() => toggleMergeCommit(c)}
                    renderFiles={() => {
                      const loadedFiles = mergeCommitFiles[c.hash] ?? [];
                      const rawFiles = pathFilter?.path && !pathFilter.follow
                        ? loadedFiles.filter(file => fileMatchesPath(pathFilter.path, false, file))
                        : loadedFiles;
                      return mergeCommitFilesLoading[c.hash] ? (
                        <div style={styles.mergeLoading}>{l10n.t('Loading files...')}</div>
                      ) : (
                        <FileTreeView
                          files={rawFiles.map(toChangedFile)}
                          iconTheme={iconTheme ?? null}
                          onOpenFile={changed => {
                            const original = rawFiles.find(f => f.path === changed.path);
                            if (original) openVscodeDiff(original, c.hash);
                          }}
                        />
                      );
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        </>
        )}
        </div>
      </div>

      {!twoColumnLayout && <ResizeHandle axis="y" onMouseDown={onDetailInfoResize} style={{ order: 2 }} />}

      {onSelectionModeChange && (
        <div style={twoColumnLayout ? styles.modeTabs : { ...styles.modeTabs, order: 0 }} role="tablist">
          <button type="button" role="tab" aria-selected={combined} style={styles.modeTab(combined)} onClick={() => onSelectionModeChange('combined')}>
            {l10n.t('Combined')}
          </button>
          <button type="button" role="tab" aria-selected={!combined} style={styles.modeTab(!combined)} onClick={() => onSelectionModeChange('snapshot')}>
            {l10n.t('Snapshots')}
          </button>
        </div>
      )}

      <div
        className={twoColumnLayout ? 'commit-detail-two-column-right' : undefined}
        style={twoColumnLayout ? styles.rightColumn : styles.treePane}
      >
      {/* File list toolbar. One row: the count, then view controls, then the pane actions. */}
      <div style={styles.fileListToolbar}>
        <span style={styles.fileCount}>{plural(activeFiles.length, l10n.t('1 file'), l10n.t('{0} files', activeFiles.length))}</span>
        <div style={styles.toolbarGroup}>
          {viewMode === 'tree' && (
            <>
              <button
                data-top-action-btn=""
                style={styles.toggleBtn(false)}
                onClick={() => applyAllExpanded(true)}
                title={l10n.t('Expand all')}
              >
                <Codicon name="expand-all" style={styles.toolbarIcon} />
              </button>
              <button
                data-top-action-btn=""
                style={styles.toggleBtn(false)}
                onClick={() => applyAllExpanded(false)}
                title={l10n.t('Collapse all')}
              >
                <Codicon name="collapse-all" style={styles.toolbarIcon} />
              </button>
              <span style={styles.toolbarDivider} />
            </>
          )}
          <button
            data-top-action-btn=""
            style={styles.toggleBtn(viewMode === 'tree')}
            onClick={() => { setViewMode('tree'); applyAllExpanded(null); }}
            title={l10n.t('Tree view')}
          >
            <Codicon name="list-tree" style={styles.toolbarIcon} />
          </button>
          <button
            data-top-action-btn=""
            style={styles.toggleBtn(viewMode === 'flat')}
            onClick={() => { setViewMode('flat'); applyAllExpanded(null); }}
            title={l10n.t('Flat view')}
          >
            <Codicon name="list-flat" style={styles.toolbarIcon} />
          </button>
          {!twoColumnLayout && ((!range && !hideExtendedDetailButton && !commit.isWorkingTree) || onClose) && (
            <span style={styles.toolbarDivider} />
          )}
          {!twoColumnLayout && !range && !hideExtendedDetailButton && !commit.isWorkingTree && (
            <button
              data-top-action-btn=""
              style={styles.toggleBtn(false)}
              title={l10n.t('Open extended commit detail')}
              onClick={() => getVsCodeApi().postMessage({ type: 'LOG_OPEN_EXTENDED_DETAIL', repoId: commit.repoId, hash: commit.hash } satisfies LogToHostMsg)}
            >
              <Codicon name="open-in-product" style={styles.toolbarIcon} />
            </button>
          )}
          {!twoColumnLayout && onClose && (
            <button data-top-action-btn="" style={styles.toggleBtn(false)} title={l10n.t('Close commit detail')} onClick={onClose}>
              <Codicon name="right-panel-hide" style={styles.toolbarIcon} />
            </button>
          )}
        </div>
      </div>

      {/* File context menu */}
      {ctxMenu && commit && !range && (
        <FileContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          file={ctxMenu.file}
          onShowDiff={handleCtxShowDiff}
          onShowCombinedDiff={handleCtxShowCombinedDiff}
          onFileHistory={handleCtxFileHistory}
          onCompareWith={handleCtxCompareWith}
          onEditSource={handleCtxEditSource}
          onCherryPickFile={handleCtxCherryPickFile}
          onRevertFile={handleCtxRevertFile}
          onRevealExplorer={handleCtxRevealExplorer}
          onRevealOS={handleCtxRevealOS}
          canApplyCommitChanges={!commit.isStash && !commit.isWorkingTree}
          isWorkingTree={commit.isWorkingTree}
          onClose={() => setCtxMenu(null)}
        />
      )}
      {dirMenu && commit && !range && (
        <DirHistoryMenu
          x={dirMenu.x}
          y={dirMenu.y}
          onShowHistory={() => getVsCodeApi().postMessage({
            type: 'LOG_SHOW_FILE_HISTORY',
            repoId: commit.repoId,
            filePath: dirMenu.path,
            directory: true,
          } satisfies LogToHostMsg)}
          onClose={() => setDirMenu(null)}
        />
      )}

      {/* File list */}
      <div style={styles.fileList} onKeyDown={(e) => handleTreeNavKeyDown(e, e.currentTarget)}>
        {activeLoading && <div style={styles.loading}>{l10n.t('Loading files...')}</div>}
        {!activeLoading && activeFiles.length === 0 && (
          <div style={styles.loading}>{l10n.t('No changed files')}</div>
        )}

        {!activeLoading && activeFiles.length > 0 && (multiRepoSelection
          ? selectionRepoIds.map(repoId => {
            const repoFiles = activeFiles.filter(f => f.repoId === repoId);
            if (repoFiles.length === 0) return null;
            const collapsed = collapsedRepoGroups.has(repoId);
            return (
              <div key={repoId}>
                <div
                  data-nav-row=""
                  tabIndex={-1}
                  style={styles.fileRepoHeader}
                  onClick={() => toggleRepoGroup(repoId)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleRepoGroup(repoId); } }}
                >
                  <Codicon name={collapsed ? 'chevron-right' : 'chevron-down'} style={styles.fileRepoChevron} />
                  <span style={styles.selectionRepoDot(repoColors?.[repoId])} />
                  <span style={styles.fileRepoName}>{repos.find(r => r.id === repoId)?.name ?? repoId}</span>
                  <span style={styles.fileRepoCount}>{plural(repoFiles.length, l10n.t('1 file'), l10n.t('{0} files', repoFiles.length))}</span>
                </div>
                {!collapsed && renderFileTree(repoFiles, `${repoId}:`)}
              </div>
            );
          })
          : renderFileTree(activeFiles, ''))}
      </div>
      </div>
    </div>
  );
}

// Files under a repo header start one level in, past its chevron
const REPO_GROUP_BASE_PAD = 22;

// Fixed row height so the minimal merged-commits list can cap at exactly N rows before scrolling.
const MERGE_MINIMAL_ROW_HEIGHT = 18;
const MERGE_MINIMAL_ROW_GAP = 2;
const MERGE_MINIMAL_VISIBLE_ROWS = 4;

const styles = {
  container: {
    position: 'relative' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    minHeight: 0,
    overflow: 'hidden',
    borderLeft: '1px solid var(--vscode-panel-border)',
    background: 'var(--vscode-sideBar-background)',
  },
  // Full-page variant (the "Open Full Detail" panel): commit header/metadata on the left,
  // file list on the right, side by side instead of stacked — there's room for two columns
  // there, unlike the narrow Log Panel sidebar this component is normally embedded in.
  containerTwoColumn: {
    position: 'relative' as const,
    display: 'flex',
    flexDirection: 'row' as const,
    height: '100%',
    background: 'var(--vscode-editor-background)',
  },
  empty: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    borderLeft: '1px solid var(--vscode-panel-border)',
  },
  emptyText: {
    fontSize: '13px',
    opacity: 0.4,
    color: 'var(--vscode-foreground)',
  },
  header: {
    padding: '10px 12px',
    borderBottom: '1px solid var(--vscode-panel-border)',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
  },
  sidebarDetails: {
    order: 3,
    flex: '0 0 auto',
    minHeight: DETAIL_MIN_HEIGHT,
    boxSizing: 'border-box' as const,
    padding: '4px 8px',
    gap: 0,
    overflowX: 'hidden' as const,
    overflowY: 'auto' as const,
    scrollbarGutter: 'stable' as const,
    borderBottom: 'none',
  } as React.CSSProperties,
  detailContent: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '2px',
  } as React.CSSProperties,
  detailContentPassthrough: {
    display: 'contents',
  } as React.CSSProperties,
  treePane: {
    order: 1,
    flex: '1 1 0%',
    minHeight: TREE_MIN_HEIGHT,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    minWidth: 0,
  } as React.CSSProperties,
  summaryMessage: {
    margin: 0,
    fontWeight: 600,
    fontSize: '13px',
    lineHeight: 1.45,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  } as React.CSSProperties,
  summaryMeta: {
    marginTop: '4px',
    fontSize: '12px',
    lineHeight: 1.45,
    opacity: 0.72,
    wordBreak: 'break-word' as const,
  } as React.CSSProperties,
  summaryHash: {
    fontFamily: 'var(--vscode-editor-font-family, monospace)',
    marginRight: '6px',
  } as React.CSSProperties,
  headerTwoColumn: {
    padding: '20px 24px',
    borderRight: '1px solid var(--vscode-panel-border)',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px',
    flex: '0 0 70%',
    minWidth: '260px',
    overflowY: 'auto' as const,
  },
  detailsLabel: {
    fontSize: '10px',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    opacity: 0.5,
    marginBottom: '6px',
  },
  detailsGrid: {
    display: 'grid',
    gridTemplateColumns: 'max-content 1fr',
    gap: '4px 14px',
    alignItems: 'start',
  } as React.CSSProperties,
  detailsKey: {
    opacity: 0.55,
    fontSize: '12px',
    whiteSpace: 'nowrap' as const,
  },
  detailsVal: {
    fontSize: '12px',
    fontFamily: 'var(--vscode-editor-font-family, monospace)',
    wordBreak: 'break-all' as const,
  },
  detailsValNormal: {
    fontSize: '12px',
    fontFamily: 'var(--vscode-font-family)',
    wordBreak: 'normal' as const,
  },
  commitMessageBlock: {
    background: 'var(--vscode-textCodeBlock-background, var(--vscode-input-background))',
    border: '1px solid var(--vscode-panel-border)',
    borderRadius: '4px',
    padding: '12px 14px',
    fontFamily: 'var(--vscode-editor-font-family, monospace)',
    fontSize: '12px',
    lineHeight: 1.7,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    margin: 0,
  } as React.CSSProperties,
  repoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    marginBottom: '2px',
    minWidth: 0,
  } as React.CSSProperties,
  repoIcon: {
    fontSize: '11px',
    opacity: 0.6,
    flexShrink: 0,
  } as React.CSSProperties,
  repoName: (color?: string): React.CSSProperties => ({
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '11px',
    fontWeight: 600,
    color: color ?? 'var(--vscode-foreground)',
    opacity: 0.85,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  }),
  rangeTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    fontWeight: 600,
    fontStyle: 'italic',
    paddingRight: '28px',
  } as React.CSSProperties,
  rangeHint: {
    fontSize: '11px',
    opacity: 0.65,
  } as React.CSSProperties,
  // Same look as the Log Panel's repository tabs, each tab taking half the width
  modeTabs: {
    display: 'flex',
    borderBottom: '1px solid var(--vscode-panel-border)',
    flexShrink: 0,
  } as React.CSSProperties,
  modeTab: (active: boolean): React.CSSProperties => ({
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '5px 10px',
    background: 'transparent',
    border: 'none',
    borderBottom: active ? '2px solid var(--vscode-focusBorder)' : '2px solid transparent',
    cursor: 'pointer',
    fontFamily: 'var(--vscode-font-family)',
    fontSize: '12px',
    fontWeight: active ? 600 : 400,
    whiteSpace: 'nowrap',
    opacity: active ? 1 : 0.6,
    color: 'var(--vscode-foreground)',
  }),
  // Room for 5 commits before it scrolls
  selectionList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '3px',
    maxHeight: '106px',
    overflowY: 'auto' as const,
    marginTop: '2px',
  } as React.CSSProperties,
  selectionRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    minWidth: 0,
    minHeight: '18px',
    padding: '0 4px',
    margin: '0 -4px',
    fontSize: '12px',
  } as React.CSSProperties,
  openDetailRow: (hovered: boolean): React.CSSProperties => ({
    borderRadius: '3px',
    cursor: 'pointer',
    outline: 'none',
    background: hovered ? 'var(--vscode-list-hoverBackground)' : 'transparent',
  }),
  selectionRepoDot: (color?: string): React.CSSProperties => ({
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
    background: color ?? 'var(--vscode-descriptionForeground)',
  }),
  selectionMessage: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  fileRepoHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    minHeight: '22px',
    padding: '0 8px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    userSelect: 'none' as const,
    outline: 'none',
  } as React.CSSProperties,
  fileRepoChevron: {
    fontSize: '12px',
    opacity: 0.7,
    flexShrink: 0,
  } as React.CSSProperties,
  fileRepoName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  fileRepoCount: {
    fontSize: '11px',
    fontWeight: 'normal' as const,
    opacity: 0.5,
    flexShrink: 0,
  } as React.CSSProperties,
  hashRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  hash: {
    fontFamily: 'monospace',
    fontSize: '11px',
    color: 'var(--vscode-badge-foreground)',
    padding: '1px 4px',
    background: 'var(--vscode-badge-background)',
    borderRadius: '3px',
    flexShrink: 0,
  } as React.CSSProperties,
  message: {
    fontWeight: 'bold' as const,
    fontSize: '13px',
    color: 'var(--vscode-foreground)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    minWidth: 0,
  },
  authorRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: '8px',
    marginBottom: '8px',
  },
  authorRowTwoColumn: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  } as React.CSSProperties,
  meta: {
    display: 'flex',
    gap: '6px',
    fontSize: '11px',
    color: 'var(--vscode-foreground)',
    opacity: 0.7,
    flexWrap: 'wrap' as const,
    alignItems: 'center',
  },
  dot: {
    opacity: 0.4,
  },
  authorMeta: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '2px',
    minWidth: 0,
  } as React.CSSProperties,
  authorName: {
    fontWeight: 500,
    fontSize: '13px',
  } as React.CSSProperties,
  authorEmail: {
    fontSize: '11px',
    opacity: 0.55,
  } as React.CSSProperties,
  refsRow: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '4px',
  },
  refsRowExpanded: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '4px',
    maxHeight: '160px',
    overflowY: 'auto' as const,
    paddingRight: '2px',
  },
  refsShowMore: {
    fontSize: '10px',
    color: 'var(--vscode-textLink-foreground)',
    cursor: 'pointer',
    alignSelf: 'center',
    flexShrink: 0,
  } as React.CSSProperties,
  refBadge: (color: string, isHead = false): React.CSSProperties => ({
    fontSize: '10px',
    padding: '0 6px',
    height: '16px',
    lineHeight: '16px',
    borderRadius: '3px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3px',
    background: `${color}33`,
    color,
    border: `1px solid ${color}88`,
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
    boxSizing: 'border-box' as const,
    fontWeight: isHead ? 700 : 500,
  }),
  mergeSection: {
    marginTop: '6px',
    borderTop: '1px solid var(--vscode-panel-border)',
    paddingTop: '6px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '2px',
    flexShrink: 0,
  },
  // Same bordered-list container the Pull Request detail's commit list uses.
  mergeCommitsList: {
    display: 'flex',
    flexDirection: 'column' as const,
    border: '1px solid var(--vscode-panel-border)',
    borderRadius: '4px',
    overflow: 'hidden',
    maxHeight: '360px',
    overflowY: 'auto' as const,
    flexShrink: 0,
  } as React.CSSProperties,
  mergeSectionTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    fontSize: '11px',
    opacity: 0.6,
    marginBottom: '2px',
    userSelect: 'none' as const,
  } as React.CSSProperties,
  mergeLoading: {
    fontSize: '11px',
    opacity: 0.45,
    padding: '2px 0',
  } as React.CSSProperties,
  // Log Panel: hash + message only, not clickable — a quick-reference list, not a
  // secondary navigation surface (that stays the job of the main commit list).
  // Only the rows scroll (the section title stays put), capped at MERGE_MINIMAL_VISIBLE_ROWS rows.
  mergeCommitsListMinimal: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: `${MERGE_MINIMAL_ROW_GAP}px`,
    maxHeight: `${MERGE_MINIMAL_VISIBLE_ROWS * MERGE_MINIMAL_ROW_HEIGHT + (MERGE_MINIMAL_VISIBLE_ROWS - 1) * MERGE_MINIMAL_ROW_GAP}px`,
    overflowY: 'auto' as const,
  } as React.CSSProperties,
  mergeCommitRowMinimal: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    height: `${MERGE_MINIMAL_ROW_HEIGHT}px`,
    flexShrink: 0,
    padding: '0 4px',
    fontSize: '11px',
    color: 'var(--vscode-foreground)',
  } as React.CSSProperties,
  mergeHash: {
    fontFamily: 'monospace',
    fontSize: '10px',
    color: 'var(--vscode-foreground)',
    opacity: 0.55,
    flexShrink: 0,
  } as React.CSSProperties,
  mergeMessage: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    color: 'var(--vscode-foreground)',
  } as React.CSSProperties,
  mergeMeta: {
    fontSize: '10px',
    opacity: 0.5,
    flexShrink: 0,
    maxWidth: '80px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  fileListToolbar: {
    display: 'flex',
    alignItems: 'center',
    padding: '2px 8px',
    minHeight: 28,
    borderBottom: '1px solid var(--vscode-panel-border)',
    gap: '4px',
    minWidth: 0,
  } as React.CSSProperties,
  fileCount: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    fontSize: '11px',
    opacity: 0.55,
    color: 'var(--vscode-foreground)',
  } as React.CSSProperties,
  toolbarGroup: {
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
    gap: '1px',
  } as React.CSSProperties,
  toolbarDivider: {
    width: '1px',
    height: '14px',
    margin: '0 4px',
    background: 'var(--vscode-panel-border)',
    flexShrink: 0,
  } as React.CSSProperties,
  toolbarIcon: {
    fontSize: '14px',
    lineHeight: 1,
  } as React.CSSProperties,
  toggleBtn: (active: boolean): React.CSSProperties => ({
    width: '22px',
    height: '22px',
    padding: 0,
    justifyContent: 'center',
    background: active ? 'var(--vscode-toolbar-activeBackground)' : 'transparent',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    color: 'var(--vscode-foreground)',
    opacity: active ? 1 : 0.75,
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
  }),
  fileList: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto' as const,
    fontSize: '12px',
  },
  // Wraps the file toolbar + file list (everything after the header) as the right column in
  // twoColumnLayout mode; a no-op passthrough wrapper otherwise so the JSX stays balanced.
  rightColumn: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  } as React.CSSProperties,
  loading: {
    padding: '8px',
    fontSize: '11px',
    opacity: 0.6,
    color: 'var(--vscode-foreground)',
    textAlign: 'center' as const,
  },
};
