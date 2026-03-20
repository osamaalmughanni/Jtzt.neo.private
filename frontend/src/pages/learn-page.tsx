import ReactMarkdown from "react-markdown";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowLeft } from "phosphor-react";
import { PageIntro } from "@/components/page-intro";
import { PageLabel } from "@/components/page-label";
import { PublicShell } from "@/components/public-shell";
import { Stack } from "@/components/stack";
import { Button } from "@/components/ui/button";
import { learnPage } from "@/lib/learn-page";

export function LearnPage() {
  const { t } = useTranslation();
  const companyFacts = [t("learn.fact1"), t("learn.fact2"), t("learn.fact3")];

  return (
    <PublicShell
      actions={[{ to: "/", label: "Back", icon: ArrowLeft }]}
    >
      <Stack gap="lg" className="text-[14px] leading-6 text-muted-foreground sm:text-[15px] sm:leading-6">
        <PageIntro>
          <PageLabel title={t("common.learnMore")} description={t("learn.overviewBody")} />
        </PageIntro>
        <div className="flex flex-col gap-1.5">
          <p className="text-[13px] font-semibold tracking-[-0.01em] text-foreground">{t("learn.overviewTitle")}</p>
          <p>{t("learn.overviewBody")}</p>
        </div>

        <div className="flex flex-col gap-1.5">
          {companyFacts.map((fact) => (
            <p key={fact}>{fact}</p>
          ))}
        </div>

        <div>
          <ReactMarkdown
            components={{
              h1: ({ children }) => <h1 className="text-[1.35rem] font-semibold leading-[1.15] tracking-[-0.02em] text-foreground">{children}</h1>,
              h2: ({ children }) => <h2 className="pt-3 text-[1rem] font-semibold leading-[1.25] tracking-[-0.01em] text-foreground">{children}</h2>,
              p: ({ children }) => <p className="mt-2 leading-6">{children}</p>,
              ul: ({ children }) => <ul className="mt-2 space-y-1.5 pl-5 leading-6">{children}</ul>,
              li: ({ children }) => <li>{children}</li>,
            }}
          >
            {learnPage.body}
          </ReactMarkdown>
        </div>

        <div className="flex flex-col gap-4">
          <p className="text-[13px] font-semibold tracking-[-0.01em] text-foreground">{t("learn.detailsTitle")}</p>
          <div className="flex flex-col gap-1.5">
            <p>{t("learn.detailsBody1")}</p>
            <p>{t("learn.detailsBody2")}</p>
          </div>
          <div className="flex flex-col gap-0.5">
            <p className="font-semibold text-foreground">{t("learn.companyTitle")}</p>
            <p>DI Osama Almughanni, BSc</p>
            <p>Doblergasse 3/3/8</p>
            <p>1070 Wien</p>
            <p>Austria</p>
          </div>
          <div className="flex flex-col gap-0.5">
            <p className="font-semibold text-foreground">{t("learn.firmDataTitle")}</p>
            <p>Firmenname: DI Osama Almughanni, BSc</p>
            <p>GLN: 9110029205681</p>
            <p>GISA-Zahl: 33018379</p>
          </div>
          <div className="flex flex-col gap-0.5">
            <p className="font-semibold text-foreground">{t("learn.permissionsTitle")}</p>
            <p>FG Unternehmensberatung, Buchhaltung und Informationstechn.</p>
            <p>Dienstleistungen in der automatischen Datenverarbeitung und Informationstechnik</p>
            <p>Gewerberechtliche Geschäftsführung: -</p>
          </div>
          <div className="flex flex-col gap-0.5">
            <p className="font-semibold text-foreground">{t("learn.websiteTitle")}</p>
            <p>jtzt.com</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-1.5">
          <Button asChild>
            <Link to="/register">{t("auth.registerTitle")}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/login">{t("auth.companySignInTitle")}</Link>
          </Button>
        </div>
      </Stack>
    </PublicShell>
  );
}
