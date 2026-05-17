import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { supabase } from "@/lib/supabase"

// GET — load all saved data for the current user
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.discordId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const id = session.user.discordId

  const [holdings, wildcards, projections] = await Promise.all([
    supabase.from("user_holdings").select("*").eq("discord_id", id),
    supabase.from("user_wildcards").select("*").eq("discord_id", id),
    supabase.from("user_projections").select("*").eq("discord_id", id),
  ])

  return NextResponse.json({
    holdings: holdings.data ?? [],
    wildcards: wildcards.data ?? [],
    projections: projections.data ?? [],
  })
}

// POST — save a single portfolio view's state
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.discordId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const id = session.user.discordId
  const body = await req.json()
  const { region, port_type, holdings, wildcards, projection } = body

  const ops: Promise<unknown>[] = []

  if (holdings !== undefined) {
    ops.push(supabase.from("user_holdings").upsert(
      { discord_id: id, region, port_type, holdings, updated_at: new Date().toISOString() },
      { onConflict: "discord_id,region,port_type" }
    ))
  }

  if (wildcards !== undefined) {
    ops.push(supabase.from("user_wildcards").upsert(
      { discord_id: id, region, port_type, wildcards, updated_at: new Date().toISOString() },
      { onConflict: "discord_id,region,port_type" }
    ))
  }

  if (projection !== undefined) {
    ops.push(supabase.from("user_projections").upsert(
      { discord_id: id, region, port_type, ...projection, updated_at: new Date().toISOString() },
      { onConflict: "discord_id,region,port_type" }
    ))
  }

  await Promise.all(ops)
  return NextResponse.json({ ok: true })
}
