import { M } from './meta';

// The client's badges (legacy/public/js/core.js)
const STATUS: Record<string, string> = {
  New: 'blue', Contacted: 'purple', 'Follow-up': 'orange', Interested: 'green', 'Not interested': 'grey', Converted: 'green', Active: 'green', 'On hold': 'orange',
  Dropped: 'red', Enrolled: 'blue', Archived: 'grey', Pending: 'grey', Uploaded: 'orange', Verified: 'green', Rejected: 'red', Queued: 'grey', Retrying: 'orange',
  Sent: 'blue', Delivered: 'green', Opened: 'green', Bounced: 'red', Failed: 'red', Cancelled: 'grey', Open: 'blue', 'In progress': 'purple', Done: 'green',
};
export const StatusBadge = ({ s }: { s: string }) => <span className={`badge ${STATUS[s] ?? ''}`}>{s}</span>;
export const PriBadge = ({ p }: { p: string }) => <span className={`badge pri-${p}`}>{p}</span>;
export const StageBadge = ({ code, type = 'app' }: { code: string; type?: 'app' | 'visa' }) => {
  const s = type === 'app' ? M.stage(code) : M.vstage(code);
  return <span className="badge solid" style={{ background: s.color || 'var(--muted)' }}>{s.name}</span>;
};
