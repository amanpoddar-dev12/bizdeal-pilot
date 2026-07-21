import { createFileRoute } from "@tanstack/react-router";

// One-shot seed endpoint — idempotent. Creates demo admin/employee/client accounts
// plus a small set of realistic orders/invoices/payments so the app is populated
// on first load. Safe to call multiple times; exits early once admin exists.
export const Route = createFileRoute("/api/public/seed")({
  server: {
    handlers: {
      GET: async () => runSeed(),
      POST: async () => runSeed(),
    },
  },
});

async function runSeed() {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const DEMO_PASSWORD = "Demo1234!";

    // Per-user idempotent create
    const mkUser = async (email: string, name: string, phone: string) => {
      const { data: existing } = await supabaseAdmin.from("profiles").select("id").eq("email", email).maybeSingle();
      if (existing) {
        await supabaseAdmin.from("profiles").upsert({ id: existing.id, email, name, phone }, { onConflict: "id" });
        return existing.id;
      }
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email, password: DEMO_PASSWORD, email_confirm: true, user_metadata: { name },
      });
      if (error) throw error;
      const uid = data.user!.id;
      await supabaseAdmin.from("profiles").upsert({ id: uid, email, name, phone }, { onConflict: "id" });
      return uid;
    };

    const adminId = await mkUser("admin@demo.com", "Admin User", "+91 9800000001");
    const empId = await mkUser("employee@demo.com", "Ravi Kumar", "+91 9800000002");
    const clientId = await mkUser("client@demo.com", "Sunita Sharma", "+91 9800000003");

    await supabaseAdmin.from("user_roles").delete().in("user_id", [adminId, empId]);
    await supabaseAdmin.from("user_roles").insert([
      { user_id: adminId, role: "admin" },
      { user_id: empId, role: "employee" },
    ]);

    await supabaseAdmin.from("employee_profiles").upsert({
      id: empId, territory: "Mumbai West", order_limit: 200, max_order_value: 500000,
      base_salary: 45000, commission_rate: 0.025, active: true,
    }, { onConflict: "id" });

    let cli: any = null;
    const { data: existingCli } = await supabaseAdmin.from("clients").select("*").eq("user_id", clientId).maybeSingle();
    if (existingCli) {
      cli = existingCli;
    } else {
      const { data: newCli, error: cliErr } = await supabaseAdmin.from("clients").insert({
        user_id: clientId, business_name: "Sharma Traders Pvt Ltd", business_type: "Retail Distribution",
        contact_person: "Sunita Sharma", email: "client@demo.com", phone: "+91 9800000003",
        gst_number: "27ABCDE1234F1Z5", pan: "ABCDE1234F", address: "Andheri West, Mumbai 400058",
        credit_limit: 500000, credit_terms: 45, penalty_rate_per_day: 0.005,
        kyc_verified: true, active: true,
      }).select().single();
      if (cliErr) return Response.json({ ok: false, step: "clients", error: cliErr.message }, { status: 500 });
      cli = newCli;
    }

    if (cli) {
      const { count: existingOrders } = await supabaseAdmin.from("orders").select("*", { count: "exact", head: true }).eq("client_id", cli.id);
      if (!existingOrders || existingOrders === 0) {
      await supabaseAdmin.from("client_employees").insert({ client_id: cli.id, employee_id: empId });

      // Orders
      const { data: o1 } = await supabaseAdmin.from("orders").insert({
        client_id: cli.id, employee_id: empId, status: "confirmed", total_amount: 125000,
        delivery_date: new Date(Date.now() + 7 * 864e5).toISOString(),
        notes: "Standard monthly stock",
      }).select().single();

      const { data: o2 } = await supabaseAdmin.from("orders").insert({
        client_id: cli.id, employee_id: empId, status: "pending", total_amount: 84000,
        delivery_date: new Date(Date.now() + 14 * 864e5).toISOString(),
        notes: "New product line trial",
      }).select().single();

      const { data: o3 } = await supabaseAdmin.from("orders").insert({
        client_id: cli.id, employee_id: empId, status: "invoiced", total_amount: 210000,
        delivery_date: new Date(Date.now() - 30 * 864e5).toISOString(),
      }).select().single();

      if (o1) await supabaseAdmin.from("order_items").insert([
        { order_id: o1.id, product_name: "Basmati Rice 25kg", product_code: "RC-25", quantity: 50, rate: 2000, amount: 100000 },
        { order_id: o1.id, product_name: "Cooking Oil 15L", product_code: "OL-15", quantity: 25, rate: 1000, amount: 25000 },
      ]);
      if (o2) await supabaseAdmin.from("order_items").insert([
        { order_id: o2.id, product_name: "Wheat Flour 10kg", product_code: "WF-10", quantity: 120, rate: 700, amount: 84000 },
      ]);
      if (o3) await supabaseAdmin.from("order_items").insert([
        { order_id: o3.id, product_name: "Sugar 50kg", product_code: "SG-50", quantity: 60, rate: 3500, amount: 210000 },
      ]);

      // Invoices
      const in35Days = new Date(Date.now() + 35 * 864e5).toISOString();
      const overdueDate = new Date(Date.now() - 10 * 864e5).toISOString();

      const { data: inv1 } = await supabaseAdmin.from("invoices").insert({
        order_id: o1?.id, client_id: cli.id, amount: 125000, due_date: in35Days,
        status: "approved",
      }).select().single();

      const { data: inv2 } = await supabaseAdmin.from("invoices").insert({
        order_id: o3?.id, client_id: cli.id, amount: 210000, due_date: overdueDate,
        status: "partially_paid", payment_amount: 100000, penalty_amount: 5250,
      }).select().single();

      if (inv2) {
        await supabaseAdmin.from("payments").insert({
          invoice_id: inv2.id, client_id: cli.id, amount: 100000,
          method: "Bank Transfer", recorded_by: adminId,
        });
      }

      // Tasks
      await supabaseAdmin.from("tasks").insert([
        { employee_id: empId, assigned_by: adminId, title: "Visit Sharma Traders", description: "Discuss new SKUs and payment plan", due_date: new Date(Date.now() + 3 * 864e5).toISOString(), status: "todo" },
        { employee_id: empId, assigned_by: adminId, title: "Collect overdue payment", description: "Follow up on INV-1001", due_date: new Date(Date.now() + 1 * 864e5).toISOString(), status: "in_progress" },
      ]);

      // Notifications
      await supabaseAdmin.from("notifications").insert([
        { user_id: clientId, type: "order", title: "New order received", message: "Order for ₹1,25,000 pending your approval", reference_id: o1?.id ?? "" },
        { user_id: adminId, type: "system", title: "Demo data loaded", message: "Sample orders, invoices, and tasks are ready." },
      ]);
    }

    return Response.json({ ok: true, seeded: true, credentials: {
      admin: "admin@demo.com / " + DEMO_PASSWORD,
      employee: "employee@demo.com / " + DEMO_PASSWORD,
      client: "client@demo.com / " + DEMO_PASSWORD,
    }});
  } catch (e) {
    console.error("seed error", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}
