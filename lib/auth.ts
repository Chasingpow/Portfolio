import { NextAuthOptions } from "next-auth"
import DiscordProvider from "next-auth/providers/discord"
import { supabase } from "@/lib/supabase"

const GUILD_ID = "1477501241159585814"

export const authOptions: NextAuthOptions = {
  providers: [
    DiscordProvider({
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
      authorization: { params: { scope: "identify guilds" } },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (!account?.access_token) return false

      // Check if user is a member of the required Discord server
      const res = await fetch(
        `https://discord.com/api/users/@me/guilds`,
        { headers: { Authorization: `Bearer ${account.access_token}` } }
      )
      if (!res.ok) return false

      const guilds: { id: string }[] = await res.json()
      const isMember = guilds.some(g => g.id === GUILD_ID)
      if (!isMember) return "/not-authorized"

      // Upsert user in Supabase
      await supabase.from("users").upsert({
        discord_id: user.id,
        display_name: user.name,
        avatar: user.image,
      }, { onConflict: "discord_id" })

      return true
    },

    async jwt({ token, account, user }) {
      if (account) {
        token.discordId = user.id
        token.accessToken = account.access_token
      }
      return token
    },

    async session({ session, token }) {
      session.user.discordId = token.discordId as string
      return session
    },
  },
  pages: {
    signIn: "/",
    error: "/not-authorized",
  },
  secret: process.env.NEXTAUTH_SECRET,
}
