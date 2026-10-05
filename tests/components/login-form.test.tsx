/** Login (issue #3): the email carries a link and a one-time code; the code signs in on any device. */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/app/login/login-form";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  params: "",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(mocks.params),
}));
vi.mock("@/lib/supabase/client", () => ({
  authConfirmUrl: () => "http://localhost/auth/confirm/",
  supabaseBrowser: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      signInWithOtp: mocks.signInWithOtp,
      verifyOtp: mocks.verifyOtp,
    },
  }),
}));

beforeEach(() => {
  mocks.params = "";
  mocks.replace.mockClear();
  mocks.signInWithOtp.mockReset().mockResolvedValue({ error: null });
  mocks.verifyOtp.mockReset().mockResolvedValue({ error: null });
});
afterEach(cleanup);

async function requestCode(email = "someone@example.com") {
  const user = userEvent.setup({ delay: null });
  render(<LoginForm />);
  await user.type(screen.getByLabelText("Adresse e-mail"), email);
  await user.click(screen.getByRole("button", { name: "Recevoir un code de connexion" }));
  return user;
}

describe("LoginForm", () => {
  it("confirms a deleted account (SPEC D26)", () => {
    mocks.params = "compte-supprime";
    render(<LoginForm />);
    expect(screen.getByRole("status").textContent).toContain("Votre compte et toutes vos données ont été supprimés.");
  });

  it("rejects an invalid address without sending anything", async () => {
    await requestCode("not-an-email");
    expect(await screen.findByText("Adresse e-mail invalide")).toBeTruthy();
    expect(mocks.signInWithOtp).not.toHaveBeenCalled();
  });

  it("sends the email with the confirm page as the link target, then asks for the code", async () => {
    await requestCode();
    expect(await screen.findByLabelText("Code de connexion")).toBeTruthy();
    expect(mocks.signInWithOtp).toHaveBeenCalledWith({
      email: "someone@example.com",
      options: { emailRedirectTo: "http://localhost/auth/confirm/" },
    });
    expect(screen.getByText("E-mail envoyé à someone@example.com.")).toBeTruthy();
  });

  it("#119 — keeps digits only, 6 at most, and enables « Se connecter » at exactly 6 digits", async () => {
    const user = await requestCode();
    const field = (await screen.findByLabelText("Code de connexion")) as HTMLInputElement;
    const submit = () => screen.getByRole("button", { name: "Se connecter" }) as HTMLButtonElement;
    expect(submit().disabled).toBe(true);
    await user.type(field, "12ab");
    expect(field.value).toBe("12");
    await user.type(field, "345");
    expect(field.value).toBe("12345");
    expect(submit().disabled).toBe(true);
    await user.type(field, "67");
    expect(field.value).toBe("123456");
    expect(submit().disabled).toBe(false);
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("#120 — a wrong or expired code: French error, field cleared and focused, still on the page", async () => {
    mocks.verifyOtp.mockResolvedValue({ error: { message: "Token has expired or is invalid" } });
    const user = await requestCode();
    const field = (await screen.findByLabelText("Code de connexion")) as HTMLInputElement;
    await user.type(field, "000000");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));
    expect(await screen.findByText("Code invalide ou expiré. Vérifiez-le, ou demandez un nouveau code.")).toBeTruthy();
    expect(field.value).toBe("");
    expect(document.activeElement).toBe(field);
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("signs in with a valid code (spaces ignored) and opens the dashboard", async () => {
    const user = await requestCode();
    await user.type(await screen.findByLabelText("Code de connexion"), "123 456");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));
    await vi.waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/"));
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ email: "someone@example.com", token: "123456", type: "email" });
  });

  it("lets the user go back to change the address and resend", async () => {
    const user = await requestCode();
    await user.click(await screen.findByRole("button", { name: "Utiliser une autre adresse ou renvoyer un code" }));
    expect((screen.getByLabelText("Adresse e-mail") as HTMLInputElement).value).toBe("someone@example.com");
    await user.click(screen.getByRole("button", { name: "Recevoir un code de connexion" }));
    expect(await screen.findByLabelText("Code de connexion")).toBeTruthy();
    expect(mocks.signInWithOtp).toHaveBeenCalledTimes(2);
  });
  it("AC-09 — the code field is labelled, numeric, autofilled from the e-mail and links its error", async () => {
    const user = await requestCode();
    const field = await screen.findByLabelText("Code de connexion");
    expect(field.getAttribute("inputmode")).toBe("numeric");
    expect(field.getAttribute("autocomplete")).toBe("one-time-code");
    expect(document.activeElement).toBe(field);
    // 44 px tap target for the submit button.
    expect(screen.getByRole("button", { name: "Se connecter" }).className).toContain("min-h-11");
    mocks.verifyOtp.mockResolvedValue({ error: { message: "Token has expired or is invalid" } });
    await user.type(field, "000000");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));
    const error = await screen.findByRole("alert");
    expect(field.getAttribute("aria-describedby")).toBe(error.id);
  });
});
