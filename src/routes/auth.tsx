import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

const searchSchema = z.object({ mode: z.enum(["signin", "signup"]).optional() });

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Kredix" },
      { name: "description", content: "Sign in to your Kredix workspace." },
      { property: "og:title", content: "Sign in — Kredix" },
      { property: "og:description", content: "Sign in to your Kredix workspace." },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: searchSchema,
  component: AuthPage,
});

function AuthPage() {
  const { mode } = useSearch({ from: "/auth" });
  const navigate = useNavigate();
  const [tab, setTab] = useState(mode === "signup" ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Signed in");
    navigate({ to: "/dashboard" });
  }

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return toast.error("Password must be at least 8 characters");
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { data: { name }, emailRedirectTo: window.location.origin + "/dashboard" },
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Check your email to confirm your account.");
    setTab("signin");
  }

  async function forgotPassword() {
    if (!email) return toast.error("Enter your email first");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + "/reset-password",
    });
    if (error) return toast.error(error.message);
    toast.success("Reset link sent to your email");
  }

  function fillDemo(role: "admin" | "employee" | "client") {
    setEmail(`${role}@demo.com`);
    setPassword("Demo1234!");
    setTab("signin");
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 grid size-10 place-items-center rounded-md bg-primary text-primary-foreground font-bold">K</div>
          <CardTitle className="font-display text-2xl">Welcome to Kredix</CardTitle>
          <CardDescription>Manage clients, orders, invoices, and credit in one place.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>

            <TabsContent value="signin">
              <form onSubmit={signIn} className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    <button type="button" onClick={forgotPassword} className="text-xs text-primary hover:underline">Forgot?</button>
                  </div>
                  <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <Button className="w-full" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={signUp} className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Full name</Label>
                  <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email2">Email</Label>
                  <Input id="email2" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password2">Password (min 8 chars)</Label>
                  <Input id="password2" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <Button className="w-full" type="submit" disabled={busy}>{busy ? "Creating…" : "Create account"}</Button>
                <p className="text-xs text-muted-foreground">
                  New accounts start with the <strong>client</strong> role. An admin can promote you to employee/admin.
                </p>
              </form>
            </TabsContent>
          </Tabs>

          <div className="mt-6 rounded-md border border-dashed border-border bg-muted/40 p-3 text-xs">
            <p className="mb-2 font-medium text-foreground">Demo accounts (run{" "}
              <a className="underline" href="/api/public/seed" target="_blank" rel="noreferrer">/api/public/seed</a>{" "}first):</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => fillDemo("admin")}>Admin</Button>
              <Button size="sm" variant="secondary" onClick={() => fillDemo("employee")}>Employee</Button>
              <Button size="sm" variant="secondary" onClick={() => fillDemo("client")}>Client</Button>
            </div>
          </div>

          <div className="mt-4 text-center text-sm">
            <Link to="/" className="text-muted-foreground hover:text-foreground">← Back home</Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
