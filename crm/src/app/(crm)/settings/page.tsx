'use client';
import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { usesEmailLogin, loginHandle } from '@/lib/credentials';
import { useAuthStore } from '@/stores/authStore';
import { useToast } from '@/context/ToastContext';
import { SkeletonTable } from '@/components/Skeleton';
import type { User, UserRole } from '@/types';

const ROLE_OPTIONS: UserRole[] = ['admin', 'counsellor', 'university'];

const ROLE_COLORS: Record<UserRole, string> = {
  admin:      'bg-indigo-500/15 text-indigo-400',
  counsellor: 'bg-emerald-500/15 text-emerald-400',
  student:    'bg-sky-500/15 text-sky-400',
  university: 'bg-teal-500/15 text-teal-400',
};

interface NewUserForm {
  name: string; username: string; email: string; password: string; role: UserRole; phone: string; universityName: string;
}

const BLANK_USER: NewUserForm = { name:'',username:'',email:'',password:'',role:'counsellor',phone:'',universityName:'' };

export default function SettingsPage() {
  const { user: me } = useAuthStore();
  const { toast }    = useToast();
  const [activeTab, setActiveTab] = useState(0);

  // Team Members tab
  const [users, setUsers]             = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser]         = useState<NewUserForm>(BLANK_USER);
  const [addingUser, setAddingUser]   = useState(false);

  // Profile tab
  const [profileForm, setProfileForm] = useState({ name:'', email:'', phone:'' });
  const [passwordForm, setPasswordForm] = useState({ current:'', newPass:'', confirm:'' });
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    if (activeTab === 0) {
      api.get('/users')
        .then(r => setUsers(r.data))
        .catch(() => toast('Failed to load team members', 'error'))
        .finally(() => setLoadingUsers(false));
    }
    if (activeTab === 1 && me) {
      setProfileForm({ name: me.name, email: me.email || '', phone: me.phone || '' });
    }
  }, [activeTab, me]);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddingUser(true);
    try {
      const res = await api.post('/users', newUser);
      setUsers(prev => [...prev, res.data]);
      setShowAddUser(false);
      setNewUser(BLANK_USER);
      toast('Team member added', 'success');
    } catch {
      toast('Failed to add user', 'error');
    } finally {
      setAddingUser(false);
    }
  };

  const handleDeactivate = async (userId: string) => {
    try {
      await api.put(`/users/${userId}`, { isActive: false });
      setUsers(prev => prev.filter(u => u._id !== userId));
      toast('User deactivated', 'success');
    } catch {
      toast('Failed to deactivate user', 'error');
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!me) return;
    setSavingProfile(true);
    try {
      await api.put(`/users/${me._id}`, profileForm);
      toast('Profile updated', 'success');
    } catch {
      toast('Failed to update profile', 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <div className="p-6 animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-t1">Settings</h1>
        <p className="text-t2 text-sm mt-1">Manage your team and account preferences</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface border border-line rounded-xl p-1 w-fit mb-6">
        {['Team Members', 'Your Profile'].map((tab, i) => (
          <button
            key={tab}
            onClick={() => setActiveTab(i)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === i ? 'bg-accent text-white' : 'text-t2 hover:text-t1'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab 0: Team Members */}
      {activeTab === 0 && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-t2">{users.length} active team members</p>
            <button
              onClick={() => setShowAddUser(!showAddUser)}
              className="px-4 py-2 rounded-xl bg-accent text-white text-sm font-semibold hover:bg-indigo-500 transition-colors"
            >
              + Invite Member
            </button>
          </div>

          {showAddUser && (
            <form onSubmit={handleAddUser} className="bg-surface border border-line rounded-2xl p-5 space-y-4">
              <h3 className="text-sm font-semibold text-t1">New Team Member</h3>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: 'Full Name *', key: 'name' },
                  usesEmailLogin(newUser.role)
                    ? { label: 'Email *', key: 'email' }
                    : { label: 'Username *', key: 'username' },
                  { label: 'Password *', key: 'password' },
                  { label: 'Phone', key: 'phone' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs text-t3 mb-1">{f.label}</label>
                    <input
                      type={f.key === 'password' ? 'password' : f.key === 'email' ? 'email' : 'text'}
                      autoComplete={f.key === 'password' ? 'new-password' : 'off'}
                      placeholder={f.key === 'username' ? 'e.g. sarah.thompson' : undefined}
                      required={f.label.endsWith('*')}
                      value={(newUser as unknown as Record<string,string>)[f.key]}
                      onChange={e => setNewUser(p => ({ ...p, [f.key]: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl bg-card border border-line text-t1 text-sm focus:outline-none focus:border-accent"
                    />
                  </div>
                ))}
              </div>
              <div>
                <label className="block text-xs text-t3 mb-1">Role</label>
                <select
                  value={newUser.role}
                  onChange={e => setNewUser(p => ({ ...p, role: e.target.value as UserRole }))}
                  className="px-3 py-2 rounded-xl bg-card border border-line text-t1 text-sm focus:outline-none focus:border-accent"
                >
                  {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r.replace(/_/g,' ')}</option>)}
                </select>
                <p className="text-xs text-t3 mt-1">
                  {usesEmailLogin(newUser.role)
                    ? 'Admin roles sign in with an email address.'
                    : 'This role signs in with a username.'}
                </p>
              </div>
              {newUser.role === 'university' && (
                <div className="col-span-2">
                  <label className="block text-xs text-t3 mb-1">University Name <span className="text-red-400">*</span></label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. University of Manchester"
                    value={newUser.universityName}
                    onChange={e => setNewUser(p => ({ ...p, universityName: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl bg-card border border-line text-t1 text-sm focus:outline-none focus:border-accent"
                  />
                  <p className="text-xs text-t3 mt-1">Must match the university name used in application records exactly.</p>
                </div>
              )}
              <div className="flex gap-3">
                <button type="submit" disabled={addingUser} className="px-4 py-2 rounded-xl bg-accent text-white text-sm font-semibold hover:bg-indigo-500 disabled:opacity-60 transition-colors">
                  {addingUser ? 'Adding…' : 'Add Member'}
                </button>
                <button type="button" onClick={() => setShowAddUser(false)} className="px-4 py-2 rounded-xl bg-muted text-t2 text-sm font-semibold hover:bg-line transition-colors">Cancel</button>
              </div>
            </form>
          )}

          {loadingUsers ? <SkeletonTable rows={5} /> : (
            <div className="bg-surface border border-line rounded-2xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    {['Member','Sign-in','Role','Phone','Actions'].map(h => (
                      <th key={h} className="text-left text-xs font-medium text-t2 px-4 py-3 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u._id} className="border-b border-line last:border-0 hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-accent/20 text-accent text-xs font-bold flex items-center justify-center">
                            {u.name.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase()}
                          </div>
                          <span className="text-sm font-medium text-t1">{u.name}</span>
                          {u._id === me?._id && <span className="text-xs bg-accent/15 text-accent px-1.5 py-0.5 rounded-full">You</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-t2">{loginHandle(u)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${ROLE_COLORS[u.role]}`}>
                          {u.role.replace(/_/g,' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-t2">{u.phone || '—'}</td>
                      <td className="px-4 py-3">
                        {u._id !== me?._id && (
                          <button
                            onClick={() => handleDeactivate(u._id)}
                            className="text-xs text-red-400 hover:underline"
                          >
                            Deactivate
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr><td colSpan={5} className="text-center py-12 text-t3 text-sm">No team members found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 1: Your Profile */}
      {activeTab === 1 && (
        <div className="max-w-lg space-y-6">
          {/* Profile info */}
          <div className="bg-surface border border-line rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-t1 mb-4">Profile Information</h3>
            <form onSubmit={handleSaveProfile} className="space-y-4">
              {[
                { label: 'Full Name', key: 'name' },
                { label: 'Email', key: 'email' },
                { label: 'Phone', key: 'phone' },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs text-t3 mb-1">{f.label}</label>
                  <input
                    type={f.key === 'email' ? 'email' : 'text'}
                    value={(profileForm as Record<string,string>)[f.key]}
                    onChange={e => setProfileForm(p => ({ ...p, [f.key]: e.target.value }))}
                    className="w-full px-4 py-2.5 rounded-xl bg-card border border-line text-t1 text-sm focus:outline-none focus:border-accent"
                  />
                </div>
              ))}
              <button
                type="submit"
                disabled={savingProfile}
                className="px-5 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold hover:bg-indigo-500 disabled:opacity-60 transition-colors"
              >
                {savingProfile ? 'Saving…' : 'Save Changes'}
              </button>
            </form>
          </div>

          {/* Change password */}
          <div className="bg-surface border border-line rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-t1 mb-4">Change Password</h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (passwordForm.newPass !== passwordForm.confirm) {
                  toast('Passwords do not match', 'error');
                  return;
                }
                if (!me) return;
                try {
                  await api.put(`/users/${me._id}`, { password: passwordForm.newPass });
                  setPasswordForm({ current:'', newPass:'', confirm:'' });
                  toast('Password updated', 'success');
                } catch {
                  toast('Failed to update password', 'error');
                }
              }}
              className="space-y-4"
            >
              {[
                { label: 'Current Password', key: 'current' },
                { label: 'New Password', key: 'newPass' },
                { label: 'Confirm New Password', key: 'confirm' },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs text-t3 mb-1">{f.label}</label>
                  <input
                    type="password"
                    required
                    value={(passwordForm as Record<string,string>)[f.key]}
                    onChange={e => setPasswordForm(p => ({ ...p, [f.key]: e.target.value }))}
                    className="w-full px-4 py-2.5 rounded-xl bg-card border border-line text-t1 text-sm focus:outline-none focus:border-accent"
                  />
                </div>
              ))}
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold hover:bg-indigo-500 transition-colors"
              >
                Update Password
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
