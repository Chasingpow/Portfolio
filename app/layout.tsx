import type { Metadata } from "next"
import "./globals.css"
import { SessionProviderWrapper } from "@/components/SessionProviderWrapper"

export const metadata: Metadata = {
  title: "FlowState Alpha",
  description: "Portfolio tracker — educational tool only, not investment advice.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProviderWrapper>{children}</SessionProviderWrapper>
      </body>
    </html>
  )
}
