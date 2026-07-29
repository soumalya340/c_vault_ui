'use client';

import * as React from 'react';

import {
  HoverCard as HoverCardPrimitive,
  HoverCardTrigger as HoverCardTriggerPrimitive,
  HoverCardPortal as HoverCardPortalPrimitive,
  HoverCardContent as HoverCardContentPrimitive,
  type HoverCardProps as HoverCardPrimitiveProps,
  type HoverCardTriggerProps as HoverCardTriggerPrimitiveProps,
  type HoverCardContentProps as HoverCardContentPrimitiveProps,
} from '@/components/animate-ui/primitives/radix/hover-card';
import { cn } from '@/lib/utils';

type HoverCardProps = HoverCardPrimitiveProps;

function HoverCard(props: HoverCardProps) {
  return <HoverCardPrimitive {...props} />;
}

type HoverCardTriggerProps = HoverCardTriggerPrimitiveProps;

function HoverCardTrigger(props: HoverCardTriggerProps) {
  return <HoverCardTriggerPrimitive {...props} />;
}

type HoverCardContentProps = HoverCardContentPrimitiveProps;

function HoverCardContent({
  className,
  align = 'center',
  sideOffset = 4,
  ...props
}: HoverCardContentProps) {
  return (
    <HoverCardPortalPrimitive>
      <HoverCardContentPrimitive
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 w-64 origin-(--radix-hover-card-content-transform-origin) rounded-[2px] border border-border-strong bg-background p-4 text-foreground shadow-[0_18px_48px_-18px_rgba(23,37,28,0.35)] outline-hidden',
          className,
        )}
        {...props}
      />
    </HoverCardPortalPrimitive>
  );
}

export {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
  type HoverCardProps,
  type HoverCardTriggerProps,
  type HoverCardContentProps,
};
