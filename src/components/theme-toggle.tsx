import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "./theme-provider";
import { useServerFn } from "@tanstack/react-start";
import { upsertUserSettings } from "@/lib/user-settings.functions";

export function ThemeToggle() {
  const { resolved, setTheme } = useTheme();
  const save = useServerFn(upsertUserSettings);
  const next = resolved === "dark" ? "light" : "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => {
        setTheme(next);
        save({ data: { theme: next } }).catch(() => {});
      }}
    >
      {resolved === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
