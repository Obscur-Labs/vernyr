import { Shell } from '@/le/Shell';

// Screens ported from the client's CRM: their shell, their design (le-ui).
export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return <Shell>{children}</Shell>;
}
