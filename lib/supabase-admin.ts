import "server-only"

import { createClient, type WebSocketLikeConstructor } from "@supabase/supabase-js"
import WebSocket from "ws"

const supabaseUrl = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export function getSupabaseAdminClient() {
  if (!supabaseUrl || !serviceRoleKey) {
    return null
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    realtime: {
      transport: WebSocket as unknown as WebSocketLikeConstructor,
    },
  })
}
