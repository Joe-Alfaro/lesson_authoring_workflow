import type { Metadata } from 'next'
import { Atkinson_Hyperlegible_Next, Literata } from 'next/font/google'
import type { ReactNode } from 'react'
import './globals.css'

// Typefaces from docs/design/STYLE.md: Atkinson for the interface, Literata for reading text.
const ui = Atkinson_Hyperlegible_Next({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-ui',
})
const read = Literata({
  subsets: ['latin'],
  weight: ['400', '600'],
  style: ['normal', 'italic'],
  variable: '--font-read',
})

export const metadata: Metadata = {
  title: 'Lesson Studio',
  description: 'Generate, review and approve standards-aligned lessons.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${ui.variable} ${read.variable}`}>
      <body>{children}</body>
    </html>
  )
}
