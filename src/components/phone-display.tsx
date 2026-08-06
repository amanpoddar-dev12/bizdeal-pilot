import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { maskPhone } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Phone numbers are masked by default everywhere in the app.
 * Users with permission (admins, or the owner of the number) get an
 * explicit reveal toggle instead of a permanently exposed number.
 */
export function PhoneDisplay({
  phone,
  canReveal = false,
  className,
}: {
  phone?: string | null;
  canReveal?: boolean;
  className?: string;
}) {
  const [shown, setShown] = useState(false);
  if (!phone) return <span className={cn("tabular-nums", className)}>—</span>;

  return (
    <span className={cn("inline-flex items-center gap-1 tabular-nums", className)}>
      <span>{shown ? phone : maskPhone(phone)}</span>
      {canReveal && (
        <button
          type="button"
          aria-label={shown ? "Hide phone number" : "Reveal phone number"}
          className="text-muted-foreground transition-colors hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setShown((s) => !s);
          }}
        >
          {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
      )}
    </span>
  );
}
