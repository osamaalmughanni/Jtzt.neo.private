import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";

export function AdminMenuPage() {
  const navigate = useNavigate();
  const { logoutAdmin } = useAuth();

  const items = [
    { to: "/admin/companies", title: "Companies" },
    { to: "/admin/company/create", title: "Create Company" }
  ];

  return (
    <div>
      <nav className="flex flex-col">
        {items.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="py-1.5 text-[1.7rem] font-semibold leading-[1.02] tracking-[-0.03em] text-foreground transition-opacity hover:opacity-60"
          >
            {item.title}
          </Link>
        ))}
      </nav>
      <div className="py-5">
        <div className="h-px w-8 bg-foreground/20" />
      </div>
      <button
        className="appearance-none border-0 bg-transparent p-0 py-1.5 text-left text-[1.7rem] font-semibold leading-[1.02] tracking-[-0.03em] text-foreground transition-opacity hover:opacity-60 focus:outline-none"
        onClick={() => {
          logoutAdmin();
          navigate("/admin/login");
        }}
        type="button"
      >
        Log out
      </button>
    </div>
  );
}
