/**
 * The CRM's UI layer.
 *
 * One import site for every primitive, so a page reads
 * `import { Button, Card, Field } from '@/components/ui'` rather than four
 * paths. Anything a second screen would want lives here; anything only one
 * screen needs stays next to that screen.
 */

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './accordion';
export { Badge, badgeVariants, LevelBadge, RoleBadge, type BadgeProps } from './badge';
export { Button, ButtonLink, IconButton, buttonVariants, type ButtonProps } from './button';
export {
  Card, CardHeader, EmptyState, PageHeader, Skeleton, SkeletonList, type CardProps,
} from './card';
export { Checkbox, Field, Input, SearchInput, Segmented, Select, Textarea } from './field';
export { ConfirmModal, Modal, type ModalProps, type ModalSize } from './Modal';
export { Stat, StatSkeleton, type StatProps } from './stat';
