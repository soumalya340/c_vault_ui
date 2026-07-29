'use client';

import * as React from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import {
  AnimatePresence,
  motion,
  type HTMLMotionProps,
  type Transition,
} from 'motion/react';

import { getStrictContext } from '@/lib/get-strict-context';
import { useControlledState } from '@/hooks/use-controlled-state';

type PopoverContextType = {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
};

const [PopoverProvider, usePopover] =
  getStrictContext<PopoverContextType>('PopoverContext');

type PopoverProps = React.ComponentProps<typeof PopoverPrimitive.Root>;

function Popover(props: PopoverProps) {
  const [isOpen, setIsOpen] = useControlledState({
    value: props?.open,
    defaultValue: props?.defaultOpen,
    onChange: props?.onOpenChange,
  });

  return (
    <PopoverProvider value={{ isOpen, setIsOpen }}>
      <PopoverPrimitive.Root
        data-slot="popover"
        {...props}
        onOpenChange={setIsOpen}
      />
    </PopoverProvider>
  );
}

type PopoverTriggerProps = React.ComponentProps<
  typeof PopoverPrimitive.Trigger
>;

function PopoverTrigger(props: PopoverTriggerProps) {
  return (
    <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
  );
}

type PopoverPortalProps = Omit<
  React.ComponentProps<typeof PopoverPrimitive.Portal>,
  'forceMount'
>;

function PopoverPortal(props: PopoverPortalProps) {
  const { isOpen } = usePopover();

  return (
    <AnimatePresence>
      {isOpen && (
        <PopoverPrimitive.Portal
          forceMount
          data-slot="popover-portal"
          {...props}
        />
      )}
    </AnimatePresence>
  );
}

type PopoverContentProps = Omit<
  React.ComponentProps<typeof PopoverPrimitive.Content>,
  'asChild' | 'forceMount'
> &
  HTMLMotionProps<'div'> & {
    transition?: Transition;
  };

function PopoverContent({
  align = 'center',
  alignOffset,
  side = 'bottom',
  sideOffset = 4,
  avoidCollisions,
  collisionBoundary,
  collisionPadding,
  arrowPadding,
  sticky,
  hideWhenDetached,
  className,
  style,
  children,
  transition = { type: 'spring', stiffness: 300, damping: 25 },
  ...props
}: PopoverContentProps) {
  return (
    <PopoverPrimitive.Content
      forceMount
      asChild
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      avoidCollisions={avoidCollisions}
      collisionBoundary={collisionBoundary}
      collisionPadding={collisionPadding}
      arrowPadding={arrowPadding}
      sticky={sticky}
      hideWhenDetached={hideWhenDetached}
    >
      <motion.div
        key="popover-content"
        data-slot="popover-content"
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.5 }}
        transition={transition}
        className={className}
        style={style}
        {...props}
      >
        {children}
      </motion.div>
    </PopoverPrimitive.Content>
  );
}

type PopoverCloseProps = React.ComponentProps<typeof PopoverPrimitive.Close>;

function PopoverClose(props: PopoverCloseProps) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />;
}

export {
  Popover,
  PopoverTrigger,
  PopoverPortal,
  PopoverContent,
  PopoverClose,
  usePopover,
  type PopoverProps,
  type PopoverTriggerProps,
  type PopoverPortalProps,
  type PopoverContentProps,
  type PopoverCloseProps,
  type PopoverContextType,
};
