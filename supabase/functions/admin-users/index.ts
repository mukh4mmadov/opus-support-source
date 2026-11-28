import { createClient } from "npm:@supabase/supabase-js@2";
import { handleAdminAction } from "../_shared/admin-users.ts";
import { cors, json, supabaseStore } from "../_shared/supabase-store.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: {
      headers: { Authorization: req.headers.get("Authorization") ?? "" },
    },
  });
  const { data: me } = await caller.rpc("get_me");
  if (me?.role !== "admin" && me?.role !== "manager")
    return json({ error: "FORBIDDEN" }, 403);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  try {
    const store = supabaseStore(admin, caller, me.id);
    return json(
      await handleAdminAction(
        store,
        Deno.env.get("PASSWORD_KEY")!,
        await req.json(),
        me.role,
      ),
    );
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
});
