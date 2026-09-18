import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const internalEmail = (username: string) =>
  `${username.trim().toLowerCase()}@america-list.local`;

async function getAdminContext(req: Request, adminClient: any) {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return { error: "Sessão não encontrada.", status: 401 as const };
  }

  const token = authHeader.slice(7);
  const { data, error } = await adminClient.auth.getUser(token);
  if (error || !data?.user) {
    return { error: "Sessão inválida ou expirada.", status: 401 as const };
  }

  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("id, username, full_name, role, active")
    .eq("id", data.user.id)
    .single();

  if (
    profileError ||
    !profile ||
    profile.active !== true ||
    profile.role !== "Administrador"
  ) {
    return { error: "Acesso restrito ao Administrador.", status: 403 as const };
  }

  return { user: data.user, profile };
}

function validateUsername(username: string) {
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) {
    throw new Error(
      "Usuário inválido. Use 3 a 40 caracteres: letras, números, ponto, hífen ou sublinhado."
    );
  }
}

async function createUser(body: any, adminClient: any) {
  const username = String(body.username || "").trim();
  const full_name = String(body.full_name || "").trim();
  const password = String(body.password || "");
  const role = String(body.role || "");

  validateUsername(username);
  if (!full_name) throw new Error("Informe o nome completo.");
  if (password.length < 6) throw new Error("A senha deve ter pelo menos 6 caracteres.");
  if (!["Motorista", "Assistência", "Administrador"].includes(role)) {
    throw new Error("Nível de acesso inválido.");
  }

  const { data: existing } = await adminClient
    .from("profiles")
    .select("id")
    .ilike("username", username)
    .maybeSingle();

  if (existing) throw new Error("Este usuário já está cadastrado.");

  const email = internalEmail(username);
  const { data: created, error: createError } =
    await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username, full_name, role },
    });

  if (createError || !created?.user) {
    throw new Error(createError?.message || "Não foi possível criar o usuário.");
  }

  const userId = created.user.id;

  const { error: profileError } = await adminClient
    .from("profiles")
    .insert({
      id: userId,
      username,
      full_name,
      role,
      active: true,
    });

  if (profileError) {
    await adminClient.auth.admin.deleteUser(userId);
    throw new Error(profileError.message);
  }

  if (role === "Motorista") {
    const { error: driverError } = await adminClient
      .from("drivers")
      .insert({ name: full_name, user_id: userId, active: true });

    if (driverError) {
      await adminClient.from("profiles").delete().eq("id", userId);
      await adminClient.auth.admin.deleteUser(userId);
      throw new Error(driverError.message);
    }
  }

  return {
    success: true,
    user: {
      id: userId,
      email,
      username,
      full_name,
      role,
      active: true,
    },
  };
}

async function updateUser(body: any, actorId: string, adminClient: any) {
  const id = String(body.id || body.user_id || "").trim();
  const username = String(body.username || "").trim();
  const full_name = String(body.full_name || "").trim();
  const role = String(body.role || "");
  const password = body.password == null ? "" : String(body.password);

  if (!id) throw new Error("user_id é obrigatório.");
  validateUsername(username);
  if (!full_name) throw new Error("Informe o nome completo.");
  if (!["Motorista", "Assistência", "Administrador"].includes(role)) {
    throw new Error("Nível de acesso inválido.");
  }
  if (password && password.length < 6) {
    throw new Error("A senha deve ter pelo menos 6 caracteres.");
  }
  if (id === actorId && role !== "Administrador") {
    throw new Error(
      "O administrador atual não pode remover o próprio nível de Administrador."
    );
  }

  const { data: oldProfile, error: oldError } = await adminClient
    .from("profiles")
    .select("id, username, full_name, role, active")
    .eq("id", id)
    .single();

  if (oldError || !oldProfile) throw new Error("Usuário não encontrado.");

  const { data: conflict } = await adminClient
    .from("profiles")
    .select("id")
    .ilike("username", username)
    .neq("id", id)
    .maybeSingle();

  if (conflict) throw new Error("Este usuário já está cadastrado.");

  const { error: profileError } = await adminClient
    .from("profiles")
    .update({
      username,
      full_name,
      role,
      active: true,
    })
    .eq("id", id);

  if (profileError) throw new Error(profileError.message);

  const authPatch: any = {
    email: internalEmail(username),
    user_metadata: { username, full_name, role },
  };
  if (password) authPatch.password = password;

  const { error: authError } =
    await adminClient.auth.admin.updateUserById(id, authPatch);

  if (authError) throw new Error(authError.message);

  const { data: driver } = await adminClient
    .from("drivers")
    .select("id")
    .eq("user_id", id)
    .maybeSingle();

  if (role === "Motorista") {
    if (!driver) {
      const { error } = await adminClient
        .from("drivers")
        .insert({ name: full_name, user_id: id, active: true });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await adminClient
        .from("drivers")
        .update({ name: full_name, active: true })
        .eq("id", driver.id);
      if (error) throw new Error(error.message);
    }
  } else if (driver) {
    const { error } = await adminClient
      .from("drivers")
      .update({ active: false })
      .eq("id", driver.id);
    if (error) throw new Error(error.message);
  }

  const { data: updated, error: updatedError } = await adminClient
    .from("profiles")
    .select("id, username, full_name, role, active")
    .eq("id", id)
    .single();

  if (updatedError) throw new Error(updatedError.message);

  return { success: true, user: updated };
}

