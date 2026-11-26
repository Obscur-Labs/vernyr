import { redirect } from 'next/navigation';

// old links to the profile wizard open My information, as in the client
export default function Page() { redirect('/my-information'); }
