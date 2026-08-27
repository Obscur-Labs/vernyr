'use client';

import Link from 'next/link';
import { Modal } from '@/components/ui/Modal';
import { Badge, Button, ButtonLink, Card } from '@/components/ui';
import { ExternalLinkIcon, PencilIcon, TrashIcon } from '@/components/icons';
import { DetailRow, LevelChip, examSummary, formatDuration, formatMoney } from './bits';
import type { Course } from '@/types';

/**
 * Everything the catalogue holds about one course, including the source
 * columns this schema never named — those are what `extras` carries, and
 * dropping them on screen would be losing them.
 */
export function CourseDetail({
  course, open, onClose, onEdit, onDelete,
}: {
  course: Course | null;
  open: boolean;
  onClose: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  if (!course) return null;

  const extras = Object.entries(course.extras ?? {}).filter(([, v]) => v?.trim());

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={course.name}
      description={`${course.universityName} · ${course.country}`}
      size="lg"
      footer={
        <>
          {onDelete && (
            <Button variant="danger" onClick={onDelete} className="mr-auto">
              <TrashIcon className="h-4 w-4" />Remove
            </Button>
          )}
          {course.link && (
            <ButtonLink href={course.link} external variant="secondary">
              <ExternalLinkIcon className="h-4 w-4" />Course page
            </ButtonLink>
          )}
          {onEdit && (
            <Button onClick={onEdit}>
              <PencilIcon className="h-4 w-4" />Edit
            </Button>
          )}
        </>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <LevelChip level={course.level} />
        {course.discipline && <Badge>{course.discipline}</Badge>}
        {course.intakes.map((intake) => (
          <Badge key={intake} tone="accent">{intake}</Badge>
        ))}
      </div>

      <Card tone="inset" padding="none" className="overflow-hidden">
        <DetailRow label="University">
          <Link
            href={`/courses/universities?q=${encodeURIComponent(course.universityName)}`}
            className="text-accent hover:underline"
          >
            {course.universityName}
          </Link>
        </DetailRow>
        <DetailRow label="Country">{course.country}</DetailRow>
        {course.location && <DetailRow label="Location">{course.location}</DetailRow>}
        <DetailRow label="Duration">{formatDuration(course.duration)}</DetailRow>
        <DetailRow label="Tuition">
          {formatMoney(course.tuition)}
          {course.tuition?.text && course.tuition.amount != null && (
            <span className="ml-2 text-[12px] text-t3">as written: {course.tuition.text}</span>
          )}
        </DetailRow>
        <DetailRow label="Application fee">{formatMoney(course.applicationFee)}</DetailRow>
        <DetailRow label="Intakes">{course.intakes.length ? course.intakes.join(', ') : '—'}</DetailRow>
        <DetailRow label="Deadline">{course.deadline?.text || '—'}</DetailRow>
        <DetailRow label="Entry requirements">{examSummary(course)}</DetailRow>
        {course.gpa && <DetailRow label="Academic">{course.gpa}</DetailRow>}
        {course.notes && <DetailRow label="Notes">{course.notes}</DetailRow>}
        {course.link && (
          <DetailRow label="Link">
            <a href={course.link} target="_blank" rel="noreferrer" className="break-all text-accent hover:underline">
              {course.link}
            </a>
          </DetailRow>
        )}
      </Card>

      {extras.length > 0 && (
        <section className="mt-5">
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-t3">
            From the source sheet
          </h3>
          <Card tone="inset" padding="none" className="overflow-hidden">
            {extras.map(([key, value]) => (
              <DetailRow key={key} label={key}>{value}</DetailRow>
            ))}
          </Card>
        </section>
      )}

      {course.source && (
        <p className="mt-4 text-[11.5px] text-t3">
          Imported from <span style={{ fontFamily: 'var(--font-mono)' }}>{course.source}</span>
        </p>
      )}
    </Modal>
  );
}
