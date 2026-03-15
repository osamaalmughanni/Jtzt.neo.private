import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { CompanyUserListItem } from "@shared/types/models";
import { FormPage } from "@/components/form-layout";
import { PageLabel } from "@/components/page-label";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";

export function UsersPage() {
  const { t } = useTranslation();
  const { companySession, companyIdentity } = useAuth();
  const [users, setUsers] = useState<CompanyUserListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!companySession) {
      return;
    }

    setLoading(true);
    void api
      .listUsers(companySession.token)
      .then((response) => setUsers(response.users))
      .catch((error) =>
        toast({
          title: t("users.loadFailed"),
          description: error instanceof Error ? error.message : "Request failed"
        })
      )
      .finally(() => setLoading(false));
  }, [companySession, t]);

  return (
    <FormPage>
      <PageLabel title={t("users.title")} description={t("users.description")} />
      <div className="flex items-center justify-between">
        <Button asChild type="button">
          <Link to="/users/create">{t("users.new")}</Link>
        </Button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {loading ? <p className="px-5 py-6 text-sm text-muted-foreground">{t("users.loading")}</p> : null}
        {!loading && users.length === 0 ? <p className="px-5 py-6 text-sm text-muted-foreground">{t("users.empty")}</p> : null}
        {!loading ? (
          <div className="divide-y divide-border">
            {users.map((user) => (
              <Link
                key={user.id}
                to={`/users/${user.id}/edit`}
                className="flex items-center gap-3 px-5 py-4 text-sm text-foreground transition-colors hover:bg-muted/30"
              >
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    user.isActive ? "bg-emerald-500" : "bg-zinc-300"
                  }`}
                />
                <span>{user.fullName}</span>
                {companyIdentity?.user.id === user.id ? <span className="text-xs text-muted-foreground">{t("users.you")}</span> : null}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </FormPage>
  );
}
