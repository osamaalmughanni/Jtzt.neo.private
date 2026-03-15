import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app";
import { GlobalFormBehavior } from "./components/global-form-behavior";
import { SeoManager } from "./components/seo-manager";
import { AuthProvider } from "./lib/auth";
import { Toaster } from "./components/ui/sonner";
import "./styles/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <SeoManager />
        <GlobalFormBehavior />
        <App />
        <Toaster />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
