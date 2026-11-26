import { redirect } from 'next/navigation';

/** Old reset links: passwords are reset with an emailed code now. */
export default function Reset() { redirect('/forgot'); }
