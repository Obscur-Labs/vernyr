import { redirect } from 'next/navigation';

// old links to /home land on the client's Home
export default function Page() { redirect('/dashboard'); }
