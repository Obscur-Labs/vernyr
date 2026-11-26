'use client';

import { M, useMeta } from '@/le/meta';
import { CataloguePage } from '@/le/catalogue';

// The client's #/catalogue: the same course catalogue as Admin Settings, on its own
export default function Page() {
  const me = useMeta((s) => s.me);
  if (!me) return <div className="empty">Loading...</div>;
  if (!M.admin()) return <div className="card"><div className="bd empty">You do not have access to this record</div></div>;
  return <><div className="page-head"><h1>Course catalogue</h1></div><CataloguePage /></>;
}
