import { Link, useNavigate } from "react-router-dom";
import { FormPage } from "@/components/form-layout";
import { PageLabel } from "@/components/page-label";
import { useAuth } from "@/lib/auth";

export function MenuPage() {
  const navigate = useNavigate();
  const { companyIdentity, logoutCompany } = useAuth();

  const items = [
    { to: "/dashboard", title: "Dashboard" },
    { to: "/projects", title: "Projects" },
    ...(companyIdentity?.user.role === "admin"
      ? [
          { to: "/users", title: "Users" },
          { to: "/settings", title: "Settings" }
        ]
      : [])
  ];

  return (
    <FormPage>
      <PageLabel title="Pages" description="Open the main areas of the workspace." />
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
          logoutCompany();
          navigate("/login");
        }}
        type="button"
      >
        Log out
      </button>
    </FormPage>
  );
}
