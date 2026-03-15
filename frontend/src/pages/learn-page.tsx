import ReactMarkdown from "react-markdown";
import { Link } from "react-router-dom";
import { AuthMark } from "@/components/auth-mark";
import { AppFrame } from "@/components/app-frame";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { learnPage } from "@/lib/learn-page";

const companyFacts = [
  "Jtzt keeps each company in its own SQLite database for clear isolation and easier operations.",
  "Secure mode adds a client-held encryption key workflow for companies that want stricter access control.",
  "The product is built for efficient internal usage, with low-overhead data access and compact interface patterns."
];

export function LearnPage() {
  return (
    <AppFrame centered className="items-center">
      <Card className="w-full border-border/90 shadow-[0_18px_60px_rgba(0,0,0,0.04)]">
        <CardHeader className="flex flex-col gap-3 pb-4">
          <AuthMark label="Learn more" />
        </CardHeader>
        <CardContent className="pt-0">
          <div className="mx-auto max-w-2xl space-y-5 text-[14px] leading-6 text-muted-foreground sm:text-[15px] sm:leading-6">
            <div className="space-y-1.5">
              <p className="text-[13px] font-semibold tracking-[-0.01em] text-foreground">Jtzt overview</p>
              <p>
              Jtzt is a compact company workspace built around tenant isolation, efficient local performance, and an optional secure access model.
              </p>
            </div>

            <div className="space-y-1.5">
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
                  li: ({ children }) => <li>{children}</li>
                }}
              >
                {learnPage.body}
              </ReactMarkdown>
            </div>

            <div className="space-y-4">
              <p className="text-[13px] font-semibold tracking-[-0.01em] text-foreground">Company and platform details</p>
              <div className="space-y-1.5">
                <p>Each company can choose between standard access and a secure mode with a client-held encryption key workflow.</p>
                <p>The platform stays efficient by keeping the stack small, the interfaces compact, and the data paths direct.</p>
              </div>
              <div className="space-y-0.5">
                <p className="font-semibold text-foreground">Company</p>
                <p>DI Osama Almughanni, BSc</p>
                <p>Doblergasse 3/3/8</p>
                <p>1070 Wien</p>
                <p>Austria</p>
              </div>
              <div className="space-y-0.5">
                <p className="font-semibold text-foreground">Firm data</p>
                <p>Firmenname: DI Osama Almughanni, BSc</p>
                <p>GLN: 9110029205681</p>
                <p>GISA-Zahl: 33018379</p>
              </div>
              <div className="space-y-0.5">
                <p className="font-semibold text-foreground">Berechtigungen</p>
                <p>FG Unternehmensberatung, Buchhaltung und Informationstechn.</p>
                <p>Dienstleistungen in der automatischen Datenverarbeitung und Informationstechnik</p>
                <p>Gewerberechtliche Geschäftsführung: -</p>
              </div>
              <div className="space-y-0.5">
                <p className="font-semibold text-foreground">Website</p>
                <p>jtzt.com</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-1.5">
              <Button asChild>
                <Link to="/register">Register company</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/login">Company sign in</Link>
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1 text-xs text-muted-foreground">
              <Link className="transition-opacity hover:opacity-60" to="/login">
                Sign in
              </Link>
              <div className="ml-auto">
                <ThemeToggle />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </AppFrame>
  );
}
