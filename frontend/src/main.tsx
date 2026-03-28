import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app";
import { GlobalFormBehavior } from "./components/global-form-behavior";
import { SeoManager } from "./components/seo-manager";
import { AuthProvider } from "./lib/auth";
import { CompanySettingsProvider } from "./lib/company-settings";
import "./lib/i18n";
import { ThemeProvider } from "./lib/theme";
import { Toaster } from "./components/ui/sonner";
import "./styles/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <CompanySettingsProvider>
            <SeoManager />
            <GlobalFormBehavior />
            <App />
            <Toaster />
          </CompanySettingsProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
