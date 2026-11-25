'use client';

import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronDownIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

/**
 * Accordion, on Radix.
 *
 * The height animation is the part worth not hand-rolling: Radix measures the
 * panel and publishes `--radix-accordion-content-height`, which the keyframes
 * in `globals.css` animate to and from. It also owns the roving focus, the
 * `aria-expanded`/`aria-controls` pairing and the open state, single or
 * multiple — all of which a `data-open` div silently skips.
 */

export const Accordion = AccordionPrimitive.Root;

export function AccordionItem({
  className, ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return <AccordionPrimitive.Item className={cn(className)} {...props} />;
}

export function AccordionTrigger({
  className, children, ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        className={cn(
          'hig-press group flex flex-1 items-center gap-3 rounded-xl px-3 text-left',
          '[&[data-state=open]>svg]:rotate-180',
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon
          className="ml-auto h-4 w-4 shrink-0 text-t3 transition-transform duration-200"
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

export function AccordionContent({
  className, children, ...props
}: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down"
      {...props}
    >
      <div className={cn('pt-1', className)}>{children}</div>
    </AccordionPrimitive.Content>
  );
}
