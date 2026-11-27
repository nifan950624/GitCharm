import React, { useState } from 'react';

interface Props {
  onMouseDown: (e: React.MouseEvent) => void;
  /** 'x' changes the width of the neighbouring flex items, 'y' their height. */
  axis?: 'x' | 'y';
  style?: React.CSSProperties;
}

/** The edge between two flex items. Dragging it changes their width or height. */
export function ResizeHandle({ onMouseDown, axis = 'x', style }: Props) {
  const [hot, setHot] = useState(false);
  const vertical = axis === 'y';
  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      role="separator"
      aria-orientation={vertical ? 'horizontal' : 'vertical'}
      style={{
        flex: '0 0 4px',
        cursor: vertical ? 'row-resize' : 'col-resize',
        background: hot ? 'var(--vscode-focusBorder)' : 'transparent',
        zIndex: 10,
        ...style,
      }}
    />
  );
}
