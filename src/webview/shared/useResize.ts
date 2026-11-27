import { useRef, useCallback } from 'react';

/**
 * Drag-to-resize a pane that sits beside a SplitHandle, on either axis.
 * The size is kept for the life of the webview and, when `id` is set, restored
 * from localStorage the next time the view opens.
 *
 * There is no fixed maximum: the pane grows until flexible siblings reach their
 * min size. It is laid out as `flex: 0 1 <size>` with a minimum, so a narrow
 * window shrinks it to that minimum and gives the size back when there is room.
 * `limit: 'max'` caps the pane instead of pinning it, so leftover space stays
 * with the flexible sibling once the content is fully visible.
 */
export interface ResizeOptions {
  /** Stable key. The dragged size is restored the next time this pane mounts. */
  id?: string;
  /** 'x' resizes width, 'y' resizes height. */
  axis?: 'x' | 'y';
  /** The pane is before the handle (left/top) or after it (right/bottom). */
  side: 'before' | 'after';
  initial: number;
  min: number;
  /**
   * 'fixed' pins the pane to the dragged size.
   * 'max' only caps it: shorter content stays content-sized, and the flexible sibling keeps the leftover space.
   */
  limit?: 'fixed' | 'max';
}

interface ResizeBinding {
  panelRef: (el: HTMLDivElement | null) => void;
  onMouseDown: (e: React.MouseEvent) => void;
}

const STORAGE_PREFIX = 'gitcharm.split.';

export function useResize(direction: 'right' | 'left', initial: number, min: number): ResizeBinding;
export function useResize(options: ResizeOptions): ResizeBinding;
export function useResize(
  directionOrOptions: 'right' | 'left' | ResizeOptions,
  initial?: number,
  min?: number,
): ResizeBinding {
  const options: ResizeOptions = typeof directionOrOptions === 'string'
    ? { axis: 'x', side: directionOrOptions === 'right' ? 'before' : 'after', initial: initial ?? 0, min: min ?? 0 }
    : directionOrOptions;
  const axis = options.axis ?? 'x';
  const { id, side } = options;
  const minSize = options.min;
  const limit = options.limit ?? 'fixed';

  const elRef = useRef<HTMLDivElement | null>(null);
  const sizeRef = useRef(readSize(id, options.initial));

  const panelRef = useCallback((el: HTMLDivElement | null) => {
    elRef.current = el;
    if (el) applySize(el, sizeRef.current, minSize, axis, limit);
  }, [axis, limit, minSize]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const panel = elRef.current;
    if (!panel) return;
    const start = axis === 'x' ? e.clientX : e.clientY;
    const rendered = axis === 'x' ? panel.offsetWidth : panel.offsetHeight;
    // A max-capped pane may be shorter than its cap. Drag from the visible edge so shrinking tracks the pointer.
    const startSize = limit === 'max' ? Math.min(sizeRef.current, rendered) : rendered;
    const max = Math.max(startSize, maxSize(panel, axis));

    const onMove = (ev: MouseEvent) => {
      const point = axis === 'x' ? ev.clientX : ev.clientY;
      const delta = side === 'before' ? point - start : start - point;
      let next = Math.min(max, Math.max(minSize, startSize + delta));
      if (limit === 'max' && panel.scrollHeight > 0) {
        next = Math.min(next, Math.max(minSize, panel.scrollHeight));
      }
      sizeRef.current = next;
      writeSize(id, next);
      if (elRef.current) applySize(elRef.current, next, minSize, axis, limit);
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [axis, id, limit, minSize, side]);

  return { panelRef, onMouseDown };
}

function readSize(id: string | undefined, initial: number): number {
  if (!id) return initial;
  try {
    const n = Number(localStorage.getItem(STORAGE_PREFIX + id));
    return Number.isFinite(n) && n > 0 ? n : initial;
  } catch {
    return initial;
  }
}

function writeSize(id: string | undefined, size: number) {
  if (!id) return;
  try { localStorage.setItem(STORAGE_PREFIX + id, String(Math.round(size))); } catch { /* storage unavailable */ }
}

function applySize(el: HTMLDivElement, size: number, min: number, axis: 'x' | 'y', limit: 'fixed' | 'max') {
  const px = `${size}px`;
  if (limit === 'max') {
    el.style.flex = '0 1 auto';
    if (axis === 'x') {
      el.style.width = '';
      el.style.maxWidth = px;
      el.style.minWidth = `${min}px`;
    } else {
      el.style.height = '';
      el.style.maxHeight = px;
      el.style.minHeight = `${min}px`;
    }
    return;
  }
  el.style.flex = `0 1 ${px}`;
  if (axis === 'x') {
    el.style.maxWidth = '';
    el.style.width = px;
    el.style.minWidth = `${min}px`;
  } else {
    el.style.maxHeight = '';
    el.style.height = px;
    el.style.minHeight = `${min}px`;
  }
}

/** Largest the pane can get before flexible siblings hit their minimum. */
function maxSize(panel: HTMLElement, axis: 'x' | 'y'): number {
  const parent = panel.parentElement;
  if (!parent) return Infinity;
  const parentSize = axis === 'x' ? parent.clientWidth : parent.clientHeight;
  let taken = 0;
  for (const sibling of Array.from(parent.children)) {
    if (sibling === panel || !(sibling instanceof HTMLElement)) continue;
    const style = getComputedStyle(sibling);
    if (style.display === 'none' || style.position === 'absolute' || style.position === 'fixed') continue;
    const grows = parseFloat(style.flexGrow) > 0;
    if (grows) {
      taken += parseFloat(axis === 'x' ? style.minWidth : style.minHeight) || 0;
    } else {
      taken += axis === 'x' ? sibling.offsetWidth : sibling.offsetHeight;
    }
  }
  return parentSize - taken;
}
