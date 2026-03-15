import { Link } from "react-router-dom";
import { Logo } from "@/components/logo";
import { getHomePath, type NavigationScope } from "@/lib/navigation";

export function AuthMark({ label, scope = "public" }: { label: string; scope?: NavigationScope }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <Link to={getHomePath(scope)}>
        <Logo size={88} />
      </Link>
      <p className="text-[17px] font-semibold tracking-[-0.01em] text-muted-foreground">{label}</p>
    </div>
  );
}
