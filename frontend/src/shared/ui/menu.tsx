'use client';

import { ContextMenu as BaseContextMenu } from '@base-ui/react/context-menu';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import { Check } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { cn } from './cn';

type MenuProps = {
  trigger: ReactElement;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom';
  className?: string;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/** Dropdown in the macOS style: dense glass, 28 px rows, arrow keys and type-ahead from Base UI. */
export function Menu({ trigger, align = 'start', side = 'bottom', className, children, open, onOpenChange }: MenuProps) {
  return (
    <BaseMenu.Root open={open} onOpenChange={onOpenChange ? (next) => onOpenChange(next) : undefined}>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner sideOffset={6} align={align} side={side} className="z-50 outline-none">
          <BaseMenu.Popup
            className={cn(
              'glass-dense min-w-48 origin-(--transform-origin) rounded-control p-1 outline-none',
              'transition-[opacity,scale] duration-150 ease-out-soft',
              'data-starting-style:scale-[0.97] data-starting-style:opacity-0 data-ending-style:opacity-0',
              className,
            )}
          >
            {children}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}

const POPUP =
  'glass-dense min-w-48 origin-(--transform-origin) rounded-control p-1 outline-none ' +
  'transition-[opacity,scale] duration-150 ease-out-soft ' +
  'data-starting-style:scale-[0.97] data-starting-style:opacity-0 data-ending-style:opacity-0';

/**
 * Right click (or long press) menu at the pointer, in the same dense glass as `Menu`. The trigger
 * is the element itself (a list row); the items are the usual `MenuItem`s.
 */
export function ContextMenu({
  trigger,
  className,
  children,
  onOpenChange,
}: {
  trigger: ReactElement;
  className?: string;
  children: ReactNode;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <BaseContextMenu.Root onOpenChange={onOpenChange ? (next) => onOpenChange(next) : undefined}>
      <BaseContextMenu.Trigger render={trigger} />
      <BaseContextMenu.Portal>
        <BaseContextMenu.Positioner className="z-50 outline-none">
          <BaseContextMenu.Popup className={cn(POPUP, className)}>{children}</BaseContextMenu.Popup>
        </BaseContextMenu.Positioner>
      </BaseContextMenu.Portal>
    </BaseContextMenu.Root>
  );
}

const ITEM =
  'flex min-h-7 select-none items-center gap-2 rounded-inner px-2 py-1 text-body outline-none pointer-coarse:min-h-11 ' +
  'data-highlighted:bg-fill-strong data-disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0';

export function MenuItem({
  onClick,
  danger = false,
  disabled,
  children,
}: {
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <BaseMenu.Item onClick={onClick} disabled={disabled} className={cn(ITEM, danger && 'text-danger')}>
      {children}
    </BaseMenu.Item>
  );
}

export function MenuSeparator() {
  return <BaseMenu.Separator className="mx-2 my-1 h-px bg-hairline" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 pt-1 pb-1 text-caption font-medium text-ink-muted">{children}</div>;
}

export function MenuRadioGroup({
  value,
  onValueChange,
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <BaseMenu.RadioGroup value={value} onValueChange={(next) => onValueChange(String(next))}>
      {children}
    </BaseMenu.RadioGroup>
  );
}

/** A choice with a check mark column, so labels of checked and unchecked rows line up. */
export function MenuRadioItem({ value, disabled, children }: { value: string; disabled?: boolean; children: ReactNode }) {
  return (
    <BaseMenu.RadioItem value={value} disabled={disabled} className={cn(ITEM, 'items-start')}>
      <span className="mt-0.5 grid size-4 shrink-0 place-items-center">
        <BaseMenu.RadioItemIndicator>
          <Check aria-hidden />
        </BaseMenu.RadioItemIndicator>
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </BaseMenu.RadioItem>
  );
}

export function MenuCheckboxItem({
  checked,
  onCheckedChange,
  children,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <BaseMenu.CheckboxItem
      checked={checked}
      onCheckedChange={(next) => onCheckedChange(next)}
      closeOnClick={false}
      className={ITEM}
    >
      <span className="grid size-4 shrink-0 place-items-center">
        <BaseMenu.CheckboxItemIndicator>
          <Check aria-hidden />
        </BaseMenu.CheckboxItemIndicator>
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </BaseMenu.CheckboxItem>
  );
}
