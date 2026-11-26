'use client';

import { use } from 'react';
import { Offers } from '@/le/extras';

// The client's Offers (legacy/public/portal/js/offers.js); /offers/<id> opens on that offer
export default function Page({ params }: { params: Promise<{ id?: string[] }> }) { return <Offers focus={use(params).id?.[0]} />; }
