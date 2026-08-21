import { AppNav } from '@/components/app-nav'
import { requirePageUser } from '@/lib/auth'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser()

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <AppNav user={user} />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  )
}
