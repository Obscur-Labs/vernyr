'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { CardSkeleton } from '@/components/Skeleton';
import { useAuthStore } from '@/stores/authStore';
import { useToast } from '@/context/ToastContext';
import api from '@/lib/api';
import type { Student } from '@/types';

const TABS = ['Personal', 'Education', 'Preferences', 'Password'] as const;
type Tab = typeof TABS[number];

export default function ProfilePage() {
  const { user, studentId } = useAuthStore();
  const { toast }           = useToast();
  const [student, setStudent] = useState<Student | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [tab, setTab]         = useState<Tab>('Personal');

  // Personal
  const [name,        setName]        = useState('');
  const [phone,       setPhone]       = useState('');
  const [dob,         setDob]         = useState('');
  const [gender,      setGender]      = useState('');
  const [nationality, setNationality] = useState('');
  const [address,     setAddress]     = useState('');

  // Education
  const [highestLevel, setHighestLevel] = useState('');
  const [college,      setCollege]      = useState('');
  const [score,        setScore]        = useState('');

  // Preferences
  const [countries,  setCountries]  = useState('');
  const [courses,    setCourses]    = useState('');
  const [intake,     setIntake]     = useState('');

  // Password
  const [currentPass,  setCurrentPass]  = useState('');
  const [newPass,      setNewPass]      = useState('');
  const [confirmPass,  setConfirmPass]  = useState('');

  useEffect(() => {
    if (!studentId) return;
    api.get<Student>(`/students/${studentId}`)
      .then(res => {
        const s = res.data;
        setStudent(s);
        setName(s.personal.name);
        setPhone(s.personal.phone);
        setDob(s.personal.dob ?? '');
        setGender(s.personal.gender ?? '');
        setNationality(s.personal.nationality ?? '');
        setAddress(s.personal.address ?? '');
        setHighestLevel(s.education?.highestLevel ?? '');
        setCollege(s.education?.graduationCollege ?? '');
        setScore(s.education?.graduationScore?.toString() ?? '');
        setCountries(s.preferences?.countries?.join(', ') ?? '');
        setCourses(s.preferences?.courses?.join(', ') ?? '');
        setIntake(s.preferences?.intake ?? '');
      })
      .catch(() => toast('Failed to load profile', 'error'))
      .finally(() => setLoading(false));
  }, [studentId, toast]);

  async function savePersonal(e: React.FormEvent) {
    e.preventDefault();
    if (!studentId) return;
    setSaving(true);
    try {
      await api.patch(`/students/${studentId}`, {
        personal: { name, phone, dob: dob || undefined, gender: gender || undefined, nationality: nationality || undefined, address: address || undefined },
      });
      toast('Profile updated!');
    } catch {
      toast('Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function saveEducation(e: React.FormEvent) {
    e.preventDefault();
    if (!studentId) return;
    setSaving(true);
    try {
      await api.patch(`/students/${studentId}`, {
        education: {
          highestLevel: highestLevel || undefined,
          graduationCollege: college || undefined,
          graduationScore: score ? Number(score) : undefined,
        },
      });
      toast('Education info updated!');
    } catch {
      toast('Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function savePreferences(e: React.FormEvent) {
    e.preventDefault();
    if (!studentId) return;
    setSaving(true);
    try {
      await api.patch(`/students/${studentId}`, {
        preferences: {
          countries: countries.split(',').map(s => s.trim()).filter(Boolean),
          courses:   courses.split(',').map(s => s.trim()).filter(Boolean),
          intake:    intake || undefined,
        },
      });
      toast('Preferences updated!');
    } catch {
      toast('Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPass !== confirmPass) { toast('Passwords do not match', 'error'); return; }
    if (newPass.length < 6)      { toast('Password must be at least 6 characters', 'error'); return; }
    setSaving(true);
    try {
      await api.post('/auth/change-password', { currentPassword: currentPass, newPassword: newPass });
      toast('Password changed!');
      setCurrentPass(''); setNewPass(''); setConfirmPass('');
    } catch {
      toast('Failed to change password', 'error');
    } finally {
      setSaving(false);
    }
  }

  const initials = user?.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) ?? 'ME';

  return (
    <AppShell title="Profile">
      <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-2xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-accent/20 text-accent text-xl font-bold flex items-center justify-center flex-shrink-0">
            {initials}
          </div>
          <div>
            <h1 className="text-xl font-bold text-t1">{user?.name}</h1>
            <p className="text-t3 text-sm">{user?.username ?? user?.email}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-muted rounded-xl p-1">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-lg text-xs font-semibold transition ${
                tab === t ? 'bg-surface text-t1 shadow-sm' : 'text-t2 hover:text-t1'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)}</div>
        ) : (
          <div className="bg-surface border border-line rounded-2xl p-5 animate-fade-in">
            {tab === 'Personal' && (
              <form onSubmit={savePersonal} className="space-y-4">
                <h2 className="font-semibold text-t1 mb-4">Personal Information</h2>
                <Field label="Full Name"    value={name}        onChange={setName}        required />
                <Field label="Phone"        value={phone}       onChange={setPhone}       required type="tel" />
                <Field label="Date of Birth" value={dob}        onChange={setDob}         type="date" />
                <div>
                  <label className="block text-xs font-semibold text-t2 mb-1.5 uppercase tracking-wider">Gender</label>
                  <select
                    value={gender}
                    onChange={e => setGender(e.target.value)}
                    className="w-full bg-muted border border-line rounded-xl px-3 py-2.5 text-sm text-t1 focus:outline-none focus:border-accent transition"
                  >
                    <option value="">Select…</option>
                    <option>Male</option>
                    <option>Female</option>
                    <option>Other</option>
                    <option>Prefer not to say</option>
                  </select>
                </div>
                <Field label="Nationality" value={nationality} onChange={setNationality} />
                <Field label="Address"     value={address}     onChange={setAddress}     multiline />
                <SaveButton saving={saving} />
              </form>
            )}

            {tab === 'Education' && (
              <form onSubmit={saveEducation} className="space-y-4">
                <h2 className="font-semibold text-t1 mb-4">Education Background</h2>
                <div>
                  <label className="block text-xs font-semibold text-t2 mb-1.5 uppercase tracking-wider">Highest Level</label>
                  <select
                    value={highestLevel}
                    onChange={e => setHighestLevel(e.target.value)}
                    className="w-full bg-muted border border-line rounded-xl px-3 py-2.5 text-sm text-t1 focus:outline-none focus:border-accent transition"
                  >
                    <option value="">Select…</option>
                    <option>10th</option>
                    <option>12th</option>
                    <option>Diploma</option>
                    <option>Bachelor's</option>
                    <option>Master's</option>
                  </select>
                </div>
                <Field label="College / University" value={college} onChange={setCollege} />
                <Field label="Score / CGPA"         value={score}   onChange={setScore}   type="number" />
                <SaveButton saving={saving} />
              </form>
            )}

            {tab === 'Preferences' && (
              <form onSubmit={savePreferences} className="space-y-4">
                <h2 className="font-semibold text-t1 mb-4">Study Preferences</h2>
                <div>
                  <label className="block text-xs font-semibold text-t2 mb-1.5 uppercase tracking-wider">
                    Target Countries <span className="normal-case font-normal text-t3">(comma separated)</span>
                  </label>
                  <input
                    value={countries}
                    onChange={e => setCountries(e.target.value)}
                    placeholder="UK, Canada, Australia"
                    className="w-full bg-muted border border-line rounded-xl px-3 py-2.5 text-sm text-t1 placeholder:text-t3 focus:outline-none focus:border-accent transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-t2 mb-1.5 uppercase tracking-wider">
                    Preferred Courses <span className="normal-case font-normal text-t3">(comma separated)</span>
                  </label>
                  <input
                    value={courses}
                    onChange={e => setCourses(e.target.value)}
                    placeholder="Computer Science, MBA"
                    className="w-full bg-muted border border-line rounded-xl px-3 py-2.5 text-sm text-t1 placeholder:text-t3 focus:outline-none focus:border-accent transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-t2 mb-1.5 uppercase tracking-wider">Intake</label>
                  <input
                    value={intake}
                    onChange={e => setIntake(e.target.value)}
                    placeholder="e.g. September 2025"
                    className="w-full bg-muted border border-line rounded-xl px-3 py-2.5 text-sm text-t1 placeholder:text-t3 focus:outline-none focus:border-accent transition"
                  />
                </div>
                <SaveButton saving={saving} />
              </form>
            )}

            {tab === 'Password' && (
              <form onSubmit={changePassword} className="space-y-4">
                <h2 className="font-semibold text-t1 mb-4">Change Password</h2>
                <Field label="Current Password" value={currentPass} onChange={setCurrentPass} type="password" required />
                <Field label="New Password"     value={newPass}     onChange={setNewPass}     type="password" required />
                <Field label="Confirm Password" value={confirmPass} onChange={setConfirmPass} type="password" required />
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-sky-600 to-cyan-600 text-white font-semibold text-sm hover:from-sky-500 hover:to-cyan-500 disabled:opacity-50 transition"
                >
                  {saving ? 'Updating…' : 'Update Password'}
                </button>
              </form>
            )}
          </div>
        )}

        {/* Read-only visa / passport */}
        {!loading && student && tab === 'Personal' && student.passport?.number && (
          <div className="bg-surface border border-line rounded-2xl p-5">
            <h3 className="font-semibold text-t1 text-sm mb-4">Passport Info</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-t3 uppercase tracking-wider">Number</p>
                <p className="text-t1 mt-0.5">{student.passport?.number}</p>
              </div>
              {student.passport?.expiry && (
                <div>
                  <p className="text-xs text-t3 uppercase tracking-wider">Expires</p>
                  <p className="text-t1 mt-0.5">{new Date(student.passport.expiry).toLocaleDateString()}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Field({
  label, value, onChange, type = 'text', required = false, multiline = false,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; required?: boolean; multiline?: boolean;
}) {
  const cls = 'w-full bg-muted border border-line rounded-xl px-3 py-2.5 text-sm text-t1 placeholder:text-t3 focus:outline-none focus:border-accent transition';
  return (
    <div>
      <label className="block text-xs font-semibold text-t2 mb-1.5 uppercase tracking-wider">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          required={required}
          rows={3}
          className={cls}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          required={required}
          className={cls}
        />
      )}
    </div>
  );
}

function SaveButton({ saving }: { saving: boolean }) {
  return (
    <button
      type="submit"
      disabled={saving}
      className="w-full py-3 rounded-xl bg-gradient-to-r from-sky-600 to-cyan-600 text-white font-semibold text-sm hover:from-sky-500 hover:to-cyan-500 disabled:opacity-50 transition"
    >
      {saving ? 'Saving…' : 'Save Changes'}
    </button>
  );
}
