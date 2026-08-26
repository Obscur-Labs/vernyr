'use client';
import { useState } from 'react';
import type { Lead, LeadStatus } from '@/types';

const COLUMNS: { id: LeadStatus; label: string; dot: string; badge: string }[] = [
  { id: 'new',                 label: 'New',                 dot: 'bg-indigo-500',  badge: 'bg-indigo-500/15 text-indigo-400' },
  { id: 'contacted',           label: 'Contacted',           dot: 'bg-blue-500',    badge: 'bg-blue-500/15 text-blue-400' },
  { id: 'counselling',         label: 'Counselling',         dot: 'bg-violet-500',  badge: 'bg-violet-500/15 text-violet-400' },
  { id: 'interested',          label: 'Interested',          dot: 'bg-amber-500',   badge: 'bg-amber-500/15 text-amber-400' },
  { id: 'application_started', label: 'Application Started', dot: 'bg-orange-500',  badge: 'bg-orange-500/15 text-orange-400' },
  { id: 'closed_won',          label: 'Closed Won',          dot: 'bg-emerald-500', badge: 'bg-emerald-500/15 text-emerald-400' },
  { id: 'closed_lost',         label: 'Closed Lost',         dot: 'bg-red-500',     badge: 'bg-red-500/15 text-red-400' },
];

const SOURCE_COLORS: Record<string, string> = {
  website:      'bg-blue-500/15 text-blue-400',
  referral:     'bg-emerald-500/15 text-emerald-400',
  social_media: 'bg-pink-500/15 text-pink-400',
  walk_in:      'bg-amber-500/15 text-amber-400',
  phone:        'bg-violet-500/15 text-violet-400',
  email:        'bg-indigo-500/15 text-indigo-400',
  other:        'bg-t3/15 text-t3',
};

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

interface Props {
  leads: Lead[];
  onStatusChange: (leadId: string, newStatus: LeadStatus) => void;
  onCardClick?: (lead: Lead) => void;
}

export function LeadKanban({ leads, onStatusChange, onCardClick }: Props) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<LeadStatus | null>(null);

  const getLeadsByStatus = (status: LeadStatus) => leads.filter(l => l.status === status);

  const handleDragStart = (e: React.DragEvent, leadId: string) => {
    setDraggedId(leadId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, colId: LeadStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setOverCol(colId);
  };

  const handleDrop = (e: React.DragEvent, colId: LeadStatus) => {
    e.preventDefault();
    if (draggedId && colId) {
      const lead = leads.find(l => l._id === draggedId);
      if (lead && lead.status !== colId) {
        onStatusChange(draggedId, colId);
      }
    }
    setDraggedId(null);
    setOverCol(null);
  };

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 min-h-[calc(100vh-200px)]">
      {COLUMNS.map(col => {
        const colLeads = getLeadsByStatus(col.id);
        const isOver = overCol === col.id;
        return (
          <div
            key={col.id}
            className={`flex-shrink-0 w-72 flex flex-col rounded-2xl bg-surface border border-line transition-colors ${
              isOver ? 'border-accent/50 bg-accent/5' : ''
            }`}
            onDragOver={e => handleDragOver(e, col.id)}
            onDragLeave={() => setOverCol(null)}
            onDrop={e => handleDrop(e, col.id)}
          >
            {/* Column header */}
            <div className="px-4 py-3 border-b border-line rounded-t-2xl">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-t1">
                  <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${col.dot}`} />
                  <span className="truncate">{col.label}</span>
                </span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${col.badge}`}>
                  {colLeads.length}
                </span>
              </div>
            </div>

            {/* Cards */}
            <div className="flex-1 p-3 space-y-3 overflow-y-auto">
              {colLeads.map(lead => (
                <div
                  key={lead._id}
                  draggable
                  onDragStart={e => handleDragStart(e, lead._id)}
                  onClick={() => onCardClick?.(lead)}
                  className={`bg-card border border-line rounded-xl p-3 cursor-grab active:cursor-grabbing hover:border-accent/40 transition-all ${
                    draggedId === lead._id ? 'opacity-40 scale-95' : ''
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <p className="text-sm font-semibold text-t1 leading-tight">{lead.name}</p>
                    {lead.source && (
                      <span className={`text-xs px-1.5 py-0.5 rounded-md font-medium ml-2 flex-shrink-0 ${
                        SOURCE_COLORS[lead.source] || 'bg-muted text-t2'
                      }`}>
                        {lead.source.replace('_', ' ')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-t2 mb-2">{lead.phone}</p>
                  {(lead.intendedCountry || lead.intendedCourse) && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {lead.intendedCountry && (
                        <span className="text-xs bg-muted text-t2 px-1.5 py-0.5 rounded-md">
                          {lead.intendedCountry}
                        </span>
                      )}
                      {lead.intendedCourse && (
                        <span className="text-xs bg-muted text-t2 px-1.5 py-0.5 rounded-md max-w-[140px] truncate">
                          {lead.intendedCourse}
                        </span>
                      )}
                    </div>
                  )}
                  {lead.assignedTo && (
                    <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-line">
                      <div className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 text-xs flex items-center justify-center font-medium">
                        {getInitials(typeof lead.assignedTo === 'string' ? lead.assignedTo : lead.assignedTo.name)}
                      </div>
                      <span className="text-xs text-t3 truncate">
                        {typeof lead.assignedTo === 'string' ? lead.assignedTo : lead.assignedTo.name}
                      </span>
                    </div>
                  )}
                </div>
              ))}

              {colLeads.length === 0 && (
                <div className={`h-20 flex items-center justify-center border-2 border-dashed rounded-xl text-xs text-t3 transition-colors ${
                  isOver ? 'border-accent/40 text-accent' : 'border-line'
                }`}>
                  {isOver ? 'Drop here' : 'No leads'}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
