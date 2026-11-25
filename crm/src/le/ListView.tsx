'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { store } from './format';
import { Modal, openOverlay, toast } from './ui';
import { Options } from './form';

/** The client's listView (legacy/public/js/core.js): sort, pagination, column show / hide, saved views, selection. */

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Column<R> { k: string; label: string; sort?: string; hide?: boolean; render?: (r: R) => React.ReactNode }
export interface ListHandle { reload: () => void; clearSelection: () => void }
type Filters = Record<string, string>;

interface Props<R> {
  listKey: string; columns: Column<R>[]; fetch: (p: Record<string, unknown>) => Promise<{ rows: R[]; total?: number }>;
  filters?: Filters; setFilters?: (f: Filters) => void; filtersUi?: React.ReactNode; toolbar?: React.ReactNode; chips?: React.ReactNode;
  sort?: string; dir?: 'asc' | 'desc'; rowClass?: (r: R) => string; onRow?: (r: R) => void;
  selectable?: boolean; onSelect?: (ids: string[]) => void; empty?: string; noPaging?: boolean;
}

function ListViewInner<R extends { id: string }>(p: Props<R>, ref: React.Ref<ListHandle>) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(store.get<string[] | null>('cols:' + p.listKey, null) ?? p.columns.filter((c) => c.hide).map((c) => c.k)));
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(() => store.get('size:' + p.listKey, 25));
  const [sort, setSort] = useState({ sort: p.sort ?? '', dir: p.dir ?? 'asc' });
  const [data, setData] = useState<{ rows: R[]; total: number } | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [colsOpen, setColsOpen] = useState(false);
  const seq = useRef(0);
  const filtersJson = JSON.stringify(p.filters ?? {});

  const load = useCallback(async () => {
    const n = ++seq.current;
    setError('');
    try {
      const d = await p.fetch({ page, size, ...sort, ...(p.filters ?? {}) });
      if (n === seq.current) setData({ rows: d.rows ?? [], total: d.total ?? (d.rows ?? []).length });
    } catch (e) { if (n === seq.current) setError((e as Error).message); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, size, sort.sort, sort.dir, filtersJson]);

  // search boxes type fast: wait a moment before asking the server
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { setPage(1); }, [filtersJson]);
  useImperativeHandle(ref, () => ({ reload: load, clearSelection: () => { setSelected(new Set()); p.onSelect?.([]); } }), [load, p]);

  const toggleSel = (id: string, on: boolean) => {
    const n = new Set(selected); if (on) n.add(id); else n.delete(id);
    setSelected(n); p.onSelect?.([...n]);
  };
  const cols = p.columns.filter((c) => !hidden.has(c.k));
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / size));

  const views = () => {
    const list = store.get<{ name: string; vals: Filters }[]>('views:' + p.listKey, []);
    openOverlay((close) => <ViewsModal list={list} close={close} current={p.filters ?? {}} listKey={p.listKey} apply={(v) => { p.setFilters?.(v); close(); }} />);
  };

  return (
    <div className="card">
      {p.filtersUi ? (
        <div className="filters">
          {p.filtersUi}
          <span className="grow" />
          {p.toolbar}
          <div className="usermenu" style={{ position: 'relative' }}>
            <button className="btn sm" type="button" title="Show / hide columns" onClick={() => setColsOpen(!colsOpen)}>Columns</button>
            {colsOpen ? (
              <div className="menu" onMouseLeave={() => setColsOpen(false)}>
                {p.columns.map((c) => (
                  <label key={c.k} style={{ display: 'flex', gap: 8, padding: '6px 8px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={!hidden.has(c.k)} onChange={(e) => {
                      const n = new Set(hidden); if (e.target.checked) n.delete(c.k); else n.add(c.k);
                      setHidden(n); store.set('cols:' + p.listKey, [...n]);
                    }} />{c.label}
                  </label>
                ))}
              </div>
            ) : null}
          </div>
          {p.setFilters ? <button className="btn sm" type="button" title="Saved filters" onClick={views}>My views</button> : null}
        </div>
      ) : null}
      <div className="chips">{p.chips}</div>
      <div className="table-wrap">
        {error ? <div className="empty">{error}</div> : !data ? <div className="empty">Loading...</div> : !rows.length ? <div className="empty">{p.empty ?? 'No records found'}</div> : (
          <table className="t cards">
            <thead><tr>
              {p.selectable ? <th className="chk"><input type="checkbox" checked={rows.length > 0 && rows.every((r) => selected.has(r.id))}
                onChange={(e) => { const n = new Set(selected); rows.forEach((r) => (e.target.checked ? n.add(r.id) : n.delete(r.id))); setSelected(n); p.onSelect?.([...n]); }} /></th> : null}
              {cols.map((c) => (
                <th key={c.k} className={c.sort ? 'sortable' : ''} onClick={c.sort ? () => setSort((s) => ({ sort: c.sort!, dir: s.sort === c.sort && s.dir !== 'desc' ? 'desc' : 'asc' })) : undefined}>
                  {c.label}{c.sort && sort.sort === c.sort ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
                </th>
              ))}
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`${p.onRow ? 'click ' : ''}${p.rowClass?.(r) ?? ''}`}
                  onClick={(e) => { if ((e.target as HTMLElement).closest('input,button,a,select')) return; p.onRow?.(r); }}>
                  {p.selectable ? <td className="chk"><input type="checkbox" checked={selected.has(r.id)} onChange={(e) => toggleSel(r.id, e.target.checked)} /></td> : null}
                  {cols.map((c) => <td key={c.k} data-label={c.label}>{c.render ? c.render(r) : String((r as Record<string, unknown>)[c.k] ?? '')}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="pager">
        <span>{total} record{total === 1 ? '' : 's'}</span><span className="grow" />
        {p.noPaging ? null : <>
          <span>Rows</span>
          <select value={size} onChange={(e) => { const s = Number(e.target.value); setSize(s); store.set('size:' + p.listKey, s); setPage(1); }}><Options list={['25', '50', '100']} /></select>
          <button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <span>Page {page} of {pages}</span>
          <button className="btn sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </>}
      </div>
    </div>
  );
}
export const ListView = forwardRef(ListViewInner) as <R extends { id: string }>(p: Props<R> & { ref?: React.Ref<ListHandle> }) => React.ReactElement;

function ViewsModal({ list, close, current, listKey, apply }: { list: { name: string; vals: Filters }[]; close: () => void; current: Filters; listKey: string; apply: (v: Filters) => void }) {
  const [name, setName] = useState('');
  const [views, setViews] = useState(list);
  const save = (v: typeof views) => { setViews(v); store.set('views:' + listKey, v); };
  return (
    <Modal title="My views (saved filters)" size="sm" close={close}>
      <div className="stack">
        <div className="row">
          <input className="input grow" placeholder="Name for current filters" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn primary" onClick={() => { if (!name.trim()) return; save([...views, { name: name.trim(), vals: current }]); toast('View saved', 'ok'); close(); }}>Save</button>
        </div>
        <ul className="list-plain">
          {views.length ? views.map((v, i) => (
            <li key={i}><a href="#" className="grow" onClick={(e) => { e.preventDefault(); apply(v.vals); }}>{v.name}</a>
              <button className="btn xs danger" onClick={() => save(views.filter((_, j) => j !== i))}>Delete</button></li>
          )) : <li className="muted">No saved views yet</li>}
        </ul>
      </div>
    </Modal>
  );
}
