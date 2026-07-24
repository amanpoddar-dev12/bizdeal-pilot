import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { sendOtp, verifyOtp } from "@/lib/phone-auth.functions";
import { demoSignIn } from "@/lib/demo-auth.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Shield, Briefcase, User, ArrowLeft, Mail, Phone } from "lucide-react";

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
type Step = "phone" | "code";
type Method = "phone" | "email";

const ROLE_META: Record<Role, { icon: typeof Shield; titleKey: string; descKey: string }> = {
  admin: { icon: Shield, titleKey: "auth.roles.admin", descKey: "auth.roleDesc.admin" },
  employee: { icon: Briefcase, titleKey: "auth.roles.employee", descKey: "auth.roleDesc.employee" },
  client: { icon: User, titleKey: "auth.roles.client", descKey: "auth.roleDesc.client" },
};

const phoneRegex = /^\+[1-9]\d{7,14}$/;
const RESEND_SECONDS = 30;

function AuthPage() {
  const { t } = useTranslation();
  const { mode } = useSearch({ from: "/auth" });
  const navigate = useNavigate();
  const send = useServerFn(sendOtp);
  const verify = useServerFn(verifyOtp);
  const demo = useServerFn(demoSignIn);

  const [role, setRole] = useState<Role | null>(null);
  const [tab, setTab] = useState(mode === "signup" ? "signup" : "signin");
  const [method, setMethod] = useState<Method>("phone");
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const currentMode: "signin" | "signup" = role === "admin" ? "signin" : (tab as "signin" | "signup");

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  function resetToPhone() {
    setStep("phone");
    setCode("");
  }

  function changeRole() {
    setRole(null);
    setStep("phone");
    setPhone("");
    setEmail("");
    setPassword("");
    setName("");
    setCode("");
    setCooldown(0);
  }

  async function onSendCode(e: React.FormEvent) {
    e.preventDefault();
    if (!role) return;
    if (!phoneRegex.test(phone)) {
      return toast.error("Enter a phone number in E.164 format, e.g. +14155552671");
    }
    if (currentMode === "signup" && name.trim().length < 2) {
      return toast.error("Please enter your full name");
    }
    setBusy(true);
    try {
      await send({ data: { phone, role, mode: currentMode } });
      toast.success("Verification code sent");
      setStep("code");
      setCooldown(RESEND_SECONDS);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to send code");
    } finally {
      setBusy(false);
    }
  }

  async function onResend() {
    if (!role || cooldown > 0 || busy) return;
    setBusy(true);
    try {
      await send({ data: { phone, role, mode: currentMode } });
      toast.success("Code resent");
      setCooldown(RESEND_SECONDS);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to resend");
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!role) return;
    if (code.trim().length < 4) return toast.error("Enter the code you received");
    setBusy(true);
    try {
      const res = await verify({
        data: {
          phone,
          code: code.trim(),
          role,
          mode: currentMode,
          name: currentMode === "signup" ? name.trim() : undefined,
        },
      });
      const { error } = await supabase.auth.setSession({
        access_token: res.access_token,
        refresh_token: res.refresh_token,
      });
      if (error) throw error;
      toast.success(t("auth.signedIn"));
      navigate({ to: "/dashboard" });
    } catch (err: any) {
      toast.error(err?.message ?? "Verification failed");
    } finally {
      setBusy(false);
    }
  }

  async function onEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!role) return;
    if (!email || password.length < 8) return toast.error("Enter email and a password of at least 8 characters");
    setBusy(true);
    try {
      if (currentMode === "signup") {
        if (role === "admin") throw new Error("Admin accounts are created by another admin.");
        if (name.trim().length < 2) throw new Error("Please enter your full name");
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { name: name.trim() },
          },
        });
        if (error) throw error;
        if (!data.session) {
          toast.success("Check your email to verify your account, then sign in.");
          setTab("signin");
          setPassword("");
          return;
        }
        toast.success(t("auth.signedIn"));
        navigate({ to: "/dashboard" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success(t("auth.signedIn"));
        navigate({ to: "/dashboard" });
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle() {
    setBusy(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) throw result.error;
      if (result.redirected) return;
      toast.success(t("auth.signedIn"));
      navigate({ to: "/dashboard" });
    } catch (err: any) {
      toast.error(err?.message ?? "Google sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function onDemo(r: Role) {
    setBusy(true);
    try {
      const res = await demo({ data: { role: r } });
      const { error } = await supabase.auth.setSession({
        access_token: res.access_token,
        refresh_token: res.refresh_token,
      });
      if (error) throw error;
      toast.success(`Signed in as demo ${r}`);
      navigate({ to: "/dashboard" });
    } catch (err: any) {
      toast.error(err?.message ?? "Demo sign-in failed");
    } finally {
      setBusy(false);
    }
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

              <div className="relative py-2">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">Dev demo (remove later)</span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(ROLE_META) as Role[]).map((r) => (
                  <Button key={r} variant="outline" size="sm" disabled={busy} onClick={() => onDemo(r)}>
                    {t(ROLE_META[r].titleKey, { defaultValue: r })}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={changeRole}
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

              <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={onGoogle}>
                <svg className="mr-2 size-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                Continue with Google
              </Button>

              <div className="relative py-4">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">or</span>
                </div>
              </div>

              <Tabs value={tab} onValueChange={(v) => { setTab(v); resetToPhone(); setPassword(""); }}>
                <TabsList className={`grid w-full ${role === "admin" ? "grid-cols-1" : "grid-cols-2"}`}>
                  <TabsTrigger value="signin">{t("auth.signIn")}</TabsTrigger>
                  {role !== "admin" && (
                    <TabsTrigger value="signup">{t("auth.createAccount")}</TabsTrigger>
                  )}
                </TabsList>

                <TabsContent value={tab}>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Button type="button" size="sm" variant={method === "phone" ? "default" : "outline"} onClick={() => { setMethod("phone"); resetToPhone(); }}>
                      <Phone className="mr-1 size-3.5" /> Phone
                    </Button>
                    <Button type="button" size="sm" variant={method === "email" ? "default" : "outline"} onClick={() => setMethod("email")}>
                      <Mail className="mr-1 size-3.5" /> Email
                    </Button>
                  </div>

                  {method === "phone" ? (
                    step === "phone" ? (
                    <form onSubmit={onSendCode} className="mt-4 space-y-4">
                      {currentMode === "signup" && (
                        <div className="space-y-2">
                          <Label htmlFor="name">{t("auth.fullName")}</Label>
                          <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
                        </div>
                      )}
                      <div className="space-y-2">
                        <Label htmlFor="phone">Phone number</Label>
                        <Input
                          id="phone"
                          type="tel"
                          required
                          placeholder="+14155552671"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">Include country code. We'll text you a verification code.</p>
                      </div>
                      <Button className="w-full" type="submit" disabled={busy}>
                        {busy ? "Sending…" : "Send code"}
                      </Button>
                      {role === "admin" && (
                        <p className="text-xs text-muted-foreground">
                          {t("auth.adminInviteNote", { defaultValue: "Admin accounts are created by another admin from Settings." })}
                        </p>
                      )}
                    </form>
                  ) : (
                    <form onSubmit={onVerify} className="mt-4 space-y-4">
                      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
                        Code sent to <span className="font-medium text-foreground">{phone}</span>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="code">Verification code</Label>
                        <Input
                          id="code"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          required
                          value={code}
                          onChange={(e) => setCode(e.target.value)}
                        />
                      </div>
                      <Button className="w-full" type="submit" disabled={busy}>
                        {busy ? "Verifying…" : currentMode === "signup" ? "Create account" : "Sign in"}
                      </Button>
                      <div className="flex items-center justify-between text-xs">
                        <button type="button" className="text-muted-foreground hover:text-foreground" onClick={resetToPhone}>
                          Change phone
                        </button>
                        <button
                          type="button"
                          className="text-primary hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
                          disabled={busy || cooldown > 0}
                          onClick={onResend}
                        >
                          {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                        </button>
                      </div>
                    </form>
                  )
                  ) : (
                    <form onSubmit={onEmailSubmit} className="mt-4 space-y-4">
                      {currentMode === "signup" && role !== "admin" && (
                        <div className="space-y-2">
                          <Label htmlFor="ename">{t("auth.fullName")}</Label>
                          <Input id="ename" required value={name} onChange={(e) => setName(e.target.value)} />
                        </div>
                      )}
                      <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="password">Password</Label>
                        <Input id="password" type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
                        {currentMode === "signup" && (
                          <p className="text-xs text-muted-foreground">We'll email a verification link before you can sign in.</p>
                        )}
                      </div>
                      <Button className="w-full" type="submit" disabled={busy}>
                        {busy ? "Please wait…" : currentMode === "signup" ? "Create account" : "Sign in"}
                      </Button>
                    </form>
                  )}
                </TabsContent>
              </Tabs>
            </>
          )}

          <div className="mt-6 text-center text-sm">
            <Link to="/" className="text-muted-foreground hover:text-foreground">{t("common.backHome")}</Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
