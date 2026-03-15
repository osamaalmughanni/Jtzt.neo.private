import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "./app";
import { GlobalFormBehavior } from "./components/global-form-behavior";
import { SeoManager } from "./components/seo-manager";
import { AuthProvider } from "./lib/auth";
import "./lib/i18n";
import { ThemeProvider } from "./lib/theme";
import { Toaster } from "./components/ui/sonner";
import "./styles/index.css";

function normalizeAppLocation() {
  if (typeof window === "undefined") return;
  if (window.location.hash.startsWith("#/")) return;

  const { pathname, search } = window.location;
  const looksLikeFile = /\.[a-z0-9]+$/i.test(pathname);
  if (pathname === "/" || looksLikeFile) return;

  const nextHashPath = `#${pathname}${search}`;
  window.history.replaceState(null, "", `${window.location.origin}/${nextHashPath}`);
}

normalizeAppLocation();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <ThemeProvider>
        <AuthProvider>
          <SeoManager />
          <GlobalFormBehavior />
          <App />
          <Toaster />
        </AuthProvider>
      </ThemeProvider>
    </HashRouter>
  </React.StrictMode>
);
