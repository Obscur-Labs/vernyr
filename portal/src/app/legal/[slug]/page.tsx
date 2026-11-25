import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LEGAL_PAGES, readLegal, toHtml } from '@/lib/legalMd';
import '@/styles/le-fonts.css';
import '@/styles/le-ui.css';

// La Europa's legal documents, rendered once at build time from src/legal/*.md
export const dynamicParams = false;
export function generateStaticParams() {
  return LEGAL_PAGES.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = LEGAL_PAGES.find((p) => p.slug === slug);
  return { title: page ? `${page.title} | La Europa Education` : 'Not found' };
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = LEGAL_PAGES.find((p) => p.slug === slug);
  if (!page) notFound();
  const { html } = toHtml(readLegal(page.file));
  return (
    <div className="le-ui portal" style={{ minHeight: '100vh', background: 'var(--white)' }}>
      <main style={{ maxWidth: 860, margin: '0 auto', padding: '32px 20px 64px' }}>
        <p className="small" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 20 }}>
          <Link href="/login">Back to login</Link>
          {LEGAL_PAGES.filter((p) => p.slug !== page.slug).map((p) => <Link key={p.slug} href={`/legal/${p.slug}`}>{p.title}</Link>)}
        </p>
        <div className="legal-md" dangerouslySetInnerHTML={{ __html: html }} />
      </main>
    </div>
  );
}
