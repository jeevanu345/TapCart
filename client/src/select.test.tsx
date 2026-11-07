// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Select } from "./select";
afterEach(cleanup);
function Picker({ cancelReset = false }: { cancelReset?: boolean }) {
  return (
    <form
      aria-label="Fixture"
      onReset={(event) => {
        if (cancelReset) event.preventDefault();
      }}
    >
      <label>
        Role
        <Select name="role" defaultValue="STAFF" required>
          <option value="">Choose role</option>
          <option value="STAFF">Staff</option>
          <option value="MANAGER">Manager</option>
        </Select>
      </label>
      <button type="reset">Reset</button>
    </form>
  );
}
describe("App-styled select native form contract", () => {
  it("submits one actual value and preserves it on reset even when unchanged", async () => {
    render(<Picker />);
    const form = screen.getByRole("form") as HTMLFormElement;
    expect(new FormData(form).getAll("role")).toEqual(["STAFF"]);
    expect(form.checkValidity()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(new FormData(form).get("role")).toBe("STAFF"));
    expect(screen.getByRole("combobox", { name: "Role" }).textContent).toBe("Staff");
  });
  it("resets a changed value in both the visible trigger and submitted data", async () => {
    render(<Picker />);
    const form = screen.getByRole("form") as HTMLFormElement,
      control = form.elements.namedItem("role") as HTMLSelectElement;
    fireEvent.change(control, { target: { value: "MANAGER" } });
    expect(new FormData(form).get("role")).toBe("MANAGER");
    expect(screen.getByRole("combobox", { name: "Role" }).textContent).toBe("Manager");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Role" }).textContent).toBe("Staff"),
    );
    expect(new FormData(form).get("role")).toBe("STAFF");
  });
  it("honors canceled resets", async () => {
    render(<Picker cancelReset />);
    const form = screen.getByRole("form") as HTMLFormElement,
      control = form.elements.namedItem("role") as HTMLSelectElement;
    fireEvent.change(control, { target: { value: "MANAGER" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await Promise.resolve();
    expect(new FormData(form).get("role")).toBe("MANAGER");
    expect(screen.getByRole("combobox", { name: "Role" }).textContent).toBe("Manager");
  });
  it("focuses the visible trigger on required validation and excludes disabled controls", () => {
    render(
      <form aria-label="Validation">
        <label>
          Supplier
          <Select name="supplier" required defaultValue="">
            <option value="">Choose supplier</option>
            <option value="a">Alpha</option>
          </Select>
        </label>
        <label>
          Disabled
          <Select name="disabled" disabled>
            <option value="x">Hidden from submission</option>
          </Select>
        </label>
      </form>,
    );
    const form = screen.getByRole("form") as HTMLFormElement;
    let valid = true;
    act(() => {
      valid = form.checkValidity();
    });
    expect(valid).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Supplier" }));
    expect(screen.getByText("Choose an option.")).toBeTruthy();
    expect(new FormData(form).has("disabled")).toBe(false);
  });
  it("adopts asynchronously loaded options before a choice, skipping disabled defaults", async () => {
    const { rerender } = render(
      <label>
        Async
        <Select name="async" children={null} />
      </label>,
    );
    rerender(
      <label>
        Async
        <Select name="async">
          <option value="off" disabled>
            Unavailable
          </option>
          <option value="ready">Ready</option>
        </Select>
      </label>,
    );
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Async" }).textContent).toBe("Ready"),
    );
  });
});
