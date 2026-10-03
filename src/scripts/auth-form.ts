import { ApiError, register, signIn } from "../lib/client";

export function initAuthForms() {
  document.querySelectorAll<HTMLElement>("[data-auth-form]").forEach((root) => {
    const form = root.querySelector("form")!;
    const error = root.querySelector<HTMLElement>("[data-auth-error]")!;
    const submit = root.querySelector<HTMLButtonElement>("[data-auth-submit]")!;
    const password = form.querySelector<HTMLInputElement>('[name="password"]')!;

    const setMode = (mode: string) => {
      form.dataset.mode = mode;
      root.querySelectorAll<HTMLElement>("[data-auth-tab]").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.authTab === mode)));
      submit.textContent = mode === "register" ? "Create account" : "Sign in";
      password.autocomplete = mode === "register" ? "new-password" : "current-password";
      error.hidden = true;
    };

    root.querySelectorAll<HTMLElement>("[data-auth-tab]").forEach((tab) => tab.addEventListener("click", () => setMode(tab.dataset.authTab!)));

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
      if (!data.email || !data.password) {
        error.textContent = "Enter your email and password.";
        error.hidden = false;
        return;
      }
      submit.disabled = true;
      error.hidden = true;
      try {
        if (form.dataset.mode === "register") {
          await register({ email: data.email, password: data.password, first_name: data.first_name ?? "", last_name: data.last_name ?? "" });
        } else {
          await signIn(data.email, data.password);
        }
        form.reset();
      } catch (err) {
        error.textContent =
          err instanceof ApiError && err.status === 401
            ? "Email or password is not right."
            : err instanceof ApiError
              ? err.message
              : "Could not reach the cinema. Try again in a moment.";
        error.hidden = false;
      } finally {
        submit.disabled = false;
      }
    });
  });
}
