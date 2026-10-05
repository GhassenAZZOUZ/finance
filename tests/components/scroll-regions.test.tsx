/** Scrollable tables are focusable, named regions (WCAG 2.1.1, axe `scrollable-region-focusable`, issue #122). */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ChartDataTable } from "@/app/(app)/_dashboard/plan-line-chart";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

afterEach(cleanup);

function expectFocusableRegion(name: string) {
  const region = screen.getByRole("region", { name });
  expect(region.getAttribute("tabindex")).toBe("0");
  return region;
}

describe("scroll regions (#122)", () => {
  it("the « Voir les données » table of a chart can be reached and scrolled with the keyboard", async () => {
    render(<ChartDataTable data={[{ label: "oct. 2026", debt: 100 }]} columns={[{ key: "debt", name: "Dettes" }]} caption="Dette restante, par mois" />);
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByText("Voir les données"));
    const region = expectFocusableRegion("Dette restante, par mois");
    await user.tab();
    expect(document.activeElement).toBe(region);
  });

  it("a shared Table with a label is a focusable, named region; without one it stays plain", () => {
    const row = (
      <TableBody>
        <TableRow>
          <TableCell>x</TableCell>
        </TableRow>
      </TableBody>
    );
    const { container } = render(
      <>
        <Table label="Historique des mois saisis">{row}</Table>
        <Table>{row}</Table>
      </>,
    );
    expectFocusableRegion("Historique des mois saisis");
    const containers = container.querySelectorAll('[data-slot="table-container"]');
    expect(containers[1]!.hasAttribute("tabindex")).toBe(false);
    expect(containers[1]!.getAttribute("role")).toBeNull();
  });
});
