import { describe, expect, it, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { PasskeyOptions, type PasskeyFlow } from "./PasskeyOptions";

function flow(overrides: Partial<PasskeyFlow> = {}): PasskeyFlow {
  return {
    mode: null,
    submitting: false,
    succeeded: false,
    error: null,
    notice: null,
    run: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  };
}

describe("PasskeyOptions", () => {
  it("offers a new account and an existing passkey", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <PasskeyOptions flow={flow()} />,
    );

    expect(html).toContain("New user");
    expect(html).toContain("Create a new account.");
    expect(html).toContain("Existing user");
    expect(html).toContain("Use a passkey you already have");
  });

  it("disables both choices while the browser prompt is open", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <PasskeyOptions
        flow={flow({
          mode: "create",
          submitting: true,
          notice: "Waiting for your passkey…",
        })}
      />,
    );

    expect(html).toContain("Waiting for your passkey…");
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });

  it("shows the error in place of the choices", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <PasskeyOptions
        flow={flow({
          error: "The passkey prompt was cancelled. Your account was not changed.",
        })}
      />,
    );

    expect(html).toContain(
      "The passkey prompt was cancelled. Your account was not changed.",
    );
  });

  it("confirms a created account", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <PasskeyOptions
        flow={flow({
          mode: "create",
          succeeded: true,
          notice: "Account created.",
        })}
      />,
    );

    expect(html).toContain("Account created.");
  });

  it("offers a way back inside the login dialog", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <PasskeyOptions flow={flow()} onBack={() => {}} />,
    );

    expect(html).toContain("Go Back");
  });

  it("does not add a back action to the standalone dialog", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <PasskeyOptions flow={flow()} />,
    );

    expect(html).not.toContain("Go Back");
  });
});
