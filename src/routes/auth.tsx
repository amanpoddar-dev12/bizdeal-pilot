import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const { mode } = useSearch({ from: "/auth" });
  const navigate = useNavigate();
  const [tab, setTab] = useState(mode === "signup" ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [signInRole, setSignInRole] = useState<"client" | "employee">("client");
  const [signUpRole, setSignUpRole] = useState<"client" | "employee">("client");
  const [busy, setBusy] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setBusy(false);
      return toast.error(error.message);
    }
    const userId = data.user?.id;
    if (userId) {
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
      const roleSet = new Set((roles ?? []).map((r) => r.role));
      const actual = roleSet.has("admin") ? "admin" : roleSet.has("employee") ? "employee" : "client";
      // Admins can sign in from either tab. Other roles must match the selected role.
      if (actual !== "admin" && actual !== signInRole) {
        await supabase.auth.signOut();
        setBusy(false);
        return toast.error(
          `This account is registered as ${actual}. Please select "${actual}" to sign in.`,
        );
      }
    }
    setBusy(false);
    toast.success(t("auth.signedIn"));
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
    toast.success(t("auth.checkEmail"));
    setSignInRole("client");
    setTab("signin");
  }

  async function forgotPassword() {
    if (!email) return toast.error(t("auth.enterEmailFirst"));
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + "/reset-password",
    });
    if (error) return toast.error(error.message);
    toast.success(t("auth.resetSent"));
  }

  function fillDemo(role: "admin" | "employee" | "client") {
    setEmail(`${role}@demo.com`);
    setPassword("Demo1234!");
    setTab("signin");
    if (role !== "admin") setSignInRole(role);
  }

  const RoleSelector = ({
    value,
    onChange,
  }: {
    value: "client" | "employee";
    onChange: (v: "client" | "employee") => void;
  }) => (
    <div className="space-y-2">
      <Label>{t("auth.role")}</Label>
      <div className="grid grid-cols-2 gap-2">
        {(["client", "employee"] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => onChange(r)}
            className={`rounded-md border px-3 py-2 text-sm capitalize transition ${
              value === r
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {t(`auth.roles.${r}`)}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="grid min-h-screen place-items-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 grid size-10 place-items-center rounded-md bg-primary text-primary-foreground font-bold">K</div>
          <CardTitle className="font-display text-2xl">{t("auth.welcome")}</CardTitle>
          <CardDescription>{t("auth.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">{t("auth.signIn")}</TabsTrigger>
              <TabsTrigger value="signup">{t("auth.createAccount")}</TabsTrigger>
            </TabsList>

            <TabsContent value="signin">
              <form onSubmit={signIn} className="mt-4 space-y-4">
                <RoleSelector value={signInRole} onChange={setSignInRole} />
                <div className="space-y-2">
                  <Label htmlFor="email">{t("auth.email")}</Label>
                  <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">{t("auth.password")}</Label>
                    <button type="button" onClick={forgotPassword} className="text-xs text-primary hover:underline">{t("auth.forgot")}</button>
                  </div>
                  <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <Button className="w-full" type="submit" disabled={busy}>{busy ? t("auth.signingIn") : t("auth.signIn")}</Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={signUp} className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">{t("auth.fullName")}</Label>
                  <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email2">{t("auth.email")}</Label>
                  <Input id="email2" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password2">{t("auth.passwordHint")}</Label>
                  <Input id="password2" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <Button className="w-full" type="submit" disabled={busy}>{busy ? t("auth.creating") : t("auth.createAccount")}</Button>
                <p className="text-xs text-muted-foreground">{t("auth.roleNoteSelfServe")}</p>
              </form>
            </TabsContent>

          </Tabs>

          <div className="mt-6 rounded-md border border-dashed border-border bg-muted/40 p-3 text-xs">
            <p className="mb-2 font-medium text-foreground">{t("auth.demoTitle")}:</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => fillDemo("admin")}>Admin</Button>
              <Button size="sm" variant="secondary" onClick={() => fillDemo("employee")}>Employee</Button>
              <Button size="sm" variant="secondary" onClick={() => fillDemo("client")}>Client</Button>
            </div>
          </div>

          <div className="mt-4 text-center text-sm">
            <Link to="/" className="text-muted-foreground hover:text-foreground">{t("common.backHome")}</Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