async function deleteUser(body: any, actorId: string, adminClient: any) {
  const id = String(body.id || body.user_id || "").trim();
  if (!id) throw new Error("user_id é obrigatório.");
  if (id === actorId) throw new Error("Você não pode excluir a própria conta.");

  const { data: driver } = await adminClient
    .from("drivers")
    .select("id")
    .eq("user_id", id)
    .maybeSingle();

  if (driver) {
    const { count, error } = await adminClient
      .from("service_orders")
      .select("id", { count: "exact", head: true })
      .eq("driver_id", driver.id);

    if (error) throw new Error(error.message);

    if ((count || 0) > 0) {
      await adminClient
        .from("drivers")
        .update({ active: false, user_id: null })
        .eq("id", driver.id);
    } else {
      await adminClient.from("drivers").delete().eq("id", driver.id);
    }
  }

  // Remove the profile first; service-role bypasses RLS.
  await adminClient.from("profiles").delete().eq("id", id);

  const { error } = await adminClient.auth.admin.deleteUser(id);
  if (error) throw new Error(error.message);

  return { success: true };
}

async function createDriver(body: any, adminClient: any) {
  const name = String(body.name || "").trim();
  const username = String(body.username || "").trim();
  if (!name) throw new Error("Informe o nome do motorista.");

  let user_id: string | null = null;
  if (username) {
    const { data: p, error } = await adminClient
      .from("profiles")
      .select("id, role, active")
      .ilike("username", username)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!p) throw new Error("Usuário vinculado não encontrado.");
    if (p.role !== "Motorista") {
      throw new Error("O usuário vinculado precisa ter nível Motorista.");
    }
    if (!p.active) throw new Error("O usuário vinculado está inativo.");

    user_id = p.id;

    const { data: existing } = await adminClient
      .from("drivers")
      .select("id")
      .eq("user_id", user_id)
      .maybeSingle();

    if (existing) throw new Error("Este usuário já possui um cadastro de motorista.");
  }

  const { data, error } = await adminClient
    .from("drivers")
    .insert({ name, user_id, active: true })
    .select("id, user_id, name, active")
    .single();

  if (error) throw new Error(error.message);
  return { success: true, driver: data };
}

async function updateDriver(body: any, adminClient: any) {
  const id = String(body.id || "").trim();
  const name = String(body.name || "").trim();
  const username = String(body.username || "").trim();

  if (!id || !name) throw new Error("Informe o nome do motorista.");

  let user_id: string | null = null;
  if (username) {
    const { data: p, error } = await adminClient
      .from("profiles")
      .select("id, role, active")
      .ilike("username", username)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!p) throw new Error("Usuário vinculado não encontrado.");
    if (p.role !== "Motorista") {
      throw new Error("O usuário vinculado precisa ter nível Motorista.");
    }
    if (!p.active) throw new Error("O usuário vinculado está inativo.");
    user_id = p.id;
  }

  const { data, error } = await adminClient
    .from("drivers")
    .update({ name, user_id })
    .eq("id", id)
    .select("id, user_id, name, active")
    .single();

  if (error) throw new Error(error.message);
  return { success: true, driver: data };
}

async function deleteDriver(body: any, adminClient: any) {
  const id = String(body.id || "").trim();
  if (!id) throw new Error("Motorista inválido.");

  const { count, error: countError } = await adminClient
    .from("service_orders")
    .select("id", { count: "exact", head: true })
    .eq("driver_id", id);

  if (countError) throw new Error(countError.message);

  if ((count || 0) > 0) {
    throw new Error(
      "Este motorista possui O.S. vinculadas e não pode ser excluído. Para preservar o histórico, inative o cadastro."
    );
  }

  const { error } = await adminClient.from("drivers").delete().eq("id", id);
  if (error) throw new Error(error.message);

  return { success: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Configuração segura da função incompleta." }, 500);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const auth = await getAdminContext(req, adminClient);
    if ("error" in auth) return json({ error: auth.error }, auth.status);

    const body = await req.json();
    const action = String(body.action || "");

    // Accept both the current app's action names and generic action names.
    if (action === "create_user" || action === "create") {
      return json(await createUser(body, adminClient), 201);
    }
    if (action === "update_user" || action === "update") {
      return json(await updateUser(body, auth.user.id, adminClient));
    }
    if (action === "delete_user" || action === "delete") {
      return json(await deleteUser(body, auth.user.id, adminClient));
    }
    if (action === "create_driver") {
      return json(await createDriver(body, adminClient), 201);
    }
    if (action === "update_driver") {
      return json(await updateDriver(body, adminClient));
    }
    if (action === "delete_driver") {
      return json(await deleteDriver(body, adminClient));
    }

    return json({ error: "Ação administrativa desconhecida." }, 400);
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : String(e) },
      400
    );
  }
});
