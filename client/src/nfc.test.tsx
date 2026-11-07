// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api, write } from "./api";
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: vi.fn(),
  write: vi.fn(),
}));
import { NfcTools, NfcTagRegistration, readExactUri, type NdefReader } from "./nfc";
class BrowserApiFake extends EventTarget implements NdefReader {
  signal?: AbortSignal;
  write = vi.fn(async () => {});
  scan = vi.fn(async (options?: { signal?: AbortSignal }) => {
    this.signal = options?.signal;
  });
  read(records: { recordType: string; data: DataView }[]) {
    const event = new Event("reading");
    Object.assign(event, { message: { records } });
    this.dispatchEvent(event);
  }
}
const record = (uri: string) => ({
  recordType: "url",
  data: new DataView(new TextEncoder().encode(uri).buffer),
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
describe("Web NFC lifecycle with an explicit browser API fake (no physical hardware)", () => {
  it("returns the exact URI only after a reading event, then stops scanning", async () => {
    const reader = new BrowserApiFake(),
      result = readExactUri(reader);
    reader.read([record("https://store.example/u/one?x=%20")]);
    expect(await result).toBe("https://store.example/u/one?x=%20");
    expect(reader.signal?.aborted).toBe(true);
  });
  it("does not treat scan permission resolution as successful readback", async () => {
    vi.useFakeTimers();
    const reader = new BrowserApiFake(),
      result = readExactUri(reader, 100);
    const assertion = expect(result).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(reader.signal?.aborted).toBe(true);
  });
  it("rejects mixed/multiple records even when one URI matches", async () => {
    const reader = new BrowserApiFake(),
      result = readExactUri(reader);
    reader.read([record("https://example.com"), record("https://example.com")]);
    await expect(result).rejects.toThrow("exactly one");
  });
  it("rejects a device read failure and cleans the scan", async () => {
    const reader = new BrowserApiFake(),
      result = readExactUri(reader);
    reader.dispatchEvent(new Event("readingerror"));
    await expect(result).rejects.toThrow("could not be read");
    expect(reader.signal?.aborted).toBe(true);
  });
  it("aborts pending hardware scans on owner cancellation or modal closure", async () => {
    const reader = new BrowserApiFake(),
      controller = new AbortController(),
      result = readExactUri(reader, 30000, controller.signal);
    controller.abort();
    await expect(result).rejects.toThrow("cancelled");
    expect(reader.signal?.aborted).toBe(true);
  });
  it("handles an already cancelled operation without starting a scan", async () => {
    const reader = new BrowserApiFake(),
      controller = new AbortController();
    controller.abort();
    await expect(readExactUri(reader, 30000, controller.signal)).rejects.toThrow("cancelled");
    expect(reader.scan).not.toHaveBeenCalled();
  });
});

const configuration = {
  unitId: "unit",
  policy: "STATIC",
  canConfigure: true,
  keyStorageConfigured: true,
  registration: null,
};
describe("authenticated tag registration form", () => {
  it("clears the raw password field on submit and requires hardware confirmation", async () => {
    vi.mocked(api)
      .mockResolvedValueOnce(configuration)
      .mockResolvedValueOnce({
        ...configuration,
        policy: "NTAG424_SDM",
        registration: {
          uid: "04DE5F1EACC040",
          scheme: "NTAG424_SDM_AES_PLAIN_EMPTY_MAC",
          lastCounter: -1,
          createdAt: "2026-11-07",
        },
      });
    vi.mocked(write).mockResolvedValue({});
    render(<NfcTagRegistration unitId="unit" />);
    const keyField = (await screen.findByLabelText(
      "Personalized AES-128 SDM file-read key",
    )) as HTMLInputElement;
    expect(keyField.type).toBe("password");
    fireEvent.change(screen.getByLabelText("Hardware tag UID"), {
      target: { value: "04DE5F1EACC040" },
    });
    fireEvent.change(keyField, { target: { value: "22".repeat(16) } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(
      screen.getByRole("button", { name: "Register authenticated tag" }).closest("form")!,
    );
    expect(keyField.value).toBe("");
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith(
        "/nfc/tags",
        expect.objectContaining({
          hardwarePersonalizationConfirmed: true,
          profile: "NTAG424_SDM_AES_PLAIN_EMPTY_MAC",
          sdmFileReadKey: "22".repeat(16),
        }),
      ),
    );
    expect(await screen.findByText("04DE5F1EACC040")).toBeTruthy();
  });
  it("shows staff metadata without offering key configuration", async () => {
    vi.mocked(api).mockResolvedValue({ ...configuration, canConfigure: false });
    render(<NfcTagRegistration unitId="unit" />);
    await screen.findByText(
      "Only a store owner, manager, or administrator can register authenticated tags.",
    );
    expect(screen.queryByLabelText("Personalized AES-128 SDM file-read key")).toBeNull();
  });
});

describe("NFC tools task layout", () => {
  it("defaults to Encode and supports arrow, Home and End keyboard navigation", async () => {
    vi.mocked(api).mockResolvedValue(configuration);
    render(<NfcTools unitId="unit" />);
    const encode = screen.getByRole("tab", { name: "Encode" }),
      authenticated = screen.getByRole("tab", { name: "Authenticated tags" }),
      field = screen.getByRole("tab", { name: "Field testing" });
    expect(encode.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(encode.id);
    fireEvent.keyDown(encode, { key: "ArrowRight" });
    expect(authenticated.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(authenticated);
    await screen.findByLabelText("Hardware tag UID");
    fireEvent.keyDown(authenticated, { key: "End" });
    expect(field.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(field);
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(field.id);
    fireEvent.keyDown(field, { key: "Home" });
    expect(encode.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(encode);
  });
  it("removes raw key input when leaving the authenticated configuration tab", async () => {
    vi.mocked(api).mockResolvedValue(configuration);
    render(<NfcTools unitId="unit" />);
    fireEvent.click(screen.getByRole("tab", { name: "Authenticated tags" }));
    const keyField = await screen.findByLabelText("Personalized AES-128 SDM file-read key");
    fireEvent.change(keyField, { target: { value: "22".repeat(16) } });
    fireEvent.click(screen.getByRole("tab", { name: "Encode" }));
    expect(document.contains(keyField)).toBe(false);
    fireEvent.click(screen.getByRole("tab", { name: "Authenticated tags" }));
    const fresh = (await screen.findByLabelText(
      "Personalized AES-128 SDM file-read key",
    )) as HTMLInputElement;
    expect(fresh.value).toBe("");
  });
  it("progresses through write and exact readback before allowing explicitly confirmed locking", async () => {
    const readers: TestReader[] = [];
    class TestReader extends BrowserApiFake {
      constructor() {
        super();
        readers.push(this);
      }
      makeReadOnly = vi.fn(async () => {});
    }
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("NDEFReader", TestReader);
    const uri = "https://store.example/u/unit";
    vi.mocked(write).mockImplementation(async (path, body) => {
      const data = body as { kind?: string };
      const status =
        path === "/nfc/jobs"
          ? "CREATED"
          : data.kind === "WRITE_RESOLVED"
            ? "WRITTEN"
            : data.kind === "READ_BACK"
              ? "VERIFIED"
              : data.kind === "LOCK_RESOLVED"
                ? "LOCKED"
                : "FAILED";
      return { id: "job", expectedUri: uri, status } as never;
    });
    render(<NfcTools unitId="unit" />);
    fireEvent.click(screen.getByRole("button", { name: "Create encoder job" }));
    fireEvent.click(await screen.findByRole("button", { name: "Write tag" }));
    fireEvent.click(await screen.findByRole("button", { name: "Read back and verify" }));
    await waitFor(() => expect(readers).toHaveLength(2));
    readers[1]!.read([record(uri)]);
    const lock = await screen.findByRole("button", { name: "Permanently lock verified tag" });
    expect((lock as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect((lock as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(lock);
    await screen.findByText("Permanently locked");
    expect(write).toHaveBeenCalledWith("/nfc/jobs/job/observations", {
      kind: "LOCK_RESOLVED",
      irreversibleLockConfirmed: true,
    });
  });
});
