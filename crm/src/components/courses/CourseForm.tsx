'use client';

import { useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/context/ToastContext';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import {
  COURSE_LEVELS, COURSE_LEVEL_LABELS,
  type Course, type CourseLevel, type Paged, type University,
} from '@/types';

/**
 * Add or edit one course.
 *
 * Money and duration are typed as the sheets write them — "6,000 EUR/year",
 * "2 years" — and normalised server-side by the same parser the importer uses,
 * so a hand-typed row and an imported one end up identical.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

interface Draft {
  university: string;
  name: string;
  level: CourseLevel;
  discipline: string;
  link: string;
  durationText: string;
  tuitionText: string;
  applicationFeeText: string;
  intakes: string[];
  deadlineText: string;
  examText: string;
  gpa: string;
  location: string;
  notes: string;
}

const blank = (universityId?: string): Draft => ({
  university: universityId ?? '',
  name: '', level: 'masters', discipline: '', link: '',
  durationText: '', tuitionText: '', applicationFeeText: '',
  intakes: [], deadlineText: '', examText: '', gpa: '', location: '', notes: '',
});

const fromCourse = (course: Course): Draft => ({
  university: typeof course.university === 'string' ? course.university : course.university._id,
  name: course.name,
  level: course.level,
  discipline: course.discipline ?? '',
  link: course.link ?? '',
  durationText: course.duration?.text ?? '',
  tuitionText: course.tuition?.text ?? '',
  applicationFeeText: course.applicationFee?.text ?? '',
  intakes: course.intakes ?? [],
  deadlineText: course.deadline?.text ?? '',
  examText: course.examText ?? '',
  gpa: course.gpa ?? '',
  location: course.location ?? '',
  notes: course.notes ?? '',
});

export function CourseForm({
  open, onClose, course, universityId, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** Absent means create. */
  course?: Course | null;
  /** Preselects the university when opened from its page. */
  universityId?: string;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>(blank(universityId));
  const [universities, setUniversities] = useState<University[]>([]);
  const [uniQuery, setUniQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const editing = !!course;

  useEffect(() => {
    if (!open) return;
    setDraft(course ? fromCourse(course) : blank(universityId));
    setUniQuery('');
  }, [open, course, universityId]);

  useEffect(() => {
    if (!open || editing) return;
    api.get<Paged<University>>('/catalogue/universities?limit=500')
      .then((r) => setUniversities(r.data.items))
      .catch(() => {});
  }, [open, editing]);

  const matchedUniversities = useMemo(() => {
    const q = uniQuery.trim().toLowerCase();
    const list = q
      ? universities.filter((u) => `${u.name} ${u.country}`.toLowerCase().includes(q))
      : universities;
    return list.slice(0, 200);
  }, [universities, uniQuery]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const toggleIntake = (month: string) =>
    setDraft((d) => ({
      ...d,
      intakes: d.intakes.includes(month) ? d.intakes.filter((m) => m !== month) : [...d.intakes, month],
    }));

  async function save() {
    if (!draft.name.trim()) { toast('Give the course a name', 'error'); return; }
    if (!editing && !draft.university) { toast('Pick the university it belongs to', 'error'); return; }

    // The strings go up verbatim; the server parses them into the same shape
    // the importer produces.
    const payload = {
      university: draft.university,
      name: draft.name.trim(),
      level: draft.level,
      discipline: draft.discipline.trim() || undefined,
      link: draft.link.trim() || undefined,
      duration: draft.durationText.trim() ? { text: draft.durationText.trim() } : undefined,
      tuition: draft.tuitionText.trim() ? { text: draft.tuitionText.trim() } : undefined,
      applicationFee: draft.applicationFeeText.trim() ? { text: draft.applicationFeeText.trim() } : undefined,
      intakes: draft.intakes,
      deadline: draft.deadlineText.trim() ? { text: draft.deadlineText.trim() } : undefined,
      examText: draft.examText.trim() || undefined,
      gpa: draft.gpa.trim() || undefined,
      location: draft.location.trim() || undefined,
      notes: draft.notes.trim() || undefined,
    };

    setBusy(true);
    try {
      if (editing && course) await api.put(`/catalogue/courses/${course._id}`, payload);
      else await api.post('/catalogue/courses', payload);
      toast(editing ? 'Course updated' : 'Course added', 'success');
      onSaved();
      onClose();
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })
        .response?.data?.message ?? 'Could not save the course';
      toast(message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit course' : 'Add a course'}
      description={
        editing
          ? 'Fees and duration keep the wording you type; the numbers behind the filters are read out of it.'
          : 'Write fees and duration however the source states them — "6,000 EUR/year", "2 years".'
      }
      size="lg"
      dismissable={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add course'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!editing && (
          <Field label="University" hint="Where this course is taught. Add the institution first if it is missing.">
            {(id) => (
              <>
                <Input
                  value={uniQuery}
                  onChange={(e) => setUniQuery(e.target.value)}
                  placeholder="Search universities…"
                  aria-label="Search universities"
                  className="mb-2"
                />
                <Select id={id} value={draft.university} onChange={(e) => set('university', e.target.value)}>
                  <option value="">Choose a university…</option>
                  {matchedUniversities.map((u) => (
                    <option key={u._id} value={u._id}>{u.name} — {u.country}</option>
                  ))}
                </Select>
              </>
            )}
          </Field>
        )}

        <Field label="Course name" required>
          {(id) => (
            <Input
              id={id}
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="MSc Data Science"
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Level">
            {(id) => (
              <Select id={id} value={draft.level} onChange={(e) => set('level', e.target.value as CourseLevel)}>
                {COURSE_LEVELS.map((l) => (
                  <option key={l} value={l}>{COURSE_LEVEL_LABELS[l]}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Discipline" hint="Optional — groups courses in the filters.">
            {(id) => (
              <Input id={id} value={draft.discipline} onChange={(e) => set('discipline', e.target.value)} placeholder="Engineering" />
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Duration" hint={'"2 years", "18 months", "4 semesters"'}>
            {(id) => (
              <Input id={id} value={draft.durationText} onChange={(e) => set('durationText', e.target.value)} placeholder="2 years" />
            )}
          </Field>
          <Field label="Location" hint="City or campus.">
            {(id) => (
              <Input id={id} value={draft.location} onChange={(e) => set('location', e.target.value)} placeholder="Tartu" />
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tuition" hint={'"6,000 EUR/year", "1600€/sem"'}>
            {(id) => (
              <Input id={id} value={draft.tuitionText} onChange={(e) => set('tuitionText', e.target.value)} placeholder="6,000 EUR/year" />
            )}
          </Field>
          <Field label="Application fee" hint={'"EUR 100"'}>
            {(id) => (
              <Input id={id} value={draft.applicationFeeText} onChange={(e) => set('applicationFeeText', e.target.value)} placeholder="EUR 100" />
            )}
          </Field>
        </div>

        <Field label="Intakes" hint="Every month this course starts.">
          <div className="flex flex-wrap gap-1.5">
            {MONTHS.map((month) => {
              const on = draft.intakes.includes(month);
              return (
                <Button
                  key={month}
                  size="sm"
                  variant={on ? 'primary' : 'outline'}
                  aria-pressed={on}
                  onClick={() => toggleIntake(month)}
                >
                  {month.slice(0, 3)}
                </Button>
              );
            })}
          </div>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Deadline" hint="As written, or a date.">
            {(id) => (
              <Input id={id} value={draft.deadlineText} onChange={(e) => set('deadlineText', e.target.value)} placeholder="2026-04-30" />
            )}
          </Field>
          <Field label="Academic requirement">
            {(id) => (
              <Input id={id} value={draft.gpa} onChange={(e) => set('gpa', e.target.value)} placeholder="GPA 3.0" />
            )}
          </Field>
        </div>

        <Field label="Entry exams" hint={'"IELTS 6.5 / TOEFL 90" — parsed into filterable requirements.'}>
          {(id) => (
            <Input id={id} value={draft.examText} onChange={(e) => set('examText', e.target.value)} placeholder="IELTS 6.5" />
          )}
        </Field>

        <Field label="Course page">
          {(id) => (
            <Input id={id} value={draft.link} onChange={(e) => set('link', e.target.value)} placeholder="https://…" />
          )}
        </Field>

        <Field label="Notes">
          {(id) => (
            <Textarea id={id} value={draft.notes} onChange={(e) => set('notes', e.target.value)} rows={3} />
          )}
        </Field>
      </div>
    </Modal>
  );
}
