import { Link } from "react-router-dom";
import { Logo } from "@/components/logo";
import { getHomePath, type NavigationScope } from "@/lib/navigation";

export function AuthMark({ label, scope = "public" }: { label: string; scope?: NavigationScope }) {
  return (
    <div className="mb-4 flex flex-col items-start">
      <Link to={getHomePath(scope)}>
        <Logo size={88} />
      </Link>
      <p className="mt-0.5 text-[17px] font-semibold tracking-[-0.01em] text-muted-foreground">{label}</p>
    </div>
  );
}
