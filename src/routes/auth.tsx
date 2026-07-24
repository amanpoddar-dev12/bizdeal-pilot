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
import { Shield, Briefcase, User, ArrowLeft } from "lucide-react";

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

type Role = "admin" | "employee" | "client";

const ROLE_META: Record<Role, { icon: typeof Shield; titleKey: string; descKey: string }> = {
  admin: { icon: Shield, titleKey: "auth.roles.admin", descKey: "auth.roleDesc.admin" },
  employee: { icon: Briefcase, titleKey: "auth.roles.employee", descKey: "auth.roleDesc.employee" },
  client: { icon: User, titleKey: "auth.roles.client", descKey: "auth.roleDesc.client" },
};

function AuthPage() {
  const { t } = useTranslation();
  const { mode } = useSearch({ from: "/auth" });
  const navigate = useNavigate();
  const [role, setRole] = useState<Role | null>(null);
  const [tab, setTab] = useState(mode === "signup" ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (!role) return;
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
      if (actual !== role) {
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

  function fillDemo(r: Role) {
    setRole(r);
    setEmail(`${r}@demo.com`);
    setPassword("Demo1234!");
    setTab("signin");
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 grid size-10 place-items-center rounded-md bg-primary text-primary-foreground font-bold">K</div>
          <CardTitle className="font-display text-2xl">{t("auth.welcome")}</CardTitle>
          <CardDescription>
            {role ? t(ROLE_META[role].descKey, { defaultValue: t("auth.subtitle") }) : t("auth.subtitle")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!role ? (
            <div className="space-y-3">
              <p className="text-center text-sm text-muted-foreground">{t("auth.chooseRole", { defaultValue: "Continue as" })}</p>
              {(Object.keys(ROLE_META) as Role[]).map((r) => {
                const Icon = ROLE_META[r].icon;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    className="group flex w-full items-center gap-4 rounded-lg border border-border p-4 text-left transition hover:border-primary hover:bg-primary/5"
                  >
                    <div className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground group-hover:bg-primary group-hover:text-primary-foreground">
                      <Icon className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium capitalize">{t(ROLE_META[r].titleKey, { defaultValue: r })}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {t(ROLE_META[r].descKey, {
                          defaultValue:
                            r === "admin"
                              ? "Manage the workspace"
                              : r === "employee"
                                ? "Field sales & orders"
                                : "Order & pay on credit",
                        })}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setRole(null)}
                className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="size-3" /> {t("auth.changeRole", { defaultValue: "Change role" })}
              </button>
              <div className="mb-3 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
                {(() => {
                  const Icon = ROLE_META[role].icon;
                  return <Icon className="size-4 text-primary" />;
                })()}
                <span className="capitalize text-foreground">{t(ROLE_META[role].titleKey, { defaultValue: role })}</span>
              </div>

              <Tabs value={tab} onValueChange={setTab}>
                <TabsList className={`grid w-full ${role === "admin" ? "grid-cols-1" : "grid-cols-2"}`}>
                  <TabsTrigger value="signin">{t("auth.signIn")}</TabsTrigger>
                  {role !== "admin" && (
                    <TabsTrigger value="signup">{t("auth.createAccount")}</TabsTrigger>
                  )}
                </TabsList>

                <TabsContent value="signin">
                  <form onSubmit={signIn} className="mt-4 space-y-4">
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
                    {role === "admin" && (
                      <p className="text-xs text-muted-foreground">
                        {t("auth.adminInviteNote", { defaultValue: "Admin accounts are created by another admin from Settings." })}
                      </p>
                    )}
                  </form>
                </TabsContent>

                {role !== "admin" && (
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
                )}
              </Tabs>
            </>
          )}

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
