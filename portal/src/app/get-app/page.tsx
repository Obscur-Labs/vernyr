'use client';

import '@/styles/le-fonts.css';
import '@/styles/le-ui.css';
import { GetApp } from '@/le/getapp';
import { UiHost } from '@/le/ui';

// The client's public "Get the Vernyr app" page (no login needed)
export default function Page() { return <div className="le-ui portal"><GetApp /><UiHost /></div>; }
