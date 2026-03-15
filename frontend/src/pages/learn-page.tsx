import { ArrowRight } from "phosphor-react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { Link } from "react-router-dom";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { learnPage } from "@/lib/learn-page";

const container = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.55,
      ease: [0.22, 1, 0.36, 1]
    }
  }
};

export function LearnPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[-7rem] top-[-8rem] h-72 w-72 rounded-full bg-foreground/5 blur-3xl" />
        <div className="absolute right-[-8rem] top-10 h-80 w-80 rounded-full bg-foreground/5 blur-3xl" />
      </div>
      <div className="relative mx-auto w-full max-w-6xl px-6 py-6 sm:px-10 sm:py-10">
        <motion.header
          className="mb-14 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          <Link to="/" className="inline-flex flex-col items-start">
            <Logo size={110} />
            <p className="mt-1 text-lg font-semibold tracking-[-0.02em] text-muted-foreground">Jtzt</p>
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <ThemeToggle />
            <Link
              to="/register"
              className="inline-flex items-center gap-2 rounded-full border border-primary bg-primary px-4 py-2 text-sm font-semibold tracking-[-0.01em] text-primary-foreground transition-transform duration-200 hover:-translate-y-0.5"
            >
              Register company
              <ArrowRight size={16} weight="bold" />
            </Link>
            <Link
              to="/login"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card/85 px-4 py-2 text-sm font-semibold tracking-[-0.01em] text-foreground shadow-sm transition-transform duration-200 hover:-translate-y-0.5"
            >
              Company sign in
            </Link>
          </div>
        </motion.header>

        <motion.section
          className="mb-16 grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]"
          initial="hidden"
          animate="show"
          variants={container}
        >
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">Working Hours Platform</p>
            <h1 className="max-w-5xl text-[2.9rem] font-semibold leading-[0.96] tracking-[-0.06em] text-foreground sm:text-[4.8rem]">
              {learnPage.description}
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-muted-foreground sm:text-lg">
              Jtzt is designed for companies that want a sharp internal system with clean tenant boundaries, fast local
              performance, and a codebase that stays understandable as it grows.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/register"
                className="inline-flex items-center gap-2 rounded-full border border-primary bg-primary px-5 py-3 text-sm font-semibold tracking-[-0.01em] text-primary-foreground transition-transform duration-200 hover:-translate-y-0.5"
              >
                Create company workspace
                <ArrowRight size={16} weight="bold" />
              </Link>
              <Link
                to="/login"
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card/85 px-5 py-3 text-sm font-semibold tracking-[-0.01em] text-foreground transition-transform duration-200 hover:-translate-y-0.5"
              >
                Company sign in
              </Link>
            </div>
          </div>
          <div className="flex flex-col gap-4 pt-2">
            <div className="rounded-[1.5rem] border border-border/80 bg-card/88 p-5 shadow-sm backdrop-blur">
              <p className="text-[1.8rem] font-semibold tracking-[-0.05em]">Fast</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Local SQLite and direct queries keep interaction immediate.</p>
            </div>
            <div className="rounded-[1.5rem] border border-border/80 bg-card/88 p-5 shadow-sm backdrop-blur">
              <p className="text-[1.8rem] font-semibold tracking-[-0.05em]">Clear</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Simple structures make the product easy to operate and extend.</p>
            </div>
            <div className="rounded-[1.5rem] border border-border/80 bg-card/88 p-5 shadow-sm backdrop-blur">
              <p className="text-[1.8rem] font-semibold tracking-[-0.05em]">Secure</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Optional client-held key workflows support stricter data handling.</p>
            </div>
          </div>
        </motion.section>

        <motion.section
          className="mb-16 grid gap-4 sm:grid-cols-3"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="rounded-[1.5rem] border border-border/80 bg-card/88 p-6 shadow-sm">
            <p className="text-[2rem] font-semibold tracking-[-0.05em]">1 DB</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">per company for clear isolation</p>
          </div>
          <div className="rounded-[1.5rem] border border-border/80 bg-card/88 p-6 shadow-sm">
            <p className="text-[2rem] font-semibold tracking-[-0.05em]">TypeScript</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">across frontend, backend, and shared types</p>
          </div>
          <div className="rounded-[1.5rem] border border-border/80 bg-card/88 p-6 shadow-sm">
            <p className="text-[2rem] font-semibold tracking-[-0.05em]">Local-first</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">built for fast internal deployment</p>
          </div>
        </motion.section>

        <motion.article
          className="mx-auto max-w-3xl rounded-[2rem] border border-border/80 bg-card/92 p-7 shadow-sm sm:p-10"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.16, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        >
          <ReactMarkdown
            components={{
              h1: ({ children }) => (
                <h1 className="mb-6 text-[2.3rem] font-semibold leading-[0.98] tracking-[-0.05em] text-foreground">{children}</h1>
              ),
              h2: ({ children }) => (
                <h2 className="mb-3 mt-12 text-[1.6rem] font-semibold leading-tight tracking-[-0.03em] text-foreground">{children}</h2>
              ),
              p: ({ children }) => <p className="mb-5 text-[1.05rem] leading-8 text-muted-foreground">{children}</p>,
              ul: ({ children }) => <ul className="mb-5 space-y-2 pl-5 text-[1.05rem] leading-8 text-muted-foreground">{children}</ul>,
              li: ({ children }) => <li className="pl-1">{children}</li>
            }}
          >
            {learnPage.body}
          </ReactMarkdown>
        </motion.article>
      </div>
    </div>
  );
}
