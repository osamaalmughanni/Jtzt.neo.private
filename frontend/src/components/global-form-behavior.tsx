import { useEffect } from "react";

function applyFormDefaults(root: ParentNode) {
  const forms = root.querySelectorAll("form");
  forms.forEach((form) => {
    form.setAttribute("autocomplete", "off");
    form.setAttribute("data-form-type", "other");
  });

  const fields = root.querySelectorAll("input, textarea, select");
  fields.forEach((field) => {
    field.setAttribute("autocomplete", "off");
    field.setAttribute("autocorrect", "off");
    field.setAttribute("autocapitalize", "none");
    field.setAttribute("spellcheck", "false");
    field.setAttribute("data-form-type", "other");
    field.setAttribute("data-lpignore", "true");
    field.setAttribute("data-1p-ignore", "true");
  });
}

export function GlobalFormBehavior() {
  useEffect(() => {
    applyFormDefaults(document);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) {
            applyFormDefaults(node);
          }
        });
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    return () => observer.disconnect();
  }, []);

  return null;
}
