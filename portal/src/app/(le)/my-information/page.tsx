'use client';

import { GET, POST, PUT } from '@/le/api';
import { InfoForm } from '@/le/InfoForm';
import { downloadConsent } from '@/le/Gate';
import { refreshMe, t } from '@/le/p';
import { toast } from '@/le/ui';

// The client's My information (legacy/public/portal/js/info.js): the one student information form, the same as in the CRM
export default function Page() {
  return (
    <div className="p-card"><div className="bd">
      <InfoForm mode="student" title={t('My information')}
        intro={t('Fill in your details once. Your La Europa counsellor uses them to find the right courses and prepare your university applications. You can save each part and come back later.')}
        load={() => GET('/info-form')} save={(k, b) => PUT('/info-form/' + k, b)}
        onSubmit={async () => { const r = await POST('/info-form/submit', { declaration: true }); toast(t(r?.message || 'Sent to your counsellor'), 'ok'); refreshMe().catch(() => {}); }} />
      <p className="small" style={{ marginBottom: 0 }}><a href="#" onClick={(e) => { e.preventDefault(); downloadConsent(); }}>⬇ {t('Download my signed consent (PDF)')}</a></p>
    </div></div>
  );
}
