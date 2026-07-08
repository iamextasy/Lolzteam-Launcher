import {
  type ReactElement,
  type ReactNode,
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import s from './Tooltip.module.scss';

type Placement = 'top' | 'bottom';

interface TooltipProps {
  label: ReactNode;
  children: ReactElement;
  placement?: Placement;
  delay?: number;
  disabled?: boolean;
}

const GAP = 8;
const EDGE = 8;

interface Pos {
  left: number;
  top: number;
  placement: Placement;
}

export const Tooltip = ({
  label,
  children,
  placement = 'top',
  delay = 200,
  disabled = false,
}: TooltipProps) => {
  const id = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerFocusRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: unmount-only cleanup; clearTimer touches only refs
  useEffect(() => () => clearTimer(), []);

  const show = () => {
    if (disabled) return;
    clearTimer();
    timerRef.current = setTimeout(() => setOpen(true), delay);
  };

  const hide = () => {
    clearTimer();
    setOpen(false);
    setPos(null);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: `label` changes the bubble size — reposition when it changes
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const bubble = bubbleRef.current;
    if (!anchor || !bubble) return;

    const a = anchor.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();

    let side: Placement = placement;
    if (side === 'top' && a.top - GAP - b.height < EDGE) side = 'bottom';
    else if (side === 'bottom' && a.bottom + GAP + b.height > window.innerHeight - EDGE)
      side = 'top';

    const top = side === 'top' ? a.top - GAP - b.height : a.bottom + GAP;

    let left = a.left + a.width / 2 - b.width / 2;
    left = Math.max(EDGE, Math.min(left, window.innerWidth - b.width - EDGE));

    setPos({ left, top, placement: side });
  }, [open, placement, label]);

  const child = children as ReactElement<{
    ref?: React.Ref<HTMLElement>;
    onMouseEnter?: (e: React.MouseEvent) => void;
    onMouseLeave?: (e: React.MouseEvent) => void;
    onPointerDown?: (e: React.PointerEvent) => void;
    onFocus?: (e: React.FocusEvent) => void;
    onBlur?: (e: React.FocusEvent) => void;
    'aria-describedby'?: string;
  }>;

  const setRef = useCallback(
    (node: HTMLElement | null) => {
      anchorRef.current = node;
      const r = (child as { ref?: React.Ref<HTMLElement> }).ref;
      if (typeof r === 'function') r(node);
      else if (r && typeof r === 'object')
        (r as React.MutableRefObject<HTMLElement | null>).current = node;
    },
    [child],
  );

  const trigger = cloneElement(child, {
    ref: setRef,
    onMouseEnter: (e: React.MouseEvent) => {
      child.props.onMouseEnter?.(e);
      show();
    },
    onMouseLeave: (e: React.MouseEvent) => {
      child.props.onMouseLeave?.(e);
      hide();
    },
    onPointerDown: (e: React.PointerEvent) => {
      child.props.onPointerDown?.(e);
      pointerFocusRef.current = true;
      hide();
    },
    onFocus: (e: React.FocusEvent) => {
      child.props.onFocus?.(e);
      if (pointerFocusRef.current) {
        pointerFocusRef.current = false;
        return;
      }
      show();
    },
    onBlur: (e: React.FocusEvent) => {
      child.props.onBlur?.(e);
      pointerFocusRef.current = false;
      hide();
    },
    'aria-describedby': open ? id : undefined,
  });

  return (
    <>
      {trigger}
      {open &&
        createPortal(
          <div
            ref={bubbleRef}
            id={id}
            role="tooltip"
            className={`${s.tooltip} ${pos ? s.visible : ''} ${
              pos?.placement === 'bottom' ? s.bottom : s.top
            }`}
            style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
          >
            {label}
            <span className={s.arrow} aria-hidden />
          </div>,
          document.body,
        )}
    </>
  );
};
