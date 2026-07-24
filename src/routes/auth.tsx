import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { sendOtp, verifyOtp } from "@/lib/phone-auth.functions";
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
      { name: "description", content: "Sign in to your Kredix workspace with your phone number." },
      { property: "og:title", content: "Sign in — Kredix" },
      { property: "og:description", content: "Sign in to your Kredix workspace with your phone number." },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: searchSchema,
  component: AuthPage,
});

type Role = "admin" | "employee" | "client";
type Step = "phone" | "code";

const ROLE_META: Record<Role, { icon: typeof Shield; titleKey: string; descKey: string }> = {
  admin: { icon: Shield, titleKey: "auth.roles.admin", descKey: "auth.roleDesc.admin" },
  employee: { icon: Briefcase, titleKey: "auth.roles.employee", descKey: "auth.roleDesc.employee" },
  client: { icon: User, titleKey: "auth.roles.client", descKey: "auth.roleDesc.client" },
};

const phoneRegex = /^\+[1-9]\d{7,14}$/;

function AuthPage() {
  const { t } = useTranslation();
  const { mode } = useSearch({ from: "/auth" });
  const navigate = useNavigate();
  const send = useServerFn(sendOtp);
  const verify = useServerFn(verifyOtp);

  const [role, setRole] = useState<Role | null>(null);
  const [tab, setTab] = useState(mode === "signup" ? "signup" : "signin");
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const currentMode: "signin" | "signup" = role === "admin" ? "signin" : (tab as "signin" | "signup");

  function resetToPhone() {
    setStep("phone");
    setCode("");
  }

  function changeRole() {
    setRole(null);
    setStep("phone");
    setPhone("");
    setName("");
    setCode("");
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
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to send code");
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

              <Tabs value={tab} onValueChange={(v) => { setTab(v); resetToPhone(); }}>
                <TabsList className={`grid w-full ${role === "admin" ? "grid-cols-1" : "grid-cols-2"}`}>
                  <TabsTrigger value="signin">{t("auth.signIn")}</TabsTrigger>
                  {role !== "admin" && (
                    <TabsTrigger value="signup">{t("auth.createAccount")}</TabsTrigger>
                  )}
                </TabsList>

                <TabsContent value={tab}>
                  {step === "phone" ? (
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
                      {role !== "admin" && currentMode === "signin" && (
                        <p className="text-xs text-muted-foreground">
                          Don't have an account?{" "}
                          <button type="button" className="text-primary hover:underline" onClick={() => { setTab("signup"); resetToPhone(); }}>
                            Create one
                          </button>
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
                          className="text-primary hover:underline"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await send({ data: { phone, role, mode: currentMode } });
                              toast.success("Code resent");
                            } catch (err: any) {
                              toast.error(err?.message ?? "Failed to resend");
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Resend code
                        </button>
                      </div>
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
