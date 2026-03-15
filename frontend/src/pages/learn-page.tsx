import { ArrowRight } from "phosphor-react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { Link } from "react-router-dom";
import { Logo } from "@/components/logo";
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
    <div className="min-h-screen bg-[linear-gradient(180deg,#ffffff_0%,#fafafa_100%)] text-black">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[32rem] bg-[radial-gradient(circle_at_top_left,rgba(0,0,0,0.05),transparent_38%),radial-gradient(circle_at_top_right,rgba(0,0,0,0.04),transparent_30%)]" />
      <div className="relative mx-auto w-full max-w-6xl px-6 py-6 sm:px-10 sm:py-10">
        <motion.header
          className="mb-16 flex items-start justify-between gap-6"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          <Link to="/" className="inline-flex flex-col items-start">
            <Logo size={110} />
            <p className="mt-1 text-lg font-semibold tracking-[-0.02em] text-neutral-500">Jtzt</p>
          </Link>
          <div className="flex items-center gap-3">
            <a
              href="mailto:hello@jtzt.example"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-white/80 px-4 py-2 text-sm font-semibold tracking-[-0.01em] shadow-[0_10px_30px_rgba(0,0,0,0.04)] transition-transform duration-200 hover:-translate-y-0.5"
            >
              Contact
              <ArrowRight size={16} weight="bold" />
            </a>
          </div>
        </motion.header>

        <motion.section
          className="mb-20 grid gap-10 lg:grid-cols-[minmax(0,1fr)_16rem]"
          initial="hidden"
          animate="show"
          variants={container}
        >
          <div>
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.28em] text-neutral-500">Working Hours Platform</p>
            <h1 className="max-w-5xl text-[3.4rem] font-semibold leading-[0.95] tracking-[-0.06em] text-black sm:text-[5.25rem]">
              {learnPage.description}
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-neutral-600">
              Jtzt is designed for companies that want a sharp internal system with clean tenant boundaries, fast local
              performance, and a codebase that stays understandable as it grows.
            </p>
          </div>
          <div className="flex flex-col gap-4 pt-2">
            <div className="rounded-[1.75rem] border border-border bg-white/75 p-5 backdrop-blur">
              <p className="text-[2rem] font-semibold tracking-[-0.05em]">Fast</p>
              <p className="mt-1 text-sm leading-6 text-neutral-600">Local SQLite and direct queries keep interaction immediate.</p>
            </div>
            <div className="rounded-[1.75rem] border border-border bg-white/75 p-5 backdrop-blur">
              <p className="text-[2rem] font-semibold tracking-[-0.05em]">Clear</p>
              <p className="mt-1 text-sm leading-6 text-neutral-600">Simple structures make the product easy to operate and extend.</p>
            </div>
          </div>
        </motion.section>

        <motion.section
          className="mb-20 grid gap-4 sm:grid-cols-3"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="rounded-[1.75rem] border border-border bg-white/75 p-6">
            <p className="text-[2rem] font-semibold tracking-[-0.05em]">1 DB</p>
            <p className="mt-1 text-sm leading-6 text-neutral-600">per company for clear isolation</p>
          </div>
          <div className="rounded-[1.75rem] border border-border bg-white/75 p-6">
            <p className="text-[2rem] font-semibold tracking-[-0.05em]">TypeScript</p>
            <p className="mt-1 text-sm leading-6 text-neutral-600">across frontend, backend, and shared types</p>
          </div>
          <div className="rounded-[1.75rem] border border-border bg-white/75 p-6">
            <p className="text-[2rem] font-semibold tracking-[-0.05em]">Local-first</p>
            <p className="mt-1 text-sm leading-6 text-neutral-600">built for fast internal deployment</p>
          </div>
        </motion.section>

        <motion.article
          className="mx-auto max-w-3xl rounded-[2rem] border border-border bg-white/80 p-7 sm:p-10"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.16, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        >
        <ReactMarkdown
          components={{
            h1: ({ children }) => (
              <h1 className="mb-6 text-[2.3rem] font-semibold leading-[0.98] tracking-[-0.05em] text-black">{children}</h1>
            ),
            h2: ({ children }) => (
              <h2 className="mb-3 mt-12 text-[1.6rem] font-semibold leading-tight tracking-[-0.03em] text-black">{children}</h2>
            ),
            p: ({ children }) => <p className="mb-5 text-[1.05rem] leading-8 text-neutral-700">{children}</p>,
            ul: ({ children }) => <ul className="mb-5 space-y-2 pl-5 text-[1.05rem] leading-8 text-neutral-700">{children}</ul>,
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
