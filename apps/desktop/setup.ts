import type { DesktopSetupValues } from "./desktop-config";

interface SetupApi {
  load(): Promise<{
    values: Partial<Record<keyof DesktopSetupValues, string>>;
    missing: string[];
    configPath: string;
    error: string | null;
  }>;
  save(
    values: Record<string, string>,
  ): Promise<{ ok: true } | { ok: false; errors: Record<string, string> }>;
  generateKey(): Promise<string>;
  openTelegramApi(): Promise<void>;
  cancel(): Promise<void>;
}

declare global {
  interface Window {
    omnicloudSetup: SetupApi;
  }
}

const fields = [
  "TELEGRAM_API_ID",
  "TELEGRAM_API_HASH",
  "DATABASE_URL",
  "OMNICLOUD_ENCRYPTION_KEY",
] as const;

type Field = (typeof fields)[number];

const form = document.getElementById("setup-form") as HTMLFormElement;
const save = document.getElementById("save") as HTMLButtonElement;
const generate = document.getElementById("generate-key") as HTMLButtonElement;
const cancel = document.getElementById("cancel") as HTMLButtonElement;
const openTelegram = document.getElementById("open-telegram") as HTMLButtonElement;
const formError = document.getElementById("form-error") as HTMLDivElement;
const configPath = document.getElementById("config-path") as HTMLSpanElement;

function input(field: Field): HTMLInputElement {
  return document.getElementById(field) as HTMLInputElement;
}

function fieldError(field: Field): HTMLSpanElement {
  return document.getElementById(`error-${field}`) as HTMLSpanElement;
}

function clearErrors(): void {
  formError.classList.remove("visible");
  formError.textContent = "";
  for (const field of fields) {
    fieldError(field).textContent = "";
    input(field).removeAttribute("aria-invalid");
  }
}

function showErrors(errors: Record<string, string>): void {
  for (const [field, message] of Object.entries(errors)) {
    const target = fieldError(field as Field);
    if (target !== null) {
      target.textContent = message;
      input(field as Field).setAttribute("aria-invalid", "true");
    }
  }
}

function currentValues(): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field, input(field).value])) as Record<
    string,
    string
  >;
}

void window.omnicloudSetup.load().then((payload) => {
  for (const field of fields) {
    input(field).value = payload.values[field] ?? "";
  }
  configPath.textContent = `Saved to ${payload.configPath}`;
  if (payload.error !== null) {
    formError.textContent = payload.error;
    formError.classList.add("visible");
  }
  const firstEmpty = fields.find((field) => input(field).value === "");
  (firstEmpty !== undefined ? input(firstEmpty) : input("TELEGRAM_API_ID")).focus();
});

generate.addEventListener("click", () => {
  void window.omnicloudSetup.generateKey().then((key) => {
    input("OMNICLOUD_ENCRYPTION_KEY").value = key;
    fieldError("OMNICLOUD_ENCRYPTION_KEY").textContent = "";
    input("OMNICLOUD_ENCRYPTION_KEY").removeAttribute("aria-invalid");
  });
});

const revealKey = document.getElementById("reveal-key") as HTMLInputElement;
revealKey.addEventListener("change", () => {
  input("OMNICLOUD_ENCRYPTION_KEY").type = revealKey.checked ? "text" : "password";
});

openTelegram.addEventListener("click", () => {
  void window.omnicloudSetup.openTelegramApi();
});

cancel.addEventListener("click", () => {
  void window.omnicloudSetup.cancel();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  clearErrors();
  save.disabled = true;
  save.textContent = "Saving…";
  void window.omnicloudSetup
    .save(currentValues())
    .then((result) => {
      if (result.ok) return;
      showErrors(result.errors);
      formError.textContent = "Check the highlighted fields and try again.";
      formError.classList.add("visible");
    })
    .catch(() => {
      formError.textContent = "Could not save the configuration. Try again.";
      formError.classList.add("visible");
    })
    .finally(() => {
      save.disabled = false;
      save.textContent = "Save and continue";
    });
});
