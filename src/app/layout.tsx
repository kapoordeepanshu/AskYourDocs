import type { Metadata, Viewport } from 'next'

import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'AskYourDocs',
    template: '%s · AskYourDocs',
  },
  description:
    'Self-hosted document Q&A. Upload PDFs, Word documents, HTML, or a URL, then ask questions and get answers with verified citations from your own documents.',
  applicationName: 'AskYourDocs',
  robots: {
    // A self-hosted instance holds private documents. Anyone deliberately
    // running a public one can override this in their own fork.
    index: false,
    follow: false,
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#1a1b1e' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh">{children}</body>
    </html>
  )
}
