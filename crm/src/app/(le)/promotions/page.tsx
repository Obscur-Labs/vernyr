'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { download } from '@/le/api';
import { showError } from '@/le/ui';
import { Claims, PromotionsList, Referrals } from '@/le/promotions';
import { Companies, Store, WalletRequests, WalletSettings, Wallets } from '@/le/wallet';

const TABS: [string, string][] = [['promotions', 'Promotions'], ['referrals', 'Referrals'], ['wallet', 'Wallet requests'], ['wallets', 'Student wallets'], ['store', 'Voucher store'], ['companies', 'Partner companies'], ['wsettings', 'Wallet settings']];

// The client's Promotions and wallet (legacy/public/js/pages/promotions.js, wallet.js)
function Promotions() {
  const q = useSearchParams();
  const tab = q.get('tab') || 'promotions';
  const claims = q.get('claims');
  const [add, setAdd] = useState(0);
  let body: React.ReactNode;
  if (tab === 'referrals') body = <Referrals promo={q.get('promo') ?? undefined} />;
  else if (tab === 'wallet') body = <WalletRequests status={q.get('status') || 'Requested'} />;
  else if (tab === 'wallets') body = <Wallets />;
  else if (tab === 'store') body = <Store />;
  else if (tab === 'companies') body = <Companies />;
  else if (tab === 'wsettings') body = <WalletSettings />;
  else if (claims) body = <Claims id={claims} />;
  else body = <PromotionsList addSignal={add} />;
  return (
    <>
      <div className="page-head"><div><h1>Promotions and wallet</h1><div className="sub">Students get an in-app notice only (no email), if they said yes to &quot;News and offers&quot;.</div></div><span className="grow" />
        {tab === 'promotions' && !claims ? <>
          <button className="btn" onClick={() => download('/admin/vouchers/sample.pdf', 'La-Europa-voucher-sample.pdf').catch(showError)}>Sample voucher</button>
          <button className="btn primary" onClick={() => setAdd((n) => n + 1)}>+ New promotion</button>
        </> : null}</div>
      <div className="seg-tabs" style={{ marginBottom: 14, flexWrap: 'wrap' }}>{TABS.map(([k, l]) => <Link key={k} href={`/promotions?tab=${k}`} className={k === tab ? 'on' : ''}>{l}</Link>)}</div>
      {body}
    </>
  );
}
export default function Page() { return <Suspense><Promotions /></Suspense>; }
